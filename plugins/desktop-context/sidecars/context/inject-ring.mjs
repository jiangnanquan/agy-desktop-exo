#!/usr/bin/env node
/**
 * Antigravity 2.0 Input Box Context Ring & Telemetry Popover (Minimalist Design)
 *
 * Cross-platform (macOS / Windows / Linux):
 * - Hosted natively inside the `desktop-context` sidecar (`main.mjs`) so its
 *   lifecycle is 100% bound to Antigravity 2.0 (starts on app launch, exits on quit).
 * - Can also be executed standalone (`node inject-ring.mjs`).
 * - Restrained UI: SVG stroke icons, tabular numerals, zero emojis.
 * - Injects:
 *   1. Input toolbar mini-ring (`#agy-ring-btn`) + floating telemetry popover
 *   2. Quick-launch "Context Usage" entry in the Auxiliary Pane "+ (New Tab)" view
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readContextProConfig } from './config.mjs';
import { getResetWatchCachePath, getResetWatchState, refreshResetWatchAsync } from './resets_watch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const TMP_DIR = os.tmpdir();
const PID_FILE = path.join(TMP_DIR, 'agy-input-ring.pid');
export const ACTIVE_CONV_FILE = path.join(TMP_DIR, 'agy-active-conversation.id');

const DEVTOOLS_PORT_FILE =
  process.platform === 'darwin'
    ? path.join(HOME, 'Library/Application Support/Antigravity/DevToolsActivePort')
    : process.platform === 'win32'
      ? path.join(process.env.APPDATA || path.join(HOME, 'AppData/Roaming'), 'Antigravity/DevToolsActivePort')
      : path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, '.config'), 'Antigravity/DevToolsActivePort');

const REPORT_SCRIPT = path.join(HERE, 'context_report.py');
const SWARM_SCRIPT = path.join(HERE, 'swarm_radar.py');

const PYTHON_CANDIDATES =
  process.platform === 'win32'
    ? [
        ['python', []],
        ['py', ['-3']],
        ['python3', []],
      ]
    : [
        ['python3', []],
        ['python', []],
      ];

const POLL_INTERVAL_MS = 2500;
let cdpMsgId = 1;
const activePages = new Map();
const reportCache = new Map();
let resolvedPython = null;

function execPromise(cmd, args, timeout = 8000) {
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
  if (process.platform !== 'win32') {
    env.PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', process.env.PATH || ''].join(':');
  }
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim()));
      else resolve(stdout);
    });
  });
}

async function findPython() {
  if (resolvedPython) return resolvedPython;
  for (const [cmd, pre] of PYTHON_CANDIDATES) {
    try {
      const out = await execPromise(cmd, [...pre, '--version'], 4000);
      if (/^Python 3\./.test(out.trim())) {
        resolvedPython = { cmd, pre };
        return resolvedPython;
      }
    } catch {}
  }
  return null;
}

function isAntigravityAppRunning() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile('tasklist', ['/FI', 'IMAGENAME eq Antigravity.exe', '/NH'], { timeout: 2500, windowsHide: true }, (err, stdout) => {
        if (err || !stdout) {
          resolve(false);
          return;
        }
        resolve(stdout.toLowerCase().includes('antigravity.exe'));
      });
      return;
    }
    execFile('/bin/ps', ['-Ao', 'comm'], { timeout: 2000 }, (err, stdout) => {
      if (err || !stdout) {
        resolve(false);
        return;
      }
      const running = stdout.split('\n').some((line) => {
        const s = line.trim();
        return s.endsWith('/Antigravity.app/Contents/MacOS/Antigravity') || s === 'antigravity';
      });
      resolve(running);
    });
  });
}

function readDevToolsPort() {
  if (!fs.existsSync(DEVTOOLS_PORT_FILE)) return null;
  try {
    const lines = fs.readFileSync(DEVTOOLS_PORT_FILE, 'utf8').trim().split(/\r?\n/);
    const port = Number.parseInt((lines[0] || '').trim(), 10);
    return Number.isFinite(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

async function listTargetPages(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json`, {
      signal: AbortSignal.timeout(1200),
    });
    const list = await res.json();
    return list.filter(
      (p) =>
        p.type === 'page' &&
        p.webSocketDebuggerUrl &&
        p.url &&
        (p.url.includes('127.0.0.1') || p.url.includes('localhost')) &&
        !p.url.includes('devtools://')
    );
  } catch {
    return null;
  }
}

async function standaloneContextReport(conversationId) {
  if (!fs.existsSync(REPORT_SCRIPT)) return null;
  if (!conversationId || !/^[0-9a-f-]{36}$/i.test(conversationId)) return null;
  const cacheKey = conversationId;
  const cached = reportCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < 2000) {
    return cached.report;
  }
  const py = await findPython();
  if (!py) return null;

  const cfg = readContextProConfig();
  const args = [...py.pre, REPORT_SCRIPT, '--json', '--conversation-id', conversationId];
  try {
    const stdout = await execPromise(py.cmd, args, 8000);
    const data = JSON.parse(stdout);
    data.lang = cfg.lang;
    data.audit_enabled = Boolean(cfg.audit_rules?.enabled);
    if (fs.existsSync(SWARM_SCRIPT)) {
      try {
        const sArgs = [...py.pre, SWARM_SCRIPT, conversationId, '--json'];
        if (cfg.lang === 'zh' || cfg.lang === 'en') sArgs.push('--lang', cfg.lang);
        const sOut = await execPromise(py.cmd, sArgs, 4000);
        const radar = JSON.parse(sOut);
        if (radar && radar.has_cluster) {
          const s = radar.summary || {};
          const cluster = {
            has_cluster: true,
            audit_enabled: Boolean(radar.audit_enabled),
            cluster_type: radar.cluster_type || 'swarm',
            root_id: radar.root_id || '',
            viewed_conv_id: radar.viewed_conv_id || '',
            is_worker_view: Boolean(radar.is_worker_view),
            title: radar.title || '',
            member_count: Number(s.member_count) || 0,
            active_count: Number(s.active_count) || 0,
            working_count: Number(s.working_count) || 0,
            total_turns: Number(s.total_turns) || 0,
            overall_hit_rate: Number(s.overall_hit_rate) || 0,
            cache_bust_count: Number(s.cache_bust_count) || 0,
            cache_bust_tokens: Number(s.cache_bust_tokens) || 0,
            violation_count: Number(s.violation_count) || 0,
            warn_count: Number(s.warn_count) || 0,
          };
          data.cluster = cluster;
          data.swarm_meta = cluster;
        }
      } catch {}
    }
    reportCache.set(cacheKey, { report: data, fetchedAt: Date.now() });
    return data;
  } catch {
    return cached ? cached.report : null;
  }
}

export const CLIENT_UI_SCRIPT = String.raw`
(() => {
  const RING_ID = 'agy-input-context-ring-wrap';
  const TOP_BAR_ID = 'agy-top-telemetry-bar';
  const POPOVER_ID = 'agy-input-context-popover';
  const RESETS_POPOVER_ID = 'agy-resets-popover';
  const NEW_TAB_CARD_ID = 'new-tab-card-context-usage';
  const HIDE_STYLE_ID = 'agy-context-hide-styles';

  const ICONS = {
    speed: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
    ttft: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>',
    prefill: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
    cache: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/></svg>',
    ttl: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4"/><path d="M12 14v-4"/><circle cx="12" cy="13" r="8"/></svg>',
    bust: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    swarm: '<svg width="12.5" height="12.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><circle cx="5" cy="19" r="2"/><path d="m14.2 9.8 3.3-3.3"/><path d="M9.8 9.8 6.5 6.5"/><path d="m14.2 14.2 3.3 3.3"/><path d="m9.8 14.2-3.3 3.3"/></svg>',
    resets: '<svg viewBox="0 0 16 16" width="12.5" height="12.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"></circle><path d="M5.1 5.1a4.1 4.1 0 0 0 0 5.8M10.9 5.1a4.1 4.1 0 0 1 0 5.8"></path><path d="M2.9 2.9a7.2 7.2 0 0 0 0 10.2M13.1 2.9a7.2 7.2 0 0 1 0 10.2"></path></svg>',
    turn: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="m17 8-5-5-5 5"/><path d="m17 16-5 5-5-5"/></svg>',
    total: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>',
    panel: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/></svg>',
    arrow: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
    grid: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>'
  };

  const UI_I18N = {
    zh: {
      new_tab_card: '上下文与蜂群监控',
      tb_resets: '重置监视',
      tb_resets_tip: '官方配额重置监视与通知（仅手工刷新）',
      tb_ctx_toggle_tip: '点击展开/收起右侧上下文详情面板',
      tb_ctx_model_fallback: '当前模型',
      tb_ctx_word: '上下文',
      tb_ctx_phys: '（物理窗口 {lim}）',
      tb_ctx_hit: '缓存命中 {pct}%',
      tb_ctx_bust: '缓存崩塌 {n}次 ({tok})',
      tb_ctx_quota_prefix: '额度 ',
      tb_swarm_tip: '关联蜂群/子代理 {ratio} 在线{warn}（点击打开蜂群雷达）',
      tb_swarm_warn_part: ' · 含模型越级告警',
      eta_soon: '即将重置',
      eta_dh: '{d}d{h}h重置',
      eta_hm: '{h}h{m}m重置',
      eta_m: '{m}m重置',
      pool_google: 'Google 池: ',
      pool_3p: 'Claude/3P 池: ',
      pool_default_tip: '当前模型池剩余额度 {pct}%',
      ttl_warm_top: '保活 {t}',
      ttl_warm_pop: '保活 {t} / 3m',
      ttl_warm_tip: '缓存热保活期 (<3m)：剩余黄金窗口 {rem}',
      ttl_risk_ring: '濒危 {t}',
      ttl_risk_sub: '3-5m 易驱逐',
      ttl_risk_tip: '缓存 LRU 驱逐高危期 (3-5m)：空闲 {t}',
      ttl_cold_ring: '已冷',
      ttl_cold_top: '缓存已冷 {t}',
      ttl_cold_pop: '已冷 >5m (必重灌)',
      ttl_cold_tip: '超过 5 分钟硬 TTL：下次发话必全价重灌 ({t})',
      rp_title: '官方重置监视与通知',
      rp_close: '关闭',
      rp_tabs_aria: '重置数据源',
      rp_refresh: '刷新',
      rp_refreshing: '刷新中…',
      rp_btn_orig: '原文',
      rp_btn_trans: '译文',
      rp_tip_orig: '当前显示英文原文，点击切回中文校对译文',
      rp_tip_trans: '当前显示中文译文，点击切换查看英文原文',
      rp_synced_at: '上次刷新 {t}',
      rp_manual_only: '仅手工刷新',
      rp_scheduled: '官方已预告即将重置',
      rp_watch_signal: '重置苗头预警 ({lvl})',
      rp_refresh_failed: '手工刷新失败：{err}',
      rp_notice_busy: '正在手工刷新重置数据，请稍候…',
      rp_notice_timeout: '手工刷新超时，请稍后重试',
      rp_notice_synced: '✓ 已手工刷新最新官方重置记录',
      rp_err_no_resp: '请求无响应',
      rp_err_bridge: '桥接请求失败',
      rp_err_generic: '请求失败',
      rp_lbl_total: '累计重置',
      rp_lbl_days: '距上次',
      rp_lbl_avg: '平均间隔',
      rp_lbl_med: '中位 / 最长',
      rp_days_unit: '{d} 天',
      rp_latest_hdr: '最近一次官方重置',
      rp_empty_latest: '尚未手工刷新，点击右上角「刷新」拉取最新官方重置记录。',
      rp_view_post: '查看原帖 ↗',
      rp_site_src: '数据来源 ↗',
      rp_hist_title: '历次重置时间线',
      rp_hist_count: '共 {n} 条',
      rp_empty_hist: '暂无历史明细（仅显示本地缓存，点击右上角「刷新」可更新）。',
      pop_lbl_ttl: '缓存保活 (TTL)',
      pop_lbl_bust: '缓存崩塌',
      pop_bust_has: '{n} 次 ({tok})',
      pop_bust_zero: '0 次 (0)',
      pop_lbl_quota: '额度与重置',
      pop_lbl_cache: '缓存命中率',
      pop_sub_cache: '命中 {tok}',
      pop_lbl_speed: '输出速度',
      pop_sub_avg: '均值 {v}',
      pop_lbl_ttft: '首字延迟 (TTFT)',
      pop_lbl_prefill: '预填充吞吐',
      pop_sub_peak: '峰值 {v}',
      pop_lbl_out: '本轮 / 累计输出',
      pop_sub_out: '累计 {tok} ({n}轮)',
      pop_free: '距压缩剩余 {tok}',
      pop_native_lim: '模型物理 {tok}',
      pop_budget_lim: '动态上限 {tok}',
      pop_swarm_bust: '蜂群雷达 · {act}/{tot} 在线 · 崩塌 {bust}次',
      pop_swarm_ok: '蜂群雷达 · {act}/{tot} 在线 · {turns}轮',
      pop_open_panel: '打开上下文与单轮审查面板'
    },
    en: {
      new_tab_card: 'Context Usage',
      tb_resets: 'Reset Watch',
      tb_resets_tip: 'Official Quota Reset Watch (manual refresh only)',
      tb_ctx_toggle_tip: 'Click to toggle Context Usage panel',
      tb_ctx_model_fallback: 'Model',
      tb_ctx_word: 'Context',
      tb_ctx_phys: ' (native {lim})',
      tb_ctx_hit: 'Cache hit {pct}%',
      tb_ctx_bust: 'Cache bust {n}x ({tok})',
      tb_ctx_quota_prefix: 'Quota: ',
      tb_swarm_tip: 'Swarm / Subagents {ratio} active{warn} (click to open Swarm Radar)',
      tb_swarm_warn_part: ' · model audit alert',
      eta_soon: 'resetting',
      eta_dh: 'in {d}d{h}h',
      eta_hm: 'in {h}h{m}m',
      eta_m: 'in {m}m',
      pool_google: 'Google pool: ',
      pool_3p: 'Claude/3P pool: ',
      pool_default_tip: 'Remaining model pool quota: {pct}%',
      ttl_warm_top: 'Warm {t}',
      ttl_warm_pop: 'Warm {t} / 3m',
      ttl_warm_tip: 'Warm cache (<3m): {rem} left in safe window',
      ttl_risk_ring: 'Risk {t}',
      ttl_risk_sub: '3-5m eviction risk',
      ttl_risk_tip: 'Cache LRU eviction risk (3-5m): idle {t}',
      ttl_cold_ring: 'Cold',
      ttl_cold_top: 'Cold {t}',
      ttl_cold_pop: 'Cold >5m (re-prefill)',
      ttl_cold_tip: 'Past 5m hard TTL: next turn requires full re-prefill ({t})',
      rp_title: 'Official Quota Reset Watch',
      rp_close: 'Close',
      rp_tabs_aria: 'Reset tracker sources',
      rp_refresh: 'Refresh',
      rp_refreshing: 'Refreshing…',
      rp_btn_orig: 'EN',
      rp_btn_trans: 'ZH',
      rp_tip_orig: 'Showing original English post',
      rp_tip_trans: 'Switch original / translated text',
      rp_synced_at: 'Synced {t}',
      rp_manual_only: 'Manual refresh only',
      rp_scheduled: 'Scheduled Official Reset',
      rp_watch_signal: 'Reset Watch Signal ({lvl})',
      rp_refresh_failed: 'Refresh failed: {err}',
      rp_notice_busy: 'Refreshing reset data, please wait…',
      rp_notice_timeout: 'Refresh timed out, please try again',
      rp_notice_synced: '✓ Latest official reset records synced',
      rp_err_no_resp: 'No response received',
      rp_err_bridge: 'Bridge request failed',
      rp_err_generic: 'Request failed',
      rp_lbl_total: 'Total resets',
      rp_lbl_days: 'Since last',
      rp_lbl_avg: 'Avg interval',
      rp_lbl_med: 'Median / Max',
      rp_days_unit: '{d}d',
      rp_latest_hdr: 'Latest Official Reset',
      rp_empty_latest: 'Not synced yet. Click "Refresh" above to fetch the latest official reset records.',
      rp_view_post: 'View post ↗',
      rp_site_src: 'Tracker ↗',
      rp_hist_title: 'Reset Timeline',
      rp_hist_count: '{n} entries',
      rp_empty_hist: 'No cached history yet. Click "Refresh" above to update.',
      pop_lbl_ttl: 'Cache TTL',
      pop_lbl_bust: 'Cache bust',
      pop_bust_has: '{n}x ({tok})',
      pop_bust_zero: '0 (0)',
      pop_lbl_quota: 'Quota & reset',
      pop_lbl_cache: 'Cache hit',
      pop_sub_cache: '{tok} hit',
      pop_lbl_speed: 'Output speed',
      pop_sub_avg: 'avg {v}',
      pop_lbl_ttft: 'First token (TTFT)',
      pop_lbl_prefill: 'Prefill throughput',
      pop_sub_peak: 'peak {v}',
      pop_lbl_out: 'Last / Session out',
      pop_sub_out: 'Σ {tok} ({n}t)',
      pop_free: 'Free {tok}',
      pop_native_lim: 'Native {tok}',
      pop_budget_lim: 'Budget {tok}',
      pop_swarm_bust: 'Swarm Radar · {act}/{tot} active · {bust} busts',
      pop_swarm_ok: 'Swarm Radar · {act}/{tot} active · {turns}t',
      pop_open_panel: 'Open Context & Turn Inspector'
    }
  };

  function normalizeLangCode(raw) {
    const v = String(raw || '').trim().toLowerCase();
    if (v.startsWith('zh')) return 'zh';
    if (v.startsWith('en')) return 'en';
    return 'auto';
  }

  function detectHostLang() {
    try {
      const rootEl = document.documentElement;
      const exo = rootEl?.dataset?.agExoLang || rootEl?.getAttribute?.('data-ag-exo-lang') || '';
      const normExo = normalizeLangCode(exo);
      if (normExo === 'zh' || normExo === 'en') return normExo;
      if (window.__ANTIGRAVITY_CHINESE_LOCALIZATION__) return 'zh';
      const docLang = rootEl?.getAttribute?.('lang') || rootEl?.lang || '';
      if (/^zh\b/i.test(String(docLang).trim())) return 'zh';
      const navLang =
        (typeof navigator !== 'undefined' && navigator?.language) ||
        (typeof window !== 'undefined' && window.navigator?.language) ||
        '';
      if (/^zh\b/i.test(String(navLang).trim())) return 'zh';
    } catch (_) {}
    return 'en';
  }

  function resolveClientLang() {
    const r = window.__AGY_RING_DATA__;
    const cfg = normalizeLangCode(window.__AGY_CONFIG_LANG__ || (r && !r.error ? r.lang : '') || 'auto');
    if (cfg === 'zh' || cfg === 'en') return cfg;
    return detectHostLang();
  }

  function ct(key, vars, langOverride) {
    const lang = langOverride || resolveClientLang();
    const dict = UI_I18N[lang] || UI_I18N.en;
    let tmpl = dict[key] !== undefined ? dict[key] : (UI_I18N.en[key] || key);
    if (vars && typeof vars === 'object') {
      for (const [k, v] of Object.entries(vars)) {
        tmpl = tmpl.split('{' + k + '}').join(String(v ?? ''));
      }
    }
    return tmpl;
  }

  function broadcastLangToSidecarIframes() {
    const msg = {
      type: 'agy-context-host-lang',
      hostLang: detectHostLang(),
      configLang: window.__AGY_CONFIG_LANG__ || 'auto'
    };
    document.querySelectorAll('iframe[src*="desktop-context"], [data-sidecar-id="desktop-context/context"] iframe').forEach((ifr) => {
      try {
        ifr.contentWindow?.postMessage(msg, '*');
      } catch (_) {}
    });
  }

  if (!window.__AGY_LANG_MSG_BOUND__) {
    window.__AGY_LANG_MSG_BOUND__ = true;
    window.addEventListener('message', (ev) => {
      const d = ev && ev.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'agy-context-lang-changed' && d.lang) {
        window.__AGY_CONFIG_LANG__ = normalizeLangCode(d.lang);
        const pop = document.getElementById(POPOVER_ID);
        if (pop) pop.dataset.sig = '';
        if (window.__AGY_RING_RENDER__) window.__AGY_RING_RENDER__();
        renderResetsPopover();
      } else if (d.type === 'agy-context-query-host-lang') {
        broadcastLangToSidecarIframes();
      }
    });
  }

  function setHideStyles(hide) {
    let style = document.getElementById(HIDE_STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = HIDE_STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = hide
      ? '[data-tab-id="sidecar__desktop-context/context__/"], #' + NEW_TAB_CARD_ID + ', #' + RING_ID + ' { display: none !important; }'
      : '';
  }

  function getActiveConvId() {
    try {
      if (window.__TSR_ROUTER__?.state) {
        const matches = window.__TSR_ROUTER__.state.matches || [];
        for (let i = matches.length - 1; i >= 0; i--) {
          const cid = matches[i]?.params?.cascadeId || matches[i]?.params?.conversationId;
          if (cid) return cid;
        }
        const pathname = window.__TSR_ROUTER__.state.location?.pathname || '';
        const parts = pathname.split('/');
        const idx = parts.indexOf('c');
        if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
      }
      const mainChat = document.querySelector('div:not([data-testid="conversation-row-sidebar"])[data-cascade-id]');
      if (mainChat?.getAttribute('data-cascade-id')) return mainChat.getAttribute('data-cascade-id');
      const selRow = document.querySelector('[data-selected="true"][data-cascade-id]');
      if (selRow?.getAttribute('data-cascade-id')) return selRow.getAttribute('data-cascade-id');
      const m = window.location.pathname.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (m) return m[0];
    } catch (_) {}
    return '';
  }

  window.__AGY_GET_CONV_ID__ = getActiveConvId;

  function getReactInternals() {
    if (window.__AGY_REDUX_STORE__ && window.__AGY_FEAT_CTX__) {
      return {
        store: window.__AGY_REDUX_STORE__,
        featCtx: window.__AGY_FEAT_CTX__,
        iframeCtx: window.__AGY_IFRAME_CTX__ || null
      };
    }
    try {
      const root = document.getElementById('root') || document.body.firstElementChild;
      if (!root) {
        return {
          store: window.__AGY_REDUX_STORE__ || null,
          featCtx: window.__AGY_FEAT_CTX__ || null,
          iframeCtx: window.__AGY_IFRAME_CTX__ || null
        };
      }
      const fiberKey = Object.keys(root).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$'));
      if (!fiberKey) {
        return {
          store: window.__AGY_REDUX_STORE__ || null,
          featCtx: window.__AGY_FEAT_CTX__ || null,
          iframeCtx: window.__AGY_IFRAME_CTX__ || null
        };
      }
      const queue = [root[fiberKey]];
      const visited = new Set();
      while (queue.length) {
        const f = queue.shift();
        if (!f || visited.has(f)) continue;
        visited.add(f);
        const val = f.memoizedProps?.value;
        if (val && typeof val === 'object') {
          if (val.store?.dispatch && !window.__AGY_REDUX_STORE__) {
            window.__AGY_REDUX_STORE__ = val.store;
          }
          if (
            typeof val.get === 'function' &&
            typeof val.getBaseline === 'function' &&
            Array.isArray(val.featureNames) &&
            val.featureNames.length > 0 &&
            !window.__AGY_FEAT_CTX__
          ) {
            window.__AGY_FEAT_CTX__ = val;
          }
          if (
            typeof val.setIframeSrc === 'function' &&
            typeof val.registerPlaceholder === 'function' &&
            !window.__AGY_IFRAME_CTX__
          ) {
            window.__AGY_IFRAME_CTX__ = val;
          }
        }
        if (window.__AGY_REDUX_STORE__ && window.__AGY_FEAT_CTX__ && window.__AGY_IFRAME_CTX__) {
          break;
        }
        if (f.child) queue.push(f.child);
        if (f.sibling) queue.push(f.sibling);
      }
    } catch (_) {}
    return {
      store: window.__AGY_REDUX_STORE__ || null,
      featCtx: window.__AGY_FEAT_CTX__ || null,
      iframeCtx: window.__AGY_IFRAME_CTX__ || null
    };
  }

  function findDesktopContextSidecarUrl(store, featCtx) {
    const slot = document.querySelector('[data-sidecar-id="desktop-context/context"]');
    if (slot?.getAttribute('data-sidecar-url')) {
      return slot.getAttribute('data-sidecar-url').split('&conversationId=')[0].split('?conversationId=')[0];
    }
    const iframe = document.querySelector('iframe[src*="desktop-context"]');
    if (iframe?.src) {
      return iframe.src.split('&conversationId=')[0].split('?conversationId=')[0];
    }
    try {
      const ext = featCtx?.get?.('extensibility');
      const sidecars = ext?.provider?.getState?.();
      if (Array.isArray(sidecars)) {
        const sc = sidecars.find(
          (d) => d?.sidecarId === 'desktop-context/context' || (d?.sidecarId || '').endsWith('/context')
        );
        if (sc?.baseUrl) {
          const resolved =
            typeof ext.resolveSidecarUrl === 'function'
              ? ext.resolveSidecarUrl(sc.baseUrl, '/')
              : sc.baseUrl;
          if (resolved) {
            return resolved.split('&conversationId=')[0].split('?conversationId=')[0];
          }
        }
      }
    } catch (_) {}
    try {
      const st = store?.getState?.();
      const panes = [
        ...Object.values(st?.sidePanelV2?.conversationPanes || {}),
        ...Object.values(st?.sidePanelV2?.newConversationPanes || {}),
        ...Object.values(st?.sidePanelV2?.customViewPanes || {}),
        ...(st?.sidePanelV2?.homePane ? [st.sidePanelV2.homePane] : []),
        ...Object.values(st?.sidePanel?.conversationPanes || {}),
        ...Object.values(st?.sidePanel?.newConversationPanes || {}),
        ...Object.values(st?.sidePanel?.customViewPanes || {}),
        ...(st?.sidePanel?.homePane ? [st.sidePanel.homePane] : []),
        ...Object.values(st?.auxPaneV2?.conversationPanes || {}),
        ...Object.values(st?.auxPaneV2?.newConversationPanes || {})
      ];
      for (const p of panes) {
        for (const t of p?.tabs || []) {
          const sv = t?.content?.sidecarView;
          const url = sv?.url;
          if (url && (url.includes('desktop-context') || sv?.sidecarId === 'desktop-context/context')) {
            return url.split('&conversationId=')[0].split('?conversationId=')[0];
          }
        }
      }
    } catch (_) {}
    return '';
  }

  function buildPanelScope(convId) {
    const search = window.__TSR_ROUTER__?.state?.location?.search || {};
    let projOrSec = search.project || search.section;
    if (!projOrSec) {
      try {
        const sp = new URLSearchParams(window.location.search || '');
        projOrSec = sp.get('project') || sp.get('section') || '';
      } catch (_) {}
    }
    return convId
      ? { kind: 'cascadeId', cascadeId: convId }
      : projOrSec
        ? { kind: 'newConversation', projectId: projOrSec, sectionId: projOrSec }
        : { kind: 'home' };
  }

  function getPaneForScope(sliceState, scope) {
    if (!sliceState || !scope) return null;
    if (scope.kind === 'cascadeId') return sliceState.conversationPanes?.[scope.cascadeId] || null;
    if (scope.kind === 'newConversation') return sliceState.newConversationPanes?.[scope.projectId] || null;
    if (scope.kind === 'customView') return sliceState.customViewPanes?.[scope.viewId] || null;
    return sliceState.homePane || null;
  }

  function safeDispatch(store, action) {
    if (!store || typeof store.dispatch !== 'function') return false;
    try {
      store.dispatch(action);
      return true;
    } catch (_) {
      return false;
    }
  }

  function notifySidecarTab(targetTab, convId) {
    const hostLang = detectHostLang();
    const configLang = window.__AGY_CONFIG_LANG__ || 'auto';
    const msg = {
      type: 'agy-context-switch-tab',
      tab: targetTab || '',
      conversationId: convId || '',
      hostLang,
      configLang
    };
    const broadcast = () => {
      document.querySelectorAll('iframe[src*="desktop-context"], [data-sidecar-id="desktop-context/context"] iframe').forEach((ifr) => {
        try {
          ifr.contentWindow?.postMessage(msg, '*');
        } catch (_) {}
      });
    };
    broadcast();
    setTimeout(broadcast, 160);
    setTimeout(broadcast, 420);
    setTimeout(broadcast, 850);
  }

  function openContextSidecar(targetTab) {
    try {
      const { store, featCtx, iframeCtx } = getReactInternals();
      const convId = getActiveConvId();
      const panelScope = buildPanelScope(convId);
      const sidecarUrl = findDesktopContextSidecarUrl(store, featCtx);
      const tabId = 'sidecar__desktop-context/context__/';

      if (iframeCtx?.setIframeSrc && sidecarUrl) {
        try {
          let fullUrl = convId
            ? (sidecarUrl.includes('?') ? sidecarUrl + '&conversationId=' + convId : sidecarUrl + '?conversationId=' + convId)
            : sidecarUrl;
          if (targetTab) {
            fullUrl += (fullUrl.includes('?') ? '&' : '?') + 'view=' + encodeURIComponent(targetTab);
          }
          iframeCtx.setIframeSrc(fullUrl, fullUrl);
        } catch (_) {}
      }

      let dispatchedViaStore = false;
      if (store) {
        const st = typeof store.getState === 'function' ? store.getState() : null;
        const hasV2 = !st || st.sidePanelV2 !== undefined;
        const hasV1 = !st || st.sidePanel !== undefined;
        const hasLegacyAuxV2 = !st || st.auxPaneV2 !== undefined;
        const hasLegacyAux = !st || st.auxPane !== undefined;

        // Dual-key payload: panelScope (Antigravity v2.33.0+) + treeId (legacy v2.0-v2.32)
        const scopeFields = { panelScope, treeId: panelScope };
        const content = {
          type: 'sidecarView',
          sidecarView: {
            sidecarId: 'desktop-context/context',
            path: '/',
            url: sidecarUrl || '',
            title: 'Context Usage',
            ...(targetTab ? { queryParams: { view: targetTab } } : {})
          }
        };
        const setPayload = {
          ...scopeFields,
          content,
          tabId,
          keepOpen: true
        };

        const currentPaneHasTab = Boolean(
          [getPaneForScope(st?.sidePanelV2, panelScope), getPaneForScope(st?.sidePanel, panelScope)].some(
            (p) => Array.isArray(p?.tabs) && p.tabs.some((t) => t?.id === tabId)
          )
        );
        const shouldSetContent = Boolean(sidecarUrl) || !currentPaneHasTab;

        // Antigravity 2.0+ (sidePanelV2 & sidePanel)
        if (hasV2) {
          if (shouldSetContent && safeDispatch(store, { type: 'sidePanelV2/setContent', payload: setPayload })) {
            dispatchedViaStore = true;
          }
          if (safeDispatch(store, { type: 'sidePanelV2/setActiveTab', payload: { ...scopeFields, tabId } })) {
            dispatchedViaStore = true;
          }
        }
        if (hasV1) {
          if (shouldSetContent && safeDispatch(store, { type: 'sidePanel/setContent', payload: setPayload })) {
            dispatchedViaStore = true;
          }
          if (safeDispatch(store, { type: 'sidePanel/setActiveTab', payload: { ...scopeFields, tabId } })) {
            dispatchedViaStore = true;
          }
          if (safeDispatch(store, { type: 'sidePanel/setSidePanelOpen', payload: { ...scopeFields, isOpen: true } })) {
            dispatchedViaStore = true;
          }
        }

        // If inside a subagent conversation, also open the root conversation's side panel
        if (convId && hasV1) {
          try {
            const summaries = st?.trajectorySummaries?.summaries;
            let rootId = convId;
            const seen = new Set([rootId]);
            let parentId = summaries?.[rootId]?.trajectoryMetadata?.parentConversationId;
            while (parentId && !seen.has(parentId)) {
              seen.add(parentId);
              rootId = parentId;
              parentId = summaries?.[rootId]?.trajectoryMetadata?.parentConversationId;
            }
            if (rootId && rootId !== convId) {
              const rootScope = { kind: 'cascadeId', cascadeId: rootId };
              safeDispatch(store, {
                type: 'sidePanel/setSidePanelOpen',
                payload: { panelScope: rootScope, treeId: rootScope, isOpen: true }
              });
            }
          } catch (_) {}
        }

        // Legacy Antigravity (auxPaneV2 & auxPane)
        if (hasLegacyAuxV2 && shouldSetContent) {
          if (safeDispatch(store, { type: 'auxPaneV2/setContent', payload: setPayload })) {
            dispatchedViaStore = true;
          }
        }
        if (hasLegacyAux) {
          if (safeDispatch(store, { type: 'auxPane/setAuxPaneOpen', payload: { ...scopeFields, isOpen: true } })) {
            dispatchedViaStore = true;
          }
        }

        if (dispatchedViaStore) {
          try {
            if (window.__TSR_ROUTER__?.navigate) {
              window.__TSR_ROUTER__.navigate({
                search: (prev) => ({ ...prev, tab: tabId }),
                replace: true
              });
            }
          } catch (_) {}
          if (targetTab) notifySidecarTab(targetTab, convId);
          return;
        }
      }

      const existingTab = document.querySelector('[data-tab-id="sidecar__desktop-context/context__/"]');
      const toggleAuxBtn = document.querySelector('[data-testid="toggle-aux-sidebar"]');
      if (existingTab) {
        const rect = existingTab.getBoundingClientRect();
        if (rect.left >= window.innerWidth - 20 && toggleAuxBtn) {
          toggleAuxBtn.click();
        }
        existingTab.click();
        if (targetTab) notifySidecarTab(targetTab, convId);
        return;
      }
      if (toggleAuxBtn) toggleAuxBtn.click();
      if (targetTab) notifySidecarTab(targetTab, convId);
    } catch (_) {}
  }

  window.__AGY_OPEN_CONTEXT_SIDECAR__ = openContextSidecar;

  function isContextSidecarActiveAndVisible() {
    const tab = document.querySelector('[data-tab-id="sidecar__desktop-context/context__/"]');
    if (!tab) return false;
    const rect = tab.getBoundingClientRect();
    if (rect.width <= 0 || rect.left >= window.innerWidth - 10) return false;
    const isSelected =
      tab.getAttribute('aria-selected') === 'true' ||
      tab.getAttribute('data-selected') === 'true' ||
      tab.getAttribute('data-state') === 'active' ||
      tab.classList.contains('bg-secondary') ||
      Boolean(document.querySelector('iframe[src*="desktop-context"]')?.offsetParent);
    return isSelected;
  }

  function closeContextSidecar() {
    try {
      const { store } = getReactInternals();
      const convId = getActiveConvId();
      const panelScope = buildPanelScope(convId);
      let closedViaStore = false;
      if (store) {
        const st = typeof store.getState === 'function' ? store.getState() : null;
        const payload = { panelScope, treeId: panelScope, isOpen: false };
        if (!st || st.sidePanel !== undefined) {
          if (safeDispatch(store, { type: 'sidePanel/setSidePanelOpen', payload })) {
            closedViaStore = true;
          }
        }
        if (!st || st.auxPane !== undefined) {
          if (safeDispatch(store, { type: 'auxPane/setAuxPaneOpen', payload })) {
            closedViaStore = true;
          }
        }
      }
      if (!closedViaStore) {
        const toggleAuxBtn = document.querySelector('[data-testid="toggle-aux-sidebar"]');
        const iframe = document.querySelector('iframe[src*="desktop-context"]');
        if (iframe && iframe.getBoundingClientRect().width > 20 && toggleAuxBtn) {
          toggleAuxBtn.click();
        }
      }
    } catch (_) {}
  }

  function toggleContextSidecar(targetTab) {
    const wantTab = targetTab || 'single';
    const lastTab = window.__AGY_LAST_SIDECAR_TAB__ || 'single';
    if (isContextSidecarActiveAndVisible() && lastTab === wantTab) {
      closeContextSidecar();
      return;
    }
    window.__AGY_LAST_SIDECAR_TAB__ = wantTab;
    openContextSidecar(wantTab);
  }

  window.__AGY_TOGGLE_CONTEXT_SIDECAR__ = toggleContextSidecar;

  function ensureAuxNewTabEntry() {
    const newTabView = document.querySelector('[data-testid="side-panel-new-tab-view"], [data-testid="aux-pane-new-tab-view"]');
    if (!newTabView) return;
    const cardLabelText = ct('new_tab_card');
    let btn = document.getElementById(NEW_TAB_CARD_ID);
    if (btn) {
      btn.style.display = '';
      const lbl = btn.querySelector('#agy-new-tab-card-label');
      if (lbl) lbl.textContent = cardLabelText;
      return;
    }

    const previewCard =
      newTabView.querySelector('[data-testid="new-tab-card-new-preview"]') ||
      newTabView.querySelector('[data-testid^="new-tab-card-"]');
    if (!previewCard || !previewCard.parentElement) return;

    btn = document.createElement('button');
    btn.id = NEW_TAB_CARD_ID;
    btn.type = 'button';
    btn.setAttribute('data-testid', NEW_TAB_CARD_ID);
    btn.className = previewCard.className;
    btn.innerHTML =
      '<span class="shrink-0 flex items-center">' +
      ICONS.grid +
      '</span><span id="agy-new-tab-card-label">' + cardLabelText + '</span>';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (window.__AGY_OPEN_CONTEXT_SIDECAR__) {
        window.__AGY_OPEN_CONTEXT_SIDECAR__();
      } else {
        openContextSidecar();
      }
    });
    previewCard.parentElement.appendChild(btn);
  }

  function fmtTok(n) {
    if (!n || n <= 0) return '0';
    if (n >= 1e6) {
      const v = n / 1e6;
      return Number.isInteger(v) ? v + 'M' : v.toFixed(1) + 'M';
    }
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(n);
  }

  function fmtTokCompact(n) {
    if (!n || n <= 0) return '0';
    if (n >= 1e6) {
      const v = n / 1e6;
      return (v >= 10 || Number.isInteger(v)) ? Math.round(v) + 'M' : v.toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (n >= 10000) return Math.round(n / 1000) + 'k';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  function fmtSec(ms) {
    if (!ms || ms <= 0) return '0.00s';
    if (ms < 1000) return ms + 'ms';
    return (ms / 1000).toFixed(2) + 's';
  }

  function findInputToolbar() {
    // 1. Locate the composer card
    const composer =
      document.getElementById('antigravity.agentSidePanelInputBox') ||
      document.querySelector('.surface-composer-card, [class*="surface-composer"]') ||
      document.querySelector('[data-testid="agent-input-box"], [data-testid="composer"]') ||
      document.querySelector('form:has(textarea), form:has([contenteditable])');

    // 2. Look specifically for the bottom action bar / footer inside composer
    const footer =
      composer?.querySelector('.agy-composer-footer, [class*="agy-composer-footer"], [class*="input-footer"]') ||
      document.querySelector('.agy-composer-footer, [class*="agy-composer-footer"], [class*="input-footer"]');

    if (footer) {
      // Locate the right-hand actions group inside the footer, excluding our own injected ring wrapper
      const nonRingChildren = Array.from(footer.children || []).filter((c) => c && c.id !== RING_ID);
      const rightGroup =
        footer.querySelector(':scope > div.shrink-0') ||
        (nonRingChildren.length > 1 ? nonRingChildren[nonRingChildren.length - 1] : null) ||
        footer;

      // Find the send / cancel / voice / mic action element inside rightGroup
      const actionEl =
        rightGroup.querySelector(
          '[data-testid="voice-live-pill"], [data-testid="voice-pill"], [data-testid="voice-start-button"], [data-testid="voice-end-button"], ' +
          '[data-testid^="send-button"], .agy-send-button, [data-tooltip-id*="send-button"], ' +
          'button[aria-label*="Cancel"], button[aria-label*="Send"], button[aria-label*="send"], button[aria-label*="Voice"], button[aria-label*="Live"], button[aria-label*="Record"]'
        ) ||
        (() => {
          const btns = Array.from(rightGroup.querySelectorAll('button:not(#agy-ring-btn):not(#agy-open-sidecar-btn):not(#agy-open-swarm-btn)'));
          return btns.length ? btns[btns.length - 1] : null;
        })();

      if (actionEl) {
        // Walk up to the direct child of rightGroup so we never inject inside a nested pill (like voice-live-pill)
        let anchor = actionEl;
        while (anchor && anchor.parentElement && anchor.parentElement !== rightGroup) {
          anchor = anchor.parentElement;
        }
        if (anchor && anchor.parentElement === rightGroup && anchor.id !== RING_ID) {
          return { mode: 'toolbar', container: rightGroup, anchorBtn: anchor };
        }
      }

      if (rightGroup) {
        return { mode: 'toolbar', container: rightGroup, anchorBtn: null };
      }
    }

    // 3. Fallback: traverse upwards from textarea, strictly excluding attachment, preview, and voice pill wrappers
    const candidates = [
      ...document.querySelectorAll('textarea'),
      ...document.querySelectorAll('[contenteditable="true"]'),
      ...document.querySelectorAll('[role="textbox"]')
    ].filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 180 && rect.height > 18 && rect.bottom > window.innerHeight * 0.35;
    });

    if (!candidates.length) return null;
    const inputEl = candidates[candidates.length - 1];
    const composerCard =
      inputEl.closest('.surface-composer-card, [class*="surface-composer"], [class*="composer"], form') ||
      inputEl.parentElement?.parentElement;

    if (composerCard) {
      const validBtns = Array.from(composerCard.querySelectorAll('button:not(#agy-ring-btn):not(#agy-open-sidecar-btn):not(#agy-open-swarm-btn)'))
        .filter((btn) => {
          const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
          const title = (btn.getAttribute('title') || '').toLowerCase();
          if (aria.includes('remove') || aria.includes('delete') || aria.includes('close') || aria.includes('clear')) return false;
          if (title.includes('remove') || title.includes('delete') || title.includes('close') || title.includes('clear')) return false;
          if (btn.closest('[class*="attachment"], [class*="preview"], [class*="thumbnail"], [class*="pill"], [class*="chip"]')) return false;
          return true;
        });

      if (validBtns.length > 0) {
        let anchor = validBtns[validBtns.length - 1];
        while (
          anchor.parentElement &&
          anchor.parentElement !== composerCard &&
          (anchor.parentElement.matches?.('[data-testid*="voice"], [role="group"], span') ||
            (anchor.parentElement.className && String(anchor.parentElement.className).includes('rounded-full')))
        ) {
          anchor = anchor.parentElement;
        }
        return { mode: 'toolbar', container: anchor.parentElement, anchorBtn: anchor };
      }
    }

    return { mode: 'box', container: inputEl.parentElement };
  }

  function ringColor(pct) {
    if (pct >= 80) return '#ef4444';
    if (pct >= 55) return '#f59e0b';
    return '#10b981';
  }

  const SEG_COLORS = ['#9aa0a6', '#a8c7fa', '#4c8df6', '#f9ab00', '#c58af9'];

  function fmtMmSs(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    if (s >= 3600) {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      return h + 'h' + String(m).padStart(2, '0') + 'm';
    }
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return String(m).padStart(2, '0') + ':' + String(rem).padStart(2, '0');
  }

  function fmtResetEta(resetTime) {
    if (!resetTime) return '';
    const ts = Date.parse(resetTime);
    if (!Number.isFinite(ts)) return '';
    const diffSec = Math.max(0, Math.floor((ts - Date.now()) / 1000));
    if (diffSec <= 0) return ct('eta_soon');
    const d = Math.floor(diffSec / 86400);
    const h = Math.floor((diffSec % 86400) / 3600);
    const m = Math.floor((diffSec % 3600) / 60);
    if (d >= 1) return ct('eta_dh', { d, h });
    if (h >= 1) return ct('eta_hm', { h, m: String(m).padStart(2, '0') });
    return ct('eta_m', { m: Math.max(1, m) });
  }

  function computeQuotaInfo(quota) {
    if (!quota || quota.remaining_pct == null) return null;
    const pct = Math.round(Number(quota.remaining_pct));
    const eta = fmtResetEta(quota.reset_time);
    let state = 'ok';
    if (pct <= 10) state = 'bad';
    else if (pct <= 25) state = 'warn';
    const tips = [];
    if (quota.google) {
      const gTime = quota.google.reset_time ? new Date(quota.google.reset_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      tips.push(ct('pool_google') + Math.round(quota.google.remaining_pct) + '% (' + fmtResetEta(quota.google.reset_time) + (gTime ? ' / ' + gTime : '') + ')');
    }
    if (quota.third_party) {
      tips.push(ct('pool_3p') + Math.round(quota.third_party.remaining_pct) + '% (' + fmtResetEta(quota.third_party.reset_time) + ')');
    }
    return {
      pct,
      eta,
      state,
      pillText: pct + '%' + (eta ? ' · ' + eta : ''),
      title: tips.join(' | ') || ct('pool_default_tip', { pct })
    };
  }

  function findTopTitlebarToolbar() {
    const toolbars = Array.from(document.querySelectorAll('[data-testid="pane-titlebar-toolbar"]'));
    for (const tb of toolbars) {
      const rect = tb.getBoundingClientRect();
      if (rect.height >= 20 && rect.top >= 0 && rect.top <= 70 && rect.width >= 30) {
        if (!tb.closest('[data-testid="aux-sidebar"], [class*="aux-sidebar"]')) {
          return tb;
        }
      }
    }
    return toolbars[0] || null;
  }

  function computeTtlInfo(lastTurnAt) {
    if (!lastTurnAt) return null;
    const ts = Date.parse(lastTurnAt);
    if (!Number.isFinite(ts)) return null;
    const idleSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    const tStr = fmtMmSs(idleSec);
    if (idleSec < 180) {
      const remStr = fmtMmSs(180 - idleSec);
      return {
        state: 'warm',
        idleSec,
        color: '#10b981',
        ringText: tStr,
        topText: ct('ttl_warm_top', { t: tStr }),
        popVal: ct('ttl_warm_pop', { t: tStr }),
        popSub: 'TTL ' + remStr,
        title: ct('ttl_warm_tip', { rem: remStr })
      };
    }
    if (idleSec < 300) {
      const riskTxt = ct('ttl_risk_ring', { t: tStr });
      return {
        state: 'risk',
        idleSec,
        color: '#f59e0b',
        ringText: riskTxt,
        topText: riskTxt,
        popVal: riskTxt,
        popSub: ct('ttl_risk_sub'),
        title: ct('ttl_risk_tip', { t: tStr })
      };
    }
    return {
      state: 'cold',
      idleSec,
      color: '#ef4444',
      ringText: ct('ttl_cold_ring'),
      topText: ct('ttl_cold_top', { t: tStr }),
      popVal: ct('ttl_cold_pop'),
      popSub: tStr,
      title: ct('ttl_cold_tip', { t: tStr })
    };
  }

  const RESET_SOURCES_META = {
    agy: { key: 'agy', label: 'Gemini (AGY)', siteUrl: 'https://agyresets.com/' },
    codex: { key: 'codex', label: 'Codex', siteUrl: 'https://codex-resets.com/' },
    claude: { key: 'claude', label: 'Claude', siteUrl: 'https://clauderesets.com/' }
  };

  const RESET_TAG_ZH = {
    all: '全员',
    paid: '付费方案',
    product_release: '产品发布',
    model_launch: '新模型上线',
    load: '高负载',
    incident: '故障修复',
    backlash: '社区反馈',
    weekly: '周配额',
    rate_limit: '速率限制',
    banked: '储存重置',
    usage_reset: '用量重置',
    elevated: '升温预警',
    strong: '强预警',
    promise: '官方预告',
    gemini: 'Gemini',
    argon: 'Argon',
    five_hour: '5小时窗口'
  };

  const RESET_TAG_EN = {
    all: 'all',
    paid: 'paid',
    product_release: 'product release',
    model_launch: 'model launch',
    load: 'high load',
    incident: 'incident',
    backlash: 'feedback',
    weekly: 'weekly',
    rate_limit: 'rate limit',
    banked: 'banked',
    usage_reset: 'usage reset',
    elevated: 'elevated',
    strong: 'strong',
    promise: 'scheduled',
    gemini: 'Gemini',
    argon: 'Argon',
    five_hour: '5-hour'
  };

  const ALLOWED_EXT_HOSTS = {
    'agyresets.com': true,
    'codex-resets.com': true,
    'clauderesets.com': true,
    'x.com': true,
    'twitter.com': true,
    'openai.com': true,
    'status.openai.com': true,
    'anthropic.com': true,
    'status.anthropic.com': true
  };

  if (!window.__AGY_RESETS_UI_STATE__) {
    window.__AGY_RESETS_UI_STATE__ = {
      activeSource: 'agy',
      showOriginal: false,
      busy: false,
      busyTimer: null,
      notice: null
    };
  }

  function safeExtUrl(raw) {
    if (!raw || typeof raw !== 'string') return '';
    try {
      const u = new URL(raw);
      if (u.protocol !== 'https:') return '';
      const h = u.hostname.toLowerCase().replace(/^www\./, '');
      return ALLOWED_EXT_HOSTS[h] ? u.toString() : '';
    } catch (_) {
      return '';
    }
  }

  function fmtResetTag(tag, useEnglish) {
    const raw = String(tag || '').trim();
    if (!raw) return '';
    const k = raw.toLowerCase();
    if (useEnglish) return RESET_TAG_EN[k] || raw.replace(/_/g, ' ');
    return RESET_TAG_ZH[k] || raw;
  }

  function getResetItemText(item, useEnglish) {
    if (!item || typeof item !== 'object') return '';
    if (!useEnglish && item.textZh) return String(item.textZh);
    return String(item.text || '');
  }

  function fmtResetDate(isoStr) {
    if (!isoStr) return '—';
    const ts = Date.parse(isoStr);
    if (!Number.isFinite(ts)) return String(isoStr);
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function computeSinceLastDays(st, lr) {
    const refIso = (st && st.lastResetAt) || (lr && lr.announcedAt) || '';
    if (refIso) {
      const ts = Date.parse(refIso);
      if (Number.isFinite(ts) && ts <= Date.now()) {
        const days = Math.max(0, Math.round(((Date.now() - ts) / 86400000) * 10) / 10);
        return ct('rp_days_unit', { d: days });
      }
    }
    if (st && typeof st.daysSinceLast === 'number') {
      return ct('rp_days_unit', { d: st.daysSinceLast });
    }
    return '—';
  }

  function ensureStyles() {
    let style = document.getElementById('agy-input-ring-styles');
    if (!style) {
      style = document.createElement('style');
      style.id = 'agy-input-ring-styles';
      document.head.appendChild(style);
    }
    style.textContent = [
      '#' + TOP_BAR_ID + ' { display: inline-flex; align-items: center; gap: 5px; margin-right: 6px; padding-right: 2px; -webkit-app-region: no-drag; app-region: no-drag; pointer-events: auto; font-family: -apple-system, BlinkMacSystemFont, "Inter", "PingFang SC", sans-serif; z-index: 40; max-width: clamp(180px, 52vw, 520px); overflow: hidden; }',
      '.agy-tb-pill { display: inline-flex; align-items: center; gap: 4.5px; height: 22px; padding: 0 7.5px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--foreground, #666) 13%, transparent); background: color-mix(in srgb, var(--foreground, #888) 5%, transparent); color: var(--secondary-foreground, var(--foreground, #374151)); font-size: 11px; font-weight: 500; font-variant-numeric: tabular-nums; white-space: nowrap; cursor: pointer; user-select: none; transition: background 0.14s ease, border-color 0.14s ease, transform 0.08s ease; line-height: 1; -webkit-app-region: no-drag; app-region: no-drag; }',
      '.agy-tb-pill:hover, .agy-tb-pill.active { background: color-mix(in srgb, var(--foreground, #888) 12%, transparent); border-color: color-mix(in srgb, var(--foreground, #666) 26%, transparent); color: var(--foreground, #111827); }',
      '.agy-tb-pill:active, .agy-tb-pill[data-pressed="true"] { transform: scale(0.95); }',
      '.agy-tb-bust-dot { width: 5px; height: 5px; border-radius: 50%; flex: none; background: #f59e0b; }',
      '.agy-tb-bust-dot.severe { background: #ef4444; }',
      '.agy-tb-ctx-ttl { display: inline-flex; align-items: center; gap: 4px; margin-left: 2px; padding-left: 6px; border-left: 1px solid color-mix(in srgb, var(--foreground, #888) 18%, transparent); font-size: 10.8px; font-variant-numeric: tabular-nums; }',
      '.agy-tb-ctx-ttl.warm { color: #059669; }',
      '.dark .agy-tb-ctx-ttl.warm { color: #34d399; }',
      '.agy-tb-ctx-ttl.risk { color: #d97706; }',
      '.dark .agy-tb-ctx-ttl.risk { color: #fbbf24; }',
      '.agy-tb-ctx-ttl.cold { color: color-mix(in srgb, #ef4444 55%, var(--muted-foreground, #9ca3af)); }',
      '.agy-tb-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; background: currentColor; }',
      '.agy-tb-pill.swarm { background: rgba(59, 130, 246, 0.11); border-color: rgba(59, 130, 246, 0.30); color: #2563eb; padding: 0 7px; gap: 4px; }',
      '.dark .agy-tb-pill.swarm { color: #60a5fa; background: rgba(59, 130, 246, 0.16); }',
      '.agy-tb-pill.swarm:hover { background: rgba(59, 130, 246, 0.20); }',
      '.agy-tb-pill.swarm.swarm-warn { border-color: rgba(245, 158, 11, 0.72); box-shadow: inset 0 0 0 0.5px rgba(245, 158, 11, 0.35); }',
      '.agy-tb-resets-icon { display: inline-flex; align-items: center; justify-content: center; color: #3b82f6; flex: none; }',
      '.dark .agy-tb-resets-icon { color: #60a5fa; }',
      '#agy-tb-resets[data-busy="true"] .agy-tb-resets-icon svg { animation: agy-resets-pulse 0.8s ease-in-out infinite alternate; }',
      '@keyframes agy-resets-pulse { 0% { transform: scale(0.86); opacity: 0.55; } 100% { transform: scale(1.1); opacity: 1; } }',
      '#' + RESETS_POPOVER_ID + ' { position: fixed; width: 446px; max-width: calc(100vw - 24px); max-height: min(76vh, 580px); border-radius: 12px; background: var(--popover, var(--background, #ffffff)); color: var(--popover-foreground, var(--foreground, #1f2937)); border: 1px solid color-mix(in srgb, var(--foreground, #888) 16%, transparent); box-shadow: 0 14px 36px rgba(0,0,0,0.18); backdrop-filter: blur(18px); font-family: -apple-system, BlinkMacSystemFont, "Inter", "PingFang SC", sans-serif; font-size: 12px; line-height: 1.4; z-index: 100000; display: none; flex-direction: column; overflow: hidden; text-align: left; -webkit-app-region: no-drag; app-region: no-drag; pointer-events: auto; }',
      '.dark #' + RESETS_POPOVER_ID + ' { box-shadow: 0 16px 42px rgba(0,0,0,0.52); border-color: rgba(255,255,255,0.12); }',
      '#' + RESETS_POPOVER_ID + '.open { display: flex; }',
      '.agy-rp-hdr { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; border-bottom: 1px solid color-mix(in srgb, var(--foreground, #888) 11%, transparent); flex: none; }',
      '.agy-rp-title { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: var(--foreground, #111827); }',
      '.agy-rp-hdr-actions { display: inline-flex; align-items: center; gap: 5px; }',
      '.agy-rp-btn { height: 22px; padding: 0 8px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--foreground, #888) 16%, transparent); background: color-mix(in srgb, var(--foreground, #888) 5%, transparent); color: var(--secondary-foreground, var(--foreground, #374151)); font-size: 11px; font-weight: 500; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease; white-space: nowrap; }',
      '.agy-rp-btn:hover { background: color-mix(in srgb, var(--foreground, #888) 12%, transparent); color: var(--foreground, #111827); }',
      '.agy-rp-btn.active, .agy-rp-btn.primary { background: rgba(59, 130, 246, 0.12); border-color: rgba(59, 130, 246, 0.34); color: #2563eb; }',
      '.dark .agy-rp-btn.active, .dark .agy-rp-btn.primary { background: rgba(59, 130, 246, 0.18); border-color: rgba(59, 130, 246, 0.42); color: #60a5fa; }',
      '.agy-rp-btn.primary:hover { background: rgba(59, 130, 246, 0.22); }',
      '.agy-rp-btn[data-busy="true"] { opacity: 0.72; cursor: wait; }',
      '.agy-rp-icon-btn { width: 22px; height: 22px; border-radius: 6px; border: none; background: transparent; color: var(--muted-foreground, #6b7280); font-size: 15px; line-height: 1; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }',
      '.agy-rp-icon-btn:hover { background: color-mix(in srgb, var(--foreground, #888) 10%, transparent); color: var(--foreground, #111827); }',
      '.agy-rp-tabs-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px 6px; flex: none; flex-wrap: wrap; }',
      '.agy-rp-tabs { display: inline-flex; align-items: center; gap: 4px; background: color-mix(in srgb, var(--foreground, #888) 6%, transparent); padding: 2px; border-radius: 999px; }',
      '.agy-rp-tab { height: 22px; padding: 0 9px; border-radius: 999px; border: none; background: transparent; color: var(--muted-foreground, #6b7280); font-size: 11px; font-weight: 500; cursor: pointer; transition: background 0.12s ease, color 0.12s ease; white-space: nowrap; }',
      '.agy-rp-tab:hover { color: var(--foreground, #111827); }',
      '.agy-rp-tab.active { background: var(--background, #ffffff); color: var(--foreground, #111827); box-shadow: 0 1px 3px rgba(0,0,0,0.12); font-weight: 600; }',
      '.dark .agy-rp-tab.active { background: rgba(255,255,255,0.12); color: #f9fafb; }',
      '.agy-rp-sync { font-size: 10.5px; color: var(--muted-foreground, #6b7280); font-variant-numeric: tabular-nums; white-space: nowrap; }',
      '.agy-rp-body { padding: 6px 12px 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 9px; flex: 1 1 auto; }',
      '.agy-rp-alert { border-radius: 8px; padding: 7px 10px; border: 1px solid rgba(245, 158, 11, 0.36); background: rgba(245, 158, 11, 0.10); display: flex; flex-direction: column; gap: 3px; }',
      '.agy-rp-alert[data-tone="error"] { border-color: rgba(239, 68, 68, 0.36); background: rgba(239, 68, 68, 0.10); }',
      '.agy-rp-alert[data-tone="ok"] { border-color: rgba(16, 185, 129, 0.34); background: rgba(16, 185, 129, 0.10); }',
      '.agy-rp-alert-title { font-size: 11.5px; font-weight: 600; color: var(--foreground, #111827); }',
      '.agy-rp-alert-body { font-size: 11px; color: var(--muted-foreground, #4b5563); white-space: pre-line; line-height: 1.45; }',
      '.agy-rp-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }',
      '.agy-rp-stat { border-radius: 8px; padding: 6.5px 8px; background: color-mix(in srgb, var(--foreground, #888) 4%, transparent); border: 1px solid color-mix(in srgb, var(--foreground, #888) 10%, transparent); display: flex; flex-direction: column; gap: 2px; }',
      '.agy-rp-stat-lbl { font-size: 10px; color: var(--muted-foreground, #6b7280); white-space: nowrap; }',
      '.agy-rp-stat-val { font-size: 12.5px; font-weight: 700; color: var(--foreground, #111827); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '.agy-rp-card { border-radius: 9px; padding: 9px 10.5px; background: color-mix(in srgb, var(--foreground, #888) 4%, transparent); border: 1px solid color-mix(in srgb, var(--foreground, #888) 11%, transparent); display: flex; flex-direction: column; gap: 6px; }',
      '.agy-rp-card-hdr { display: flex; align-items: center; justify-content: space-between; gap: 8px; }',
      '.agy-rp-card-title { font-size: 11.5px; font-weight: 600; color: var(--foreground, #111827); }',
      '.agy-rp-time { font-size: 10.5px; color: var(--muted-foreground, #6b7280); font-variant-numeric: tabular-nums; }',
      '.agy-rp-tags { display: flex; flex-wrap: wrap; gap: 4px; }',
      '.agy-rp-tag { font-size: 10px; padding: 1px 6px; border-radius: 999px; background: color-mix(in srgb, var(--foreground, #888) 8%, transparent); border: 1px solid color-mix(in srgb, var(--foreground, #888) 12%, transparent); color: var(--secondary-foreground, var(--foreground, #374151)); }',
      '.agy-rp-text { font-size: 11.5px; line-height: 1.52; color: var(--foreground, #1f2937); white-space: pre-line; word-break: break-word; }',
      '.agy-rp-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 5px; border-top: 1px dashed color-mix(in srgb, var(--foreground, #888) 14%, transparent); font-size: 10.5px; }',
      '.agy-rp-author { color: var(--muted-foreground, #6b7280); font-weight: 500; }',
      '.agy-rp-links { display: inline-flex; align-items: center; gap: 10px; }',
      '.agy-rp-link { color: #2563eb; text-decoration: none; font-size: 10.5px; font-weight: 500; cursor: pointer; }',
      '.dark .agy-rp-link { color: #60a5fa; }',
      '.agy-rp-link:hover { text-decoration: underline; }',
      '.agy-rp-hist-hdr { display: flex; align-items: center; justify-content: space-between; margin-top: 2px; }',
      '.agy-rp-hist-list { display: flex; flex-direction: column; gap: 6px; }',
      '.agy-rp-hist-item { border-radius: 8px; padding: 7px 9px; background: color-mix(in srgb, var(--foreground, #888) 3%, transparent); border: 1px solid color-mix(in srgb, var(--foreground, #888) 9%, transparent); display: flex; flex-direction: column; gap: 3.5px; }',
      '.agy-rp-hist-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 10.5px; }',
      '.agy-rp-hist-date { font-weight: 600; color: var(--foreground, #111827); font-variant-numeric: tabular-nums; flex: none; }',
      '.agy-rp-hist-meta { color: var(--muted-foreground, #6b7280); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.agy-rp-hist-desc { font-size: 11px; line-height: 1.46; color: var(--secondary-foreground, var(--foreground, #374151)); white-space: pre-line; word-break: break-word; }',
      '#' + RING_ID + ' { position: relative; display: inline-flex; align-items: center; margin: 0 2px; z-index: 50; font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif; }',
      '#agy-ring-btn { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 7px; border-radius: 6px; border: 1px solid transparent; background: transparent; color: var(--muted-foreground, #6b7280); font-size: 11.5px; font-weight: 500; font-variant-numeric: tabular-nums; cursor: pointer; user-select: none; transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease; }',
      '#agy-ring-btn:hover, #agy-ring-btn.active { background: rgba(128,128,128,0.1); border-color: rgba(128,128,128,0.18); color: var(--foreground, #111827); }',
      '#agy-ring-btn.ttl-risk { border-color: rgba(245,158,11,0.38); background: rgba(245,158,11,0.06); }',
      '#agy-ring-ttl { display: none; align-items: center; gap: 3.5px; font-size: 10.5px; font-variant-numeric: tabular-nums; margin-left: 1px; padding-left: 5px; border-left: 1px solid rgba(128,128,128,0.2); }',
      '#agy-ring-ttl.show { display: inline-flex; }',
      '#agy-ring-ttl-dot { width: 5.5px; height: 5.5px; border-radius: 50%; flex: none; }',
      '#' + POPOVER_ID + ' { position: fixed; width: 296px; padding: 11px 13px; border-radius: 10px; background: var(--popover, var(--background, #ffffff)); color: var(--popover-foreground, var(--foreground, #1f2937)); border: 1px solid var(--border, rgba(128,128,128,0.22)); box-shadow: 0 10px 28px rgba(0,0,0,0.16); backdrop-filter: blur(16px); font-size: 12px; line-height: 1.35; z-index: 99999; display: none; text-align: left; }',
      '.dark #' + POPOVER_ID + ' { box-shadow: 0 12px 32px rgba(0,0,0,0.45); }',
      '#' + POPOVER_ID + '.open { display: block; }',
      '.agy-m-row { display: grid; grid-template-columns: 15px 1fr auto; align-items: center; gap: 7px; padding: 3.5px 0; }',
      '.agy-m-icon { display: inline-flex; align-items: center; justify-content: center; color: var(--muted-foreground, #6b7280); opacity: 0.75; }',
      '.agy-m-label { color: var(--muted-foreground, #6b7280); font-size: 11.5px; }',
      '.agy-m-val { font-variant-numeric: tabular-nums; text-align: right; font-weight: 500; font-size: 11.8px; color: var(--foreground, #111827); }',
      '.agy-m-sub { font-weight: 400; color: var(--muted-foreground, #6b7280); font-size: 10.8px; margin-left: 4px; }',
      '.agy-sep { height: 1px; background: var(--border, rgba(128,128,128,0.16)); margin: 6px 0; }',
      '#agy-open-sidecar-btn, #agy-open-swarm-btn { width: 100%; margin-top: 6px; padding: 5px 8px; border-radius: 6px; border: 1px solid var(--border, rgba(128,128,128,0.22)); background: rgba(128,128,128,0.06); color: var(--foreground, #374151); font-size: 11px; font-weight: 500; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease; }',
      '#agy-open-sidecar-btn:hover { background: rgba(128,128,128,0.14); border-color: rgba(128,128,128,0.34); }',
      '#agy-open-swarm-btn { border-color: rgba(59,130,246,0.32); background: rgba(59,130,246,0.09); color: #2563eb; }',
      '.dark #agy-open-swarm-btn { color: #60a5fa; }',
      '#agy-open-swarm-btn:hover { background: rgba(59,130,246,0.17); border-color: rgba(59,130,246,0.5); }'
    ].join('\n');
  }

  function positionPopover(btn, pop) {
    const rect = btn.getBoundingClientRect();
    const popWidth = 292;
    const left = Math.max(8, Math.min(window.innerWidth - popWidth - 8, rect.right - popWidth));
    pop.style.left = left + 'px';
    pop.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
    pop.style.top = 'auto';
  }

  function positionResetsPopover() {
    const pop = document.getElementById(RESETS_POPOVER_ID);
    const btn = document.getElementById('agy-tb-resets');
    if (!pop || !btn || !pop.classList.contains('open')) return;
    const rect = btn.getBoundingClientRect();
    const popWidth = Math.min(446, Math.max(280, window.innerWidth - 24));
    const left = Math.max(12, Math.min(window.innerWidth - popWidth - 12, rect.right - popWidth));
    pop.style.top = Math.max(32, Math.round(rect.bottom + 6)) + 'px';
    pop.style.left = Math.round(left) + 'px';
  }

  function closeResetsPopover() {
    const pop = document.getElementById(RESETS_POPOVER_ID);
    const btn = document.getElementById('agy-tb-resets');
    if (pop) pop.classList.remove('open');
    if (btn) {
      btn.classList.remove('active');
      btn.setAttribute('aria-expanded', 'false');
    }
  }

  function bindExtLink(el, rawUrl) {
    if (!el) return;
    const valid = safeExtUrl(rawUrl);
    if (!valid) {
      el.style.display = 'none';
      el.setAttribute('href', '#');
      return;
    }
    el.style.display = 'inline';
    el.setAttribute('href', valid);
  }

  function syncResetsStaticLabels(pop, lang) {
    pop.setAttribute('aria-label', ct('rp_title', null, lang));
    const setById = (id, txt) => {
      const node = pop.querySelector('#' + id);
      if (node) node.textContent = txt;
    };
    setById('agy-resets-hdr-title', ct('rp_title', null, lang));
    setById('agy-resets-lbl-total', ct('rp_lbl_total', null, lang));
    setById('agy-resets-lbl-days', ct('rp_lbl_days', null, lang));
    setById('agy-resets-lbl-avg', ct('rp_lbl_avg', null, lang));
    setById('agy-resets-lbl-med', ct('rp_lbl_med', null, lang));
    setById('agy-resets-latest-hdr', ct('rp_latest_hdr', null, lang));
    setById('agy-resets-alert-link', ct('rp_view_post', null, lang));
    setById('agy-resets-latest-link', ct('rp_view_post', null, lang));
    setById('agy-resets-site-link', ct('rp_site_src', null, lang));
    setById('agy-resets-hist-title', ct('rp_hist_title', null, lang));
    const closeBtn = pop.querySelector('#agy-resets-close-btn');
    if (closeBtn) closeBtn.setAttribute('aria-label', ct('rp_close', null, lang));
    const tabsWrap = pop.querySelector('#agy-resets-tabs');
    if (tabsWrap) tabsWrap.setAttribute('aria-label', ct('rp_tabs_aria', null, lang));
  }

  function resolveNoticeTitle(notice, lang) {
    if (!notice) return '';
    if (notice.key) {
      return ct(notice.key, { err: notice.err || ct('rp_err_generic', null, lang) }, lang);
    }
    return notice.title || '';
  }

  function syncResetsAlertBanner(pop, src, ui, useEnglish, lang) {
    const alertEl = pop.querySelector('#agy-resets-alert');
    const alertTitle = pop.querySelector('#agy-resets-alert-title');
    const alertBody = pop.querySelector('#agy-resets-alert-body');
    const alertLink = pop.querySelector('#agy-resets-alert-link');
    if (!alertEl || !alertTitle || !alertBody) return;

    if (src?.scheduledReset) {
      alertEl.style.display = 'flex';
      alertEl.setAttribute('data-tone', 'warn');
      alertTitle.textContent = ct('rp_scheduled', null, lang);
      alertBody.textContent = fmtResetDate(src.scheduledReset.announcedAt) + ' · ' + getResetItemText(src.scheduledReset, useEnglish);
      bindExtLink(alertLink, src.scheduledReset.url);
      return;
    }
    if (src?.activeWatch) {
      alertEl.style.display = 'flex';
      alertEl.setAttribute('data-tone', 'warn');
      alertTitle.textContent = ct('rp_watch_signal', { lvl: fmtResetTag(src.activeWatch.level, useEnglish) }, lang);
      const rTag = src.activeWatch.reason ? fmtResetTag(src.activeWatch.reason, useEnglish) : '';
      const ruleStr = src.activeWatch.rule ? ' (' + src.activeWatch.rule + ')' : '';
      alertBody.textContent = ((rTag + ruleStr).trim() + '\n' + getResetItemText(src.activeWatch, useEnglish)).trim();
      bindExtLink(alertLink, src.activeWatch.url);
      return;
    }
    if (src && src.ok === false && src.error) {
      alertEl.style.display = 'flex';
      alertEl.setAttribute('data-tone', 'error');
      alertTitle.textContent = ct('rp_refresh_failed', { err: src.error }, lang);
      alertBody.textContent = '';
      bindExtLink(alertLink, '');
      return;
    }
    if (ui.notice) {
      alertEl.style.display = 'flex';
      alertEl.setAttribute('data-tone', ui.notice.tone || 'ok');
      alertTitle.textContent = resolveNoticeTitle(ui.notice, lang);
      alertBody.textContent = ui.notice.body || '';
      bindExtLink(alertLink, '');
      return;
    }
    alertEl.style.display = 'none';
    bindExtLink(alertLink, '');
  }

  function syncResetsHistoryList(pop, src, meta, useEnglish, lang) {
    const histArr = Array.isArray(src?.history) ? src.history : [];
    const countNode = pop.querySelector('#agy-resets-hist-count');
    if (countNode) {
      countNode.textContent = histArr.length > 0 ? ct('rp_hist_count', { n: histArr.length }, lang) : '—';
    }
    const histList = pop.querySelector('#agy-resets-hist-list');
    if (!histList) return;
    histList.replaceChildren();
    if (histArr.length === 0) {
      const emp = document.createElement('div');
      emp.className = 'agy-rp-sync';
      emp.textContent = ct('rp_empty_hist', null, lang);
      histList.appendChild(emp);
      return;
    }

    const viewPostTxt = ct('rp_view_post', null, lang);
    for (const item of histArr) {
      const row = document.createElement('div');
      row.className = 'agy-rp-hist-item';

      const top = document.createElement('div');
      top.className = 'agy-rp-hist-top';
      const dSpan = document.createElement('span');
      dSpan.className = 'agy-rp-hist-date';
      dSpan.textContent = fmtResetDate(item.announcedAt);
      top.appendChild(dSpan);

      const mSpan = document.createElement('span');
      mSpan.className = 'agy-rp-hist-meta';
      const parts = [];
      if (item.author) parts.push(item.author.startsWith('@') ? item.author : '@' + item.author);
      if (item.trigger) parts.push(fmtResetTag(item.trigger, useEnglish));
      if (Array.isArray(item.models) && item.models.length) {
        parts.push(item.models.map((m) => fmtResetTag(m, useEnglish)).join('/'));
      }
      mSpan.textContent = parts.join(' · ') || meta.label;
      top.appendChild(mSpan);
      row.appendChild(top);

      const desc = document.createElement('div');
      desc.className = 'agy-rp-hist-desc';
      desc.textContent = getResetItemText(item, useEnglish);
      row.appendChild(desc);

      const validHref = safeExtUrl(item.url);
      if (validHref) {
        const a = document.createElement('a');
        a.className = 'agy-rp-link';
        a.href = validHref;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = viewPostTxt;
        row.appendChild(a);
      }

      histList.appendChild(row);
    }
  }

  function renderResetsPopover() {
    const pop = document.getElementById(RESETS_POPOVER_ID);
    const topBtn = document.getElementById('agy-tb-resets');
    const ui = window.__AGY_RESETS_UI_STATE__;
    if (topBtn) {
      if (ui.busy) topBtn.setAttribute('data-busy', 'true');
      else topBtn.removeAttribute('data-busy');
    }
    if (!pop) return;

    const lang = resolveClientLang();
    syncResetsStaticLabels(pop, lang);

    const data = window.__AGY_RESETS_DATA__ || null;
    const srcKey = RESET_SOURCES_META[ui.activeSource] ? ui.activeSource : 'agy';
    const meta = RESET_SOURCES_META[srcKey];
    const src = data?.sources?.[srcKey] || null;
    const showOrig = Boolean(ui.showOriginal);
    const useEnglish = lang === 'en' ? true : showOrig;

    const refreshBtn = pop.querySelector('#agy-resets-refresh-btn');
    if (refreshBtn) {
      if (ui.busy) {
        refreshBtn.setAttribute('data-busy', 'true');
        refreshBtn.textContent = ct('rp_refreshing', null, lang);
      } else {
        refreshBtn.removeAttribute('data-busy');
        refreshBtn.textContent = ct('rp_refresh', null, lang);
      }
    }

    const langBtn = pop.querySelector('#agy-resets-lang-btn');
    if (langBtn) {
      if (lang === 'en') {
        langBtn.style.display = 'none';
      } else {
        langBtn.style.display = '';
        langBtn.textContent = showOrig ? ct('rp_btn_trans', null, lang) : ct('rp_btn_orig', null, lang);
        langBtn.classList.toggle('active', showOrig);
        langBtn.title = showOrig ? ct('rp_tip_orig', null, lang) : ct('rp_tip_trans', null, lang);
      }
    }

    for (const k of ['agy', 'codex', 'claude']) {
      const tBtn = pop.querySelector('#agy-resets-tab-' + k);
      if (tBtn) {
        const isAct = k === srcKey;
        tBtn.classList.toggle('active', isAct);
        tBtn.setAttribute('aria-selected', String(isAct));
      }
    }

    const syncEl = pop.querySelector('#agy-resets-sync-txt');
    if (syncEl) {
      syncEl.textContent = data?.lastRefreshedAt
        ? ct('rp_synced_at', { t: fmtResetDate(data.lastRefreshedAt) }, lang)
        : ct('rp_manual_only', null, lang);
    }

    syncResetsAlertBanner(pop, src, ui, useEnglish, lang);

    const st = src?.stats || null;
    const lr = src?.latestReset || null;
    const setTxt = (sel, val) => {
      const node = pop.querySelector(sel);
      if (node) node.textContent = val;
    };
    setTxt('#agy-resets-st-total', st && st.total != null ? String(st.total) : '—');
    setTxt('#agy-resets-st-days', computeSinceLastDays(st, lr));
    setTxt('#agy-resets-st-avg', st && st.avgIntervalDays != null ? ct('rp_days_unit', { d: st.avgIntervalDays }, lang) : '—');
    if (st && (st.medianIntervalDays != null || st.longestGapDays != null)) {
      const med = st.medianIntervalDays != null ? st.medianIntervalDays + 'd' : '—';
      const max = st.longestGapDays != null ? st.longestGapDays + 'd' : '—';
      setTxt('#agy-resets-st-med', med + ' / ' + max);
    } else {
      setTxt('#agy-resets-st-med', '—');
    }

    const latestTags = pop.querySelector('#agy-resets-latest-tags');
    const latestLink = pop.querySelector('#agy-resets-latest-link');
    const siteLink = pop.querySelector('#agy-resets-site-link');
    bindExtLink(siteLink, src?.siteUrl || meta.siteUrl);

    if (lr) {
      setTxt('#agy-resets-latest-time', fmtResetDate(lr.announcedAt));
      setTxt('#agy-resets-latest-text', getResetItemText(lr, useEnglish) || '—');
      setTxt('#agy-resets-latest-author', lr.author ? (lr.author.startsWith('@') ? lr.author : '@' + lr.author) : meta.label);
      bindExtLink(latestLink, lr.url);
      if (latestTags) {
        latestTags.replaceChildren();
        const tags = [
          ...(Array.isArray(lr.models) ? lr.models : []),
          ...(Array.isArray(lr.plans) ? lr.plans : []),
          ...(lr.trigger ? [lr.trigger] : []),
          ...(lr.kind && lr.kind !== 'unspecified' ? [lr.kind] : [])
        ].slice(0, 6);
        for (const rawT of tags) {
          const sp = document.createElement('span');
          sp.className = 'agy-rp-tag';
          sp.textContent = fmtResetTag(rawT, useEnglish);
          latestTags.appendChild(sp);
        }
      }
    } else {
      setTxt('#agy-resets-latest-time', '—');
      setTxt('#agy-resets-latest-text', ct('rp_empty_latest', null, lang));
      setTxt('#agy-resets-latest-author', meta.label);
      if (latestTags) latestTags.replaceChildren();
      bindExtLink(latestLink, '');
    }

    syncResetsHistoryList(pop, src, meta, useEnglish, lang);
  }

  function requestManualResetsRefresh() {
    const ui = window.__AGY_RESETS_UI_STATE__;
    if (ui.busy) {
      ui.notice = { tone: 'warn', key: 'rp_notice_busy', body: '' };
      renderResetsPopover();
      return;
    }
    ui.busy = true;
    ui.notice = null;
    if (ui.busyTimer) clearTimeout(ui.busyTimer);
    ui.busyTimer = setTimeout(() => {
      if (ui.busy) {
        ui.busy = false;
        ui.notice = { tone: 'error', key: 'rp_notice_timeout', body: '' };
        renderResetsPopover();
      }
    }, 15000);
    window.__AGY_RESETS_REFRESH_REQ__ = 'all';
    renderResetsPopover();
    const bridge = window.__agContextBridge;
    if (bridge && typeof bridge.refreshResets === 'function') {
      window.__AGY_RESETS_REFRESH_REQ__ = null;
      Promise.resolve(bridge.refreshResets('all'))
        .then((res) => {
          if (window.__AGY_RESETS_UPDATE__) {
            window.__AGY_RESETS_UPDATE__(res || { ok: false, error: ct('rp_err_no_resp') });
          }
        })
        .catch((err) => {
          if (window.__AGY_RESETS_UPDATE__) {
            window.__AGY_RESETS_UPDATE__({ ok: false, error: (err && err.message) || ct('rp_err_bridge') });
          }
        });
    }
  }

  window.__AGY_RESETS_UPDATE__ = function(payload) {
    const ui = window.__AGY_RESETS_UI_STATE__;
    if (ui.busyTimer) {
      clearTimeout(ui.busyTimer);
      ui.busyTimer = null;
    }
    const wasBusy = Boolean(ui.busy);
    ui.busy = false;
    if (payload && typeof payload === 'object') {
      if (payload.data && typeof payload.data === 'object') {
        window.__AGY_RESETS_DATA__ = payload.data;
      } else if (payload.sources && typeof payload.sources === 'object') {
        window.__AGY_RESETS_DATA__ = payload;
      }
      if (wasBusy) {
        if (payload.ok === false) {
          ui.notice = { tone: 'error', key: 'rp_refresh_failed', err: payload.error || '', body: '' };
        } else {
          ui.notice = { tone: 'ok', key: 'rp_notice_synced', body: '' };
        }
      }
    }
    renderResetsPopover();
  };

  function ensureResetsPopover() {
    let pop = document.getElementById(RESETS_POPOVER_ID);
    if (pop && pop.dataset.v !== '2') {
      pop.remove();
      pop = null;
    }
    if (!pop) {
      const lang = resolveClientLang();
      pop = document.createElement('section');
      pop.id = RESETS_POPOVER_ID;
      pop.dataset.v = '2';
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', ct('rp_title', null, lang));
      pop.setAttribute('data-ag-localization-skip', 'true');
      pop.innerHTML = [
        '<div class="agy-rp-hdr">',
        '  <div class="agy-rp-title"><span class="agy-tb-resets-icon">' + ICONS.resets + '</span><span id="agy-resets-hdr-title">' + ct('rp_title', null, lang) + '</span></div>',
        '  <div class="agy-rp-hdr-actions">',
        '    <button type="button" class="agy-rp-btn" id="agy-resets-lang-btn">' + ct('rp_btn_orig', null, lang) + '</button>',
        '    <button type="button" class="agy-rp-btn primary" id="agy-resets-refresh-btn">' + ct('rp_refresh', null, lang) + '</button>',
        '    <button type="button" class="agy-rp-icon-btn" id="agy-resets-close-btn" aria-label="' + ct('rp_close', null, lang) + '">×</button>',
        '  </div>',
        '</div>',
        '<div class="agy-rp-tabs-bar">',
        '  <div class="agy-rp-tabs" id="agy-resets-tabs" role="tablist" aria-label="' + ct('rp_tabs_aria', null, lang) + '">',
        '    <button type="button" class="agy-rp-tab active" id="agy-resets-tab-agy" role="tab" aria-selected="true" data-src="agy">Gemini (AGY)</button>',
        '    <button type="button" class="agy-rp-tab" id="agy-resets-tab-codex" role="tab" aria-selected="false" data-src="codex">Codex</button>',
        '    <button type="button" class="agy-rp-tab" id="agy-resets-tab-claude" role="tab" aria-selected="false" data-src="claude">Claude</button>',
        '  </div>',
        '  <span id="agy-resets-sync-txt" class="agy-rp-sync">' + ct('rp_manual_only', null, lang) + '</span>',
        '</div>',
        '<div class="agy-rp-body">',
        '  <div id="agy-resets-alert" class="agy-rp-alert" style="display:none;" role="status">',
        '    <div id="agy-resets-alert-title" class="agy-rp-alert-title"></div>',
        '    <div id="agy-resets-alert-body" class="agy-rp-alert-body"></div>',
        '    <a id="agy-resets-alert-link" class="agy-rp-link" href="#" target="_blank" rel="noopener noreferrer" style="display:none;">' + ct('rp_view_post', null, lang) + '</a>',
        '  </div>',
        '  <div class="agy-rp-stats">',
        '    <div class="agy-rp-stat"><span id="agy-resets-lbl-total" class="agy-rp-stat-lbl">' + ct('rp_lbl_total', null, lang) + '</span><span id="agy-resets-st-total" class="agy-rp-stat-val">—</span></div>',
        '    <div class="agy-rp-stat"><span id="agy-resets-lbl-days" class="agy-rp-stat-lbl">' + ct('rp_lbl_days', null, lang) + '</span><span id="agy-resets-st-days" class="agy-rp-stat-val">—</span></div>',
        '    <div class="agy-rp-stat"><span id="agy-resets-lbl-avg" class="agy-rp-stat-lbl">' + ct('rp_lbl_avg', null, lang) + '</span><span id="agy-resets-st-avg" class="agy-rp-stat-val">—</span></div>',
        '    <div class="agy-rp-stat"><span id="agy-resets-lbl-med" class="agy-rp-stat-lbl">' + ct('rp_lbl_med', null, lang) + '</span><span id="agy-resets-st-med" class="agy-rp-stat-val">—</span></div>',
        '  </div>',
        '  <div class="agy-rp-card">',
        '    <div class="agy-rp-card-hdr">',
        '      <span id="agy-resets-latest-hdr" class="agy-rp-card-title">' + ct('rp_latest_hdr', null, lang) + '</span>',
        '      <span id="agy-resets-latest-time" class="agy-rp-time">—</span>',
        '    </div>',
        '    <div id="agy-resets-latest-tags" class="agy-rp-tags"></div>',
        '    <div id="agy-resets-latest-text" class="agy-rp-text">' + ct('rp_empty_latest', null, lang) + '</div>',
        '    <div class="agy-rp-footer">',
        '      <span id="agy-resets-latest-author" class="agy-rp-author">—</span>',
        '      <div class="agy-rp-links">',
        '        <a id="agy-resets-latest-link" class="agy-rp-link" href="#" target="_blank" rel="noopener noreferrer" style="display:none;">' + ct('rp_view_post', null, lang) + '</a>',
        '        <a id="agy-resets-site-link" class="agy-rp-link" href="https://agyresets.com/" target="_blank" rel="noopener noreferrer">' + ct('rp_site_src', null, lang) + '</a>',
        '      </div>',
        '    </div>',
        '  </div>',
        '  <div>',
        '    <div class="agy-rp-hist-hdr">',
        '      <span id="agy-resets-hist-title" class="agy-rp-card-title">' + ct('rp_hist_title', null, lang) + '</span>',
        '      <span id="agy-resets-hist-count" class="agy-rp-sync">—</span>',
        '    </div>',
        '    <div id="agy-resets-hist-list" class="agy-rp-hist-list" style="margin-top:6px;"></div>',
        '  </div>',
        '</div>'
      ].join('');

      pop.addEventListener('click', (e) => {
        e.stopPropagation();
        const closeBtn = e.target.closest('#agy-resets-close-btn');
        if (closeBtn) {
          e.preventDefault();
          closeResetsPopover();
          return;
        }
        const langBtn = e.target.closest('#agy-resets-lang-btn');
        if (langBtn) {
          e.preventDefault();
          const ui = window.__AGY_RESETS_UI_STATE__;
          ui.showOriginal = !ui.showOriginal;
          renderResetsPopover();
          return;
        }
        const refreshBtn = e.target.closest('#agy-resets-refresh-btn');
        if (refreshBtn) {
          e.preventDefault();
          requestManualResetsRefresh();
          return;
        }
        const tabBtn = e.target.closest('[data-src]');
        if (tabBtn) {
          e.preventDefault();
          const nextSrc = tabBtn.getAttribute('data-src');
          if (nextSrc && RESET_SOURCES_META[nextSrc]) {
            const ui = window.__AGY_RESETS_UI_STATE__;
            ui.activeSource = nextSrc;
            ui.notice = null;
            renderResetsPopover();
          }
        }
      });

      document.body.appendChild(pop);
    }

    if (!window.__AGY_RESETS_DOC_BOUND__) {
      window.__AGY_RESETS_DOC_BOUND__ = true;
      document.addEventListener('click', (e) => {
        const p = document.getElementById(RESETS_POPOVER_ID);
        if (!p || !p.classList.contains('open')) return;
        if (e.target.closest && (e.target.closest('#' + RESETS_POPOVER_ID) || e.target.closest('#agy-tb-resets'))) {
          return;
        }
        closeResetsPopover();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          const p = document.getElementById(RESETS_POPOVER_ID);
          if (p && p.classList.contains('open')) {
            e.stopPropagation();
            closeResetsPopover();
          }
        }
      });
      window.addEventListener('resize', () => {
        positionResetsPopover();
      });
    }

    return pop;
  }

  function toggleResetsPopover() {
    const pop = ensureResetsPopover();
    const btn = document.getElementById('agy-tb-resets');
    const isOpen = pop.classList.toggle('open');
    if (btn) {
      btn.classList.toggle('active', isOpen);
      btn.setAttribute('aria-expanded', String(isOpen));
    }
    if (isOpen) {
      renderResetsPopover();
      positionResetsPopover();
    }
  }

  function buildTopCtxTitle(r, ttl, qi) {
    const lang = resolveClientLang();
    if (!r || r.error) return ct('tb_ctx_toggle_tip', null, lang);
    const used = Number(r.used_tokens) || 0;
    const rawBudget = Number(r.request_budget_tokens) || 0;
    const nativeLimit = Number(r.limit_tokens) || 1048576;
    const effLimit = rawBudget > 0 ? rawBudget : nativeLimit;
    const pct = effLimit > 0 ? Math.min(100, (used / effLimit) * 100) : (Number(r.used_pct) || 0);
    const tel = r.telemetry || {};
    const cur = tel.latest || {};
    const sum = tel.summary || {};
    const hitPct = cur.cache_hit_pct ?? null;
    const cacheBustCount = Number(r.cache_bust_count ?? sum.cache_bust_count ?? 0) || 0;
    const cacheBustTokens = Number(r.cache_bust_tokens ?? sum.cache_bust_tokens ?? 0) || 0;
    const physHint = nativeLimit > effLimit ? ct('tb_ctx_phys', { lim: fmtTok(nativeLimit) }, lang) : '';
    const modelStr = r.model || ct('tb_ctx_model_fallback', null, lang);
    const lines = [
      modelStr + ' · ' + ct('tb_ctx_word', null, lang) + ' ' + fmtTok(used) + ' / ' + fmtTok(effLimit) + ' (' + pct.toFixed(1) + '%)' + physHint
    ];
    const cacheParts = [];
    if (hitPct != null) cacheParts.push(ct('tb_ctx_hit', { pct: Math.round(hitPct) }, lang));
    if (cacheBustCount > 0) cacheParts.push(ct('tb_ctx_bust', { n: cacheBustCount, tok: fmtTok(cacheBustTokens) }, lang));
    if (cacheParts.length) lines.push(cacheParts.join(' · '));
    if (ttl) lines.push(ttl.title);
    if (qi) lines.push(ct('tb_ctx_quota_prefix', null, lang) + qi.title);
    lines.push(ct('tb_ctx_toggle_tip', null, lang));
    return lines.join('\n');
  }

  window.__AGY_RING_TTL_TICK__ = function() {
    const r = window.__AGY_RING_DATA__;
    const lastTurnAt = r && !r.error ? (r.last_turn_at || r.telemetry?.last_turn_at || '') : '';
    const ttl = computeTtlInfo(lastTurnAt);
    const qi = computeQuotaInfo(r && !r.error ? r.quota : null);

    // 1. Update Top Titlebar Strip (2-in-1 compact ctx+ttl pill)
    const topBar = document.getElementById(TOP_BAR_ID);
    if (topBar && topBar.style.display !== 'none') {
      const tbCtxBtn = topBar.querySelector('#agy-tb-ctx');
      const tbCtxTtl = topBar.querySelector('#agy-tb-ctx-ttl');
      const tbTtlDot = topBar.querySelector('#agy-tb-ttl-dot');
      const tbTtlTxt = topBar.querySelector('#agy-tb-ttl-txt');
      if (tbCtxBtn && tbCtxBtn.style.display !== 'none') {
        tbCtxBtn.title = buildTopCtxTitle(r, ttl, qi);
      }
      if (tbCtxTtl && tbTtlDot && tbTtlTxt) {
        if (ttl) {
          tbCtxTtl.style.display = 'inline-flex';
          tbCtxTtl.className = 'agy-tb-ctx-ttl ' + ttl.state;
          tbTtlDot.style.background = ttl.state === 'cold' ? 'color-mix(in srgb, #ef4444 62%, #9ca3af)' : ttl.color;
          tbTtlTxt.textContent = fmtMmSs(ttl.idleSec);
        } else {
          tbCtxTtl.style.display = 'none';
        }
      }
    }

    // 2. Update Input Ring & Popover
    const wrap = document.getElementById(RING_ID);
    if (!wrap || wrap.style.display === 'none') return;
    const btn = wrap.querySelector('#agy-ring-btn');
    const ttlWrap = wrap.querySelector('#agy-ring-ttl');
    const ttlDot = wrap.querySelector('#agy-ring-ttl-dot');
    const ttlTxt = wrap.querySelector('#agy-ring-ttl-txt');
    const popVal = wrap.querySelector('#agy-pop-ttl-val');
    const popSub = wrap.querySelector('#agy-pop-ttl-sub');
    const popQuotaVal = wrap.querySelector('#agy-pop-quota-val');

    if (popQuotaVal) {
      popQuotaVal.textContent = qi ? qi.pillText : '--';
    }

    if (!ttl) {
      if (ttlWrap) ttlWrap.classList.remove('show');
      if (btn) btn.classList.remove('ttl-risk');
      if (popVal) {
        popVal.textContent = '--';
        popVal.style.color = '';
      }
      if (popSub) popSub.textContent = '';
      return;
    }

    if (btn) {
      btn.classList.toggle('ttl-risk', ttl.state === 'risk');
      btn.title = ttl.title;
    }
    if (ttlWrap && ttlDot && ttlTxt) {
      ttlWrap.classList.add('show');
      ttlDot.style.background = ttl.state === 'cold' ? '#9aa0a6' : ttl.color;
      ttlTxt.textContent = ttl.ringText;
      ttlTxt.style.color = ttl.state === 'cold' ? 'var(--muted-foreground, #9aa0a6)' : ttl.color;
    }
    if (popVal) {
      popVal.textContent = ttl.popVal;
      popVal.style.color = ttl.color;
    }
    if (popSub) {
      popSub.textContent = ttl.popSub;
    }
  };

  function renderTopTitlebar(r) {
    const tbToolbar = findTopTitlebarToolbar();
    if (!tbToolbar) return;

    const lang = resolveClientLang();
    let topBar = document.getElementById(TOP_BAR_ID);
    if (topBar && topBar.dataset.v !== '3') {
      topBar.remove();
      topBar = null;
    }
    if (!topBar) {
      topBar = document.createElement('div');
      topBar.id = TOP_BAR_ID;
      topBar.dataset.v = '3';
      topBar.setAttribute('data-ag-localization-skip', 'true');
      topBar.innerHTML = [
        '<button type="button" class="agy-tb-pill" id="agy-tb-ctx" style="display:none;">',
        '  <svg width="12" height="12" viewBox="0 0 36 36" style="transform: rotate(-90deg); flex: none;">',
        '    <circle cx="18" cy="18" r="14.5" fill="none" stroke="currentColor" stroke-opacity="0.22" stroke-width="3.8"></circle>',
        '    <circle id="agy-tb-arc" cx="18" cy="18" r="14.5" fill="none" stroke="#10b981" stroke-width="4" stroke-dasharray="0 100" stroke-linecap="round" pathLength="100"></circle>',
        '  </svg>',
        '  <span id="agy-tb-ctx-txt">--</span>',
        '  <span id="agy-tb-bust-dot" class="agy-tb-bust-dot" style="display:none;"></span>',
        '  <span id="agy-tb-ctx-ttl" class="agy-tb-ctx-ttl" style="display:none;">',
        '    <span id="agy-tb-ttl-dot" class="agy-tb-dot"></span>',
        '    <span id="agy-tb-ttl-txt">--:--</span>',
        '  </span>',
        '</button>',
        '<button type="button" class="agy-tb-pill swarm" id="agy-tb-swarm" style="display:none;">',
        '  <span style="display:inline-flex;align-items:center;">' + ICONS.swarm + '</span>',
        '  <span id="agy-tb-swarm-txt">0/0</span>',
        '</button>',
        '<button type="button" class="agy-tb-pill resets" id="agy-tb-resets" aria-expanded="false" title="' + ct('tb_resets_tip', null, lang) + '">',
        '  <span class="agy-tb-resets-icon" aria-hidden="true">' + ICONS.resets + '</span>',
        '  <span id="agy-tb-resets-txt">' + ct('tb_resets', null, lang) + '</span>',
        '</button>'
      ].join('');

      const resetsBtn = topBar.querySelector('#agy-tb-resets');
      if (resetsBtn) {
        const release = () => resetsBtn.removeAttribute('data-pressed');
        resetsBtn.addEventListener('pointerdown', () => resetsBtn.setAttribute('data-pressed', 'true'));
        resetsBtn.addEventListener('pointerup', release);
        resetsBtn.addEventListener('pointercancel', release);
        resetsBtn.addEventListener('mouseleave', release);
        resetsBtn.addEventListener('blur', release);
      }

      topBar.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const resetsPill = e.target.closest('#agy-tb-resets');
        if (resetsPill) {
          resetsPill.removeAttribute('data-pressed');
          toggleResetsPopover();
          return;
        }
        closeResetsPopover();
        const swarmPill = e.target.closest('#agy-tb-swarm');
        if (swarmPill) {
          if (window.__AGY_TOGGLE_CONTEXT_SIDECAR__) {
            window.__AGY_TOGGLE_CONTEXT_SIDECAR__('swarm');
          } else {
            openContextSidecar('swarm');
          }
          return;
        }
        const ctxPill = e.target.closest('#agy-tb-ctx');
        if (ctxPill) {
          if (window.__AGY_TOGGLE_CONTEXT_SIDECAR__) {
            window.__AGY_TOGGLE_CONTEXT_SIDECAR__('single');
          } else {
            openContextSidecar('single');
          }
        }
      });
    }

    const resetsPillBtn = topBar.querySelector('#agy-tb-resets');
    const resetsPillTxt = topBar.querySelector('#agy-tb-resets-txt');
    if (resetsPillBtn) resetsPillBtn.title = ct('tb_resets_tip', null, lang);
    if (resetsPillTxt) resetsPillTxt.textContent = ct('tb_resets', null, lang);

    ensureResetsPopover();

    topBar.style.display = 'inline-flex';
    if (topBar.parentElement !== tbToolbar || tbToolbar.firstElementChild !== topBar) {
      tbToolbar.insertBefore(topBar, tbToolbar.firstElementChild);
    }

    const tbCtxBtn = topBar.querySelector('#agy-tb-ctx');
    const tbSwarm = topBar.querySelector('#agy-tb-swarm');

    if (!r || r.error || !(Number(r.used_tokens) > 0)) {
      if (tbCtxBtn) tbCtxBtn.style.display = 'none';
      if (tbSwarm) tbSwarm.style.display = 'none';
      return;
    }

    const used = Number(r.used_tokens) || 0;
    const rawBudget = Number(r.request_budget_tokens) || 0;
    const nativeLimit = Number(r.limit_tokens) || 1048576;
    const effLimit = rawBudget > 0 ? rawBudget : nativeLimit;
    const pct = effLimit > 0 ? Math.min(100, (used / effLimit) * 100) : (Number(r.used_pct) || 0);
    const tel = r.telemetry || {};
    const sum = tel.summary || {};
    const cacheBustCount = Number(r.cache_bust_count ?? sum.cache_bust_count ?? 0) || 0;
    const sm = r.swarm_meta || r.cluster || {};
    const hasCluster = Boolean(sm && sm.has_cluster);

    const tbArc = topBar.querySelector('#agy-tb-arc');
    const tbCtxTxt = topBar.querySelector('#agy-tb-ctx-txt');
    const tbBustDot = topBar.querySelector('#agy-tb-bust-dot');

    if (tbCtxBtn) tbCtxBtn.style.display = 'inline-flex';
    if (tbArc) {
      tbArc.setAttribute('stroke', ringColor(pct));
      tbArc.setAttribute('stroke-dasharray', Math.min(100, Math.max(1, pct)) + ' 100');
    }
    if (tbCtxTxt) {
      tbCtxTxt.textContent = fmtTokCompact(used) + ' (' + Math.round(pct) + '%)';
    }
    if (tbBustDot) {
      if (cacheBustCount > 0) {
        tbBustDot.style.display = 'inline-block';
        tbBustDot.className = 'agy-tb-bust-dot' + (cacheBustCount >= 5 ? ' severe' : '');
      } else {
        tbBustDot.style.display = 'none';
      }
    }

    const tbSwarmTxt = topBar.querySelector('#agy-tb-swarm-txt');
    if (tbSwarm && tbSwarmTxt) {
      if (hasCluster) {
        const hasWarn = Boolean(sm.audit_enabled !== false && (sm.violation_count > 0 || sm.warn_count > 0));
        tbSwarm.style.display = 'inline-flex';
        tbSwarm.className = 'agy-tb-pill swarm' + (hasWarn ? ' swarm-warn' : '');
        const ratio = (sm.active_count || 0) + '/' + (sm.member_count || 0);
        tbSwarmTxt.textContent = ratio;
        tbSwarm.title = ct('tb_swarm_tip', {
          ratio,
          warn: hasWarn ? ct('tb_swarm_warn_part', null, lang) : ''
        }, lang);
      } else {
        tbSwarm.style.display = 'none';
      }
    }
  }

  function buildPopoverContentHtml(r, used, limit, nativeLimit, pct, free, lang) {
    const tel = r.telemetry || {};
    const cur = tel.latest || {};
    const sum = tel.summary || {};
    const cacheBustCount = Number(r.cache_bust_count ?? sum.cache_bust_count ?? 0) || 0;
    const cacheBustTokens = Number(r.cache_bust_tokens ?? sum.cache_bust_tokens ?? 0) || 0;
    const sm = r.swarm_meta || r.cluster || {};
    const hasCluster = Boolean(sm && sm.has_cluster);

    const segs = Array.isArray(r.grid_segments) ? r.grid_segments : [];
    const barHtml = segs
      .map((t, i) => {
        if (!t || !limit) return '';
        const w = Math.max(0.8, (t / limit) * 100);
        return '<div style="width:' + w.toFixed(2) + '%;background:' + SEG_COLORS[i] + '"></div>';
      })
      .join('');

    const bustColor = cacheBustCount > 0 ? '#f59e0b' : 'var(--foreground,#e3e3e3)';
    const bustHtml = cacheBustCount > 0
      ? '<span style="color:' + bustColor + ';font-weight:600;">' + ct('pop_bust_has', { n: cacheBustCount, tok: fmtTok(cacheBustTokens) }, lang) + '</span>'
      : '<span>' + ct('pop_bust_zero', null, lang) + '</span>';

    const swarmBtnLabel = sm.cache_bust_count > 0
      ? ct('pop_swarm_bust', { act: sm.active_count || 0, tot: sm.member_count || 0, bust: sm.cache_bust_count }, lang)
      : ct('pop_swarm_ok', { act: sm.active_count || 0, tot: sm.member_count || 0, turns: sm.total_turns || 0 }, lang);

    const swarmBtnHtml = hasCluster
      ? [
          '<button type="button" id="agy-open-swarm-btn">',
          '  <span style="display:inline-flex;align-items:center;gap:6px;"><span class="agy-m-icon" style="color:#4c8df6;opacity:0.95;">' + ICONS.swarm + '</span><span>' + swarmBtnLabel + '</span></span>',
          '  <span class="agy-m-icon">' + ICONS.arrow + '</span>',
          '</button>'
        ].join('')
      : '';

    const dataQuotaSig = r.quota ? (r.quota.remaining_pct + '@' + r.quota.reset_time) : '';
    const rightLimText = nativeLimit > limit
      ? ct('pop_native_lim', { tok: fmtTok(nativeLimit) }, lang)
      : ct('pop_budget_lim', { tok: fmtTok(limit) }, lang);

    return [
      '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;" data-q="' + dataQuotaSig + '">',
      '  <span style="font-weight:600;font-size:12px;">' + (r.model || 'Model') + '</span>',
      '  <span style="font-variant-numeric:tabular-nums;font-size:11.5px;color:var(--muted-foreground,#6b7280);"><strong style="color:var(--foreground,#111827);font-weight:600;">' + fmtTok(used) + '</strong> / ' + fmtTok(limit) + ' (' + pct.toFixed(1) + '%)</span>',
      '</div>',
      '<div style="height:3px;border-radius:999px;background:rgba(128,128,128,0.18);overflow:hidden;display:flex;margin-bottom:8px;">' + barHtml + '</div>',
      '<div class="agy-m-row">',
      '  <span class="agy-m-icon">' + ICONS.ttl + '</span>',
      '  <span class="agy-m-label">' + ct('pop_lbl_ttl', null, lang) + '</span>',
      '  <span class="agy-m-val"><span id="agy-pop-ttl-val">--</span><span class="agy-m-sub" id="agy-pop-ttl-sub"></span></span>',
      '</div>',
      '<div class="agy-m-row">',
      '  <span class="agy-m-icon">' + ICONS.bust + '</span>',
      '  <span class="agy-m-label">' + ct('pop_lbl_bust', null, lang) + '</span>',
      '  <span class="agy-m-val">' + bustHtml + '</span>',
      '</div>',
      '<div class="agy-m-row">',
      '  <span class="agy-m-icon">' + ICONS.total + '</span>',
      '  <span class="agy-m-label">' + ct('pop_lbl_quota', null, lang) + '</span>',
      '  <span class="agy-m-val" id="agy-pop-quota-val">--</span>',
      '</div>',
      '<div class="agy-m-row">',
      '  <span class="agy-m-icon">' + ICONS.cache + '</span>',
      '  <span class="agy-m-label">' + ct('pop_lbl_cache', null, lang) + '</span>',
      '  <span class="agy-m-val">' + (cur.cache_hit_pct ?? 0) + '%<span class="agy-m-sub">' + ct('pop_sub_cache', { tok: fmtTok(cur.cache_read_tokens) }, lang) + '</span></span>',
      '</div>',
      '<div class="agy-m-row">',
      '  <span class="agy-m-icon">' + ICONS.speed + '</span>',
      '  <span class="agy-m-label">' + ct('pop_lbl_speed', null, lang) + '</span>',
      '  <span class="agy-m-val">' + (cur.output_tps || 0) + ' t/s<span class="agy-m-sub">' + ct('pop_sub_avg', { v: sum.avg_output_tps || 0 }, lang) + '</span></span>',
      '</div>',
      '<div class="agy-m-row">',
      '  <span class="agy-m-icon">' + ICONS.ttft + '</span>',
      '  <span class="agy-m-label">' + ct('pop_lbl_ttft', null, lang) + '</span>',
      '  <span class="agy-m-val">' + fmtSec(cur.ttft_ms) + '<span class="agy-m-sub">' + ct('pop_sub_avg', { v: fmtSec(sum.avg_ttft_ms) }, lang) + '</span></span>',
      '</div>',
      '<div class="agy-m-row">',
      '  <span class="agy-m-icon">' + ICONS.prefill + '</span>',
      '  <span class="agy-m-label">' + ct('pop_lbl_prefill', null, lang) + '</span>',
      '  <span class="agy-m-val">' + fmtTok(cur.prefill_tps || 0) + '/s<span class="agy-m-sub">' + ct('pop_sub_peak', { v: fmtTok(sum.peak_prefill_tps || 0) }, lang) + '</span></span>',
      '</div>',
      '<div class="agy-m-row">',
      '  <span class="agy-m-icon">' + ICONS.turn + '</span>',
      '  <span class="agy-m-label">' + ct('pop_lbl_out', null, lang) + '</span>',
      '  <span class="agy-m-val">' + fmtTok(cur.output_tokens) + '<span class="agy-m-sub">' + ct('pop_sub_out', { tok: fmtTok(sum.sum_output_tokens), n: tel.total_calls || 0 }, lang) + '</span></span>',
      '</div>',
      '<div class="agy-sep"></div>',
      '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted-foreground,#6b7280);font-variant-numeric:tabular-nums;">',
      '  <span>' + ct('pop_free', { tok: fmtTok(free) }, lang) + '</span>',
      '  <span>' + rightLimText + '</span>',
      '</div>',
      swarmBtnHtml,
      '<button type="button" id="agy-open-sidecar-btn">',
      '  <span style="display:inline-flex;align-items:center;gap:6px;"><span class="agy-m-icon">' + ICONS.panel + '</span><span>' + ct('pop_open_panel', null, lang) + '</span></span>',
      '  <span class="agy-m-icon">' + ICONS.arrow + '</span>',
      '</button>'
    ].join('');
  }

  window.__AGY_RING_RENDER__ = function() {
    ensureStyles();

    const convId = getActiveConvId();
    const r = window.__AGY_RING_DATA__;
    const hasContext = Boolean(
      convId &&
      r &&
      !r.error &&
      (r.conversation_id === convId || !r.conversation_id) &&
      Number(r.used_tokens) > 0
    );

    setHideStyles(!hasContext);
    renderTopTitlebar(hasContext ? r : null);

    if (!hasContext) {
      const wrap = document.getElementById(RING_ID);
      if (wrap) {
        wrap.style.display = 'none';
        const pop = wrap.querySelector('#' + POPOVER_ID);
        const btn = wrap.querySelector('#agy-ring-btn');
        if (pop) pop.classList.remove('open');
        if (btn) btn.classList.remove('active');
      }
      const newTabCard = document.getElementById(NEW_TAB_CARD_ID);
      if (newTabCard) newTabCard.style.display = 'none';

      document.querySelectorAll('[data-tab-id="sidecar__desktop-context/context__/"]').forEach((t) => {
        t.style.display = 'none';
      });

      const activePluginTab = document.querySelector('[data-tab-id="sidecar__desktop-context/context__/"][aria-selected="true"], [data-tab-id="sidecar__desktop-context/context__/"][data-selected="true"], [data-tab-id="sidecar__desktop-context/context__/"].bg-secondary');
      if (activePluginTab) {
        const otherTabs = Array.from(document.querySelectorAll('[data-tab-id]:not([data-tab-id="sidecar__desktop-context/context__/"])'))
          .filter((t) => t.style.display !== 'none' && t.offsetParent !== null);
        if (otherTabs.length > 0) {
          otherTabs[0].click();
        } else {
          const toggleAuxBtn = document.querySelector('[data-testid="toggle-aux-sidebar"]');
          const auxSidebar = document.querySelector('[data-side-panel-open="true"], [data-aux-pane-open="true"], [data-testid="aux-sidebar"], [class*="aux-sidebar"]');
          if (auxSidebar && toggleAuxBtn && auxSidebar.getBoundingClientRect().width > 20) {
            toggleAuxBtn.click();
          }
        }
      }
      return;
    }

    ensureAuxNewTabEntry();
    const newTabCard = document.getElementById(NEW_TAB_CARD_ID);
    if (newTabCard) newTabCard.style.display = '';

    document.querySelectorAll('[data-tab-id="sidecar__desktop-context/context__/"]').forEach((t) => {
      t.style.display = '';
    });

    if (window.__AGY_RING_TTL_TICK__) window.__AGY_RING_TTL_TICK__();

    const target = findInputToolbar();
    if (!target || !target.container) return;

    let wrap = document.getElementById(RING_ID);
    if (wrap && wrap.dataset.v !== '7') {
      wrap.remove();
      wrap = null;
    }
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = RING_ID;
      wrap.dataset.v = '7';
      wrap.setAttribute('data-ag-localization-skip', 'true');
      wrap.innerHTML = [
        '<button type="button" id="agy-ring-btn">',
        '  <svg width="13" height="13" viewBox="0 0 36 36" style="transform: rotate(-90deg); flex: none;">',
        '    <circle cx="18" cy="18" r="14.5" fill="none" stroke="currentColor" stroke-opacity="0.22" stroke-width="3.4"></circle>',
        '    <circle id="agy-ring-arc" cx="18" cy="18" r="14.5" fill="none" stroke="#10b981" stroke-width="3.6" stroke-dasharray="0 100" stroke-linecap="round" pathLength="100"></circle>',
        '  </svg>',
        '  <span id="agy-ring-label">--%</span>',
        '  <span id="agy-ring-ttl"><span id="agy-ring-ttl-dot"></span><span id="agy-ring-ttl-txt"></span></span>',
        '</button>',
        '<div id="' + POPOVER_ID + '"></div>'
      ].join('');

      const btn = wrap.querySelector('#agy-ring-btn');
      const pop = wrap.querySelector('#' + POPOVER_ID);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = pop.classList.toggle('open');
        btn.classList.toggle('active', isOpen);
        if (isOpen) {
          if (window.__AGY_RING_TTL_TICK__) window.__AGY_RING_TTL_TICK__();
          positionPopover(btn, pop);
        }
      });
      pop.addEventListener('click', (e) => {
        e.stopPropagation();
        const swarmBtn = e.target.closest('#agy-open-swarm-btn');
        if (swarmBtn) {
          pop.classList.remove('open');
          btn.classList.remove('active');
          if (window.__AGY_OPEN_CONTEXT_SIDECAR__) {
            window.__AGY_OPEN_CONTEXT_SIDECAR__('swarm');
          } else {
            openContextSidecar('swarm');
          }
          return;
        }
        const openBtn = e.target.closest('#agy-open-sidecar-btn');
        if (openBtn) {
          pop.classList.remove('open');
          btn.classList.remove('active');
          if (window.__AGY_OPEN_CONTEXT_SIDECAR__) {
            window.__AGY_OPEN_CONTEXT_SIDECAR__('single');
          } else {
            openContextSidecar('single');
          }
        }
      });
      document.addEventListener('click', () => {
        pop.classList.remove('open');
        btn.classList.remove('active');
      });
      window.addEventListener('resize', () => {
        if (pop.classList.contains('open')) positionPopover(btn, pop);
      });
    }

    wrap.style.display = 'inline-flex';

    if (wrap.parentElement !== target.container || (target.anchorBtn && wrap.nextElementSibling !== target.anchorBtn)) {
      if (target.mode === 'toolbar' && target.anchorBtn) {
        target.container.insertBefore(wrap, target.anchorBtn);
      } else {
        target.container.appendChild(wrap);
      }
    }

    const btn = wrap.querySelector('#agy-ring-btn');
    const arc = wrap.querySelector('#agy-ring-arc');
    const label = wrap.querySelector('#agy-ring-label');
    const pop = wrap.querySelector('#' + POPOVER_ID);

    const nativeLimit = Number(r.limit_tokens) || 1048576;
    const rawBudget = Number(r.request_budget_tokens) || 0;
    const limit = rawBudget > 0 ? rawBudget : nativeLimit;
    const used = Number(r.used_tokens) || 0;
    const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : (Number(r.used_pct) || 0);
    const free = Math.max(0, limit - used);
    const color = ringColor(pct);
    const dash = Math.min(100, Math.max(1, pct));
    arc.setAttribute('stroke', color);
    arc.setAttribute('stroke-dasharray', dash + ' 100');
    label.textContent = pct.toFixed(1) + '%';

    const tel = r.telemetry || {};
    const sum = tel.summary || {};
    const cacheBustCount = Number(r.cache_bust_count ?? sum.cache_bust_count ?? 0) || 0;
    const cacheBustTokens = Number(r.cache_bust_tokens ?? sum.cache_bust_tokens ?? 0) || 0;
    const sm = r.swarm_meta || r.cluster || {};
    const hasCluster = Boolean(sm && sm.has_cluster);
    const lang = resolveClientLang();

    const dataSig = [
      lang,
      r.conversation_id,
      used,
      limit,
      nativeLimit,
      tel.total_calls,
      r.last_turn_at || tel.last_turn_at || '',
      cacheBustCount,
      cacheBustTokens,
      hasCluster ? sm.active_count + '/' + sm.member_count + ':' + sm.total_turns + ':' + sm.cache_bust_count : '0'
    ].join('|');

    if (pop.dataset.sig !== dataSig) {
      pop.dataset.sig = dataSig;
      pop.innerHTML = buildPopoverContentHtml(r, used, limit, nativeLimit, pct, free, lang);
    }

    if (window.__AGY_RING_TTL_TICK__) window.__AGY_RING_TTL_TICK__();

    if (pop.classList.contains('open')) {
      positionPopover(btn, pop);
    }
  };

  if (!window.__AGY_RING_OBSERVER__) {
    window.__AGY_RING_OBSERVER__ = true;
    setInterval(() => {
      if (window.__AGY_RING_RENDER__) window.__AGY_RING_RENDER__();
    }, 800);
  }

  if (!window.__AGY_RING_TTL_TIMER__) {
    window.__AGY_RING_TTL_TIMER__ = setInterval(() => {
      if (window.__AGY_RING_TTL_TICK__) window.__AGY_RING_TTL_TICK__();
    }, 1000);
  }

  function bootNativeBridgeLoop() {
    const bridge = window.__agContextBridge;
    if (!bridge || typeof bridge.getSnapshot !== 'function') return;
    if (window.__AGY_BRIDGE_LOOP_STARTED__) return;
    window.__AGY_BRIDGE_LOOP_STARTED__ = true;

    let syncing = false;
    let pendingForce = false;
    let lastConvId = null;
    let lastResetsStamp = '';

    async function syncFromBridge(force) {
      if (syncing) {
        if (force) pendingForce = true;
        return;
      }
      if (!force && document.hidden) return;
      syncing = true;
      try {
        const convId = getActiveConvId() || '';
        lastConvId = convId;
        const snap = await bridge.getSnapshot(convId);
        if (!snap || typeof snap !== 'object' || snap.ok === false) return;

        let langChanged = false;
        if (snap.lang && snap.lang !== window.__AGY_CONFIG_LANG__) {
          window.__AGY_CONFIG_LANG__ = normalizeLangCode(snap.lang);
          langChanged = true;
          broadcastLangToSidecarIframes();
        }

        if (snap.resets && (snap.resetsStamp !== lastResetsStamp || !window.__AGY_RESETS_DATA__ || langChanged)) {
          lastResetsStamp = String(snap.resetsStamp || '');
          const rPayload = snap.resets;
          if (rPayload && typeof rPayload === 'object') {
            if (rPayload.data && typeof rPayload.data === 'object') {
              window.__AGY_RESETS_DATA__ = rPayload.data;
            } else if (rPayload.sources && typeof rPayload.sources === 'object') {
              window.__AGY_RESETS_DATA__ = rPayload;
            }
          }
          const rPop = document.getElementById(RESETS_POPOVER_ID);
          if (rPop && rPop.classList.contains('open')) {
            renderResetsPopover();
          }
        }

        const currentConvId = getActiveConvId() || '';
        if (currentConvId !== convId) {
          pendingForce = true;
          return;
        }

        if (convId) {
          window.__AGY_RING_DATA__ = snap.report || { error: 'no-context' };
        } else {
          window.__AGY_RING_DATA__ = null;
        }
        if (window.__AGY_RING_RENDER__) window.__AGY_RING_RENDER__();
      } catch (_) {
      } finally {
        syncing = false;
        if (pendingForce) {
          pendingForce = false;
          setTimeout(() => { void syncFromBridge(true); }, 80);
        }
      }
    }

    window.__AGY_BRIDGE_SYNC_NOW__ = () => syncFromBridge(true);
    void syncFromBridge(true);

    setInterval(() => {
      void syncFromBridge(false);
    }, 2500);

    setInterval(() => {
      if (document.hidden) return;
      const cur = getActiveConvId() || '';
      if (cur !== lastConvId) {
        void syncFromBridge(true);
      }
    }, 450);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void syncFromBridge(true);
    });
  }

  bootNativeBridgeLoop();
  window.__AGY_RING_RENDER__();
  return getActiveConvId();
})();
`;

function cdpCall(ws, method, params = {}) {
  return new Promise((resolve) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      resolve(null);
      return;
    }
    const id = ++cdpMsgId;
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMsg);
      resolve(null);
    }, 2000);

    function onMsg(event) {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.id === id) {
          clearTimeout(timer);
          ws.removeEventListener('message', onMsg);
          resolve(msg.result ?? null);
        }
      } catch {}
    }

    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function connectPage(page, onAllClosed) {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {}
        resolve(null);
      }, 2000);

      ws.addEventListener('open', () => {
        clearTimeout(timer);
        const entry = { ws, pageId: page.id };
        activePages.set(page.id, entry);
        resolve(entry);
      });

      ws.addEventListener('close', () => {
        activePages.delete(page.id);
        if (activePages.size === 0 && onAllClosed) {
          onAllClosed();
        }
      });
      ws.addEventListener('error', () => activePages.delete(page.id));
    } catch {
      resolve(null);
    }
  });
}

export function startRingInjector(options = {}) {
  const isSidecarHosted = Boolean(options.sidecarHosted);
  const getReport = options.getReport || standaloneContextReport;
  const onActiveConversation = options.onActiveConversation || null;
  const isBridgeActive = typeof options.isBridgeActive === 'function' ? options.isBridgeActive : () => false;

  let ticking = false;
  let fastPolling = false;
  let unreachableCount = 0;
  let cachedResetsStamp = '';
  let cachedResetsPayload = null;
  let inFlightResetsRefresh = null;

  function getResetsDiskStamp() {
    try {
      const p = getResetWatchCachePath();
      const st = fs.statSync(p);
      return `${st.mtimeMs}:${st.size}`;
    } catch {
      return 'missing';
    }
  }

  function readCachedResetsState(forceReload = false) {
    const diskStamp = getResetsDiskStamp();
    if (!forceReload && cachedResetsPayload && diskStamp === cachedResetsStamp) {
      return cachedResetsPayload;
    }
    cachedResetsPayload = getResetWatchState();
    cachedResetsStamp = getResetsDiskStamp();
    return cachedResetsPayload;
  }

  async function pushResetsToEntry(entry, payload, stamp) {
    if (!entry || !entry.ws || entry.ws.readyState !== WebSocket.OPEN) return;
    await cdpCall(entry.ws, 'Runtime.evaluate', {
      expression: `if (window.__AGY_RESETS_UPDATE__) window.__AGY_RESETS_UPDATE__(${JSON.stringify(payload)}); else window.__AGY_RESETS_DATA__ = ${JSON.stringify(payload?.data || null)};`,
      returnByValue: false,
    });
    if (stamp) entry.resetsStamp = stamp;
  }

  function triggerHostResetsRefresh(provider = 'all') {
    if (inFlightResetsRefresh) return inFlightResetsRefresh;
    inFlightResetsRefresh = (async () => {
      try {
        const res = await refreshResetWatchAsync({ provider });
        cachedResetsPayload = res;
        cachedResetsStamp = getResetsDiskStamp();
        await Promise.all(
          Array.from(activePages.values()).map((entry) => pushResetsToEntry(entry, res, cachedResetsStamp))
        );
        return res;
      } catch (err) {
        const errPayload = {
          ok: false,
          error: err?.message || '请求失败',
          data: cachedResetsPayload?.data || null,
        };
        await Promise.all(
          Array.from(activePages.values()).map((entry) => pushResetsToEntry(entry, errPayload, cachedResetsStamp))
        );
        return errPayload;
      } finally {
        inFlightResetsRefresh = null;
      }
    })();
    return inFlightResetsRefresh;
  }

  async function fastPollResetsBridge() {
    if (fastPolling || activePages.size === 0 || isBridgeActive()) return;
    fastPolling = true;
    try {
      for (const entry of activePages.values()) {
        if (!entry.ws || entry.ws.readyState !== WebSocket.OPEN) continue;
        const reqEval = await cdpCall(entry.ws, 'Runtime.evaluate', {
          expression: `(() => { const r = window.__AGY_RESETS_REFRESH_REQ__; if (r) { window.__AGY_RESETS_REFRESH_REQ__ = null; return String(r); } return window.__AGY_RESETS_DATA__ ? '' : '__seed__'; })()`,
          returnByValue: true,
        });
        const sig = reqEval?.result?.value || '';
        if (!sig) continue;
        if (sig === '__seed__') {
          const state = readCachedResetsState(false);
          await pushResetsToEntry(entry, state, cachedResetsStamp);
        } else {
          void triggerHostResetsRefresh(sig);
        }
      }
    } finally {
      fastPolling = false;
    }
  }

  function releaseLockAndExit(reason) {
    if (isSidecarHosted) return;
    try {
      if (fs.existsSync(PID_FILE)) {
        const current = Number.parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
        if (current === process.pid) fs.unlinkSync(PID_FILE);
      }
    } catch {}
    for (const entry of activePages.values()) {
      try {
        entry.ws.close();
      } catch {}
    }
    console.log(`[agy-input-ring] stopped (${reason})`);
    process.exit(0);
  }

  if (!isSidecarHosted) {
    try {
      if (fs.existsSync(PID_FILE)) {
        const oldPid = Number.parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
        if (oldPid && oldPid !== process.pid) {
          try {
            process.kill(oldPid, 0);
            process.exit(0);
          } catch {}
        }
      }
      fs.writeFileSync(PID_FILE, String(process.pid));
    } catch {}
    process.on('SIGINT', () => releaseLockAndExit('SIGINT'));
    process.on('SIGTERM', () => releaseLockAndExit('SIGTERM'));
  }

  async function tick() {
    if (ticking) return;
    if (isBridgeActive()) {
      for (const [id, entry] of activePages.entries()) {
        try { entry.ws.close(); } catch {}
        activePages.delete(id);
      }
      return;
    }
    ticking = true;
    try {
      if (!isSidecarHosted) {
        const running = await isAntigravityAppRunning();
        if (!running) {
          releaseLockAndExit('Antigravity process not found');
          return;
        }
      }

      const port = readDevToolsPort();
      if (!port) return;

      const pages = await listTargetPages(port);
      if (pages === null) {
        unreachableCount += 1;
        if (!isSidecarHosted && unreachableCount >= 3 && !(await isAntigravityAppRunning())) {
          releaseLockAndExit('DevTools port closed');
          return;
        }
        return;
      }
      unreachableCount = 0;

      const seenIds = new Set(pages.map((p) => p.id));
      for (const [id, entry] of activePages.entries()) {
        if (!seenIds.has(id) || entry.ws.readyState !== WebSocket.OPEN) {
          try {
            entry.ws.close();
          } catch {}
          activePages.delete(id);
        }
      }

      const resetsState = readCachedResetsState(false);
      const liveCfg = readContextProConfig();

      for (const page of pages) {
        let entry = activePages.get(page.id);
        if (!entry) {
          entry = await connectPage(page, async () => {
            if (!isSidecarHosted && !(await isAntigravityAppRunning())) {
              releaseLockAndExit('Antigravity exited');
            }
          });
        }
        if (!entry) continue;

        const evalRes = await cdpCall(entry.ws, 'Runtime.evaluate', {
          expression: `window.__AGY_CONFIG_LANG__ = ${JSON.stringify(liveCfg.lang)}; ${CLIENT_UI_SCRIPT}`,
          returnByValue: true,
        });

        if (entry.resetsStamp !== cachedResetsStamp) {
          await pushResetsToEntry(entry, resetsState, cachedResetsStamp);
        }

        const convId = evalRes?.result?.value || '';
        if (convId && /^[0-9a-f-]{36}$/i.test(convId)) {
          if (onActiveConversation) onActiveConversation(convId);
          try {
            fs.writeFileSync(ACTIVE_CONV_FILE, convId);
          } catch {}

          const report = await getReport(convId);
          if (report && !report.error && Number(report.used_tokens) > 0) {
            await cdpCall(entry.ws, 'Runtime.evaluate', {
              expression: `window.__AGY_RING_DATA__ = ${JSON.stringify(report)}; if (window.__AGY_RING_RENDER__) window.__AGY_RING_RENDER__();`,
              returnByValue: false,
            });
          } else {
            await cdpCall(entry.ws, 'Runtime.evaluate', {
              expression: `window.__AGY_RING_DATA__ = ${JSON.stringify(report || { error: 'no-context' })}; if (window.__AGY_RING_RENDER__) window.__AGY_RING_RENDER__();`,
              returnByValue: false,
            });
          }
        } else {
          // No active conversation (e.g. brand new conversation screen)
          if (onActiveConversation) onActiveConversation('');
          try {
            if (fs.existsSync(ACTIVE_CONV_FILE)) fs.unlinkSync(ACTIVE_CONV_FILE);
          } catch {}

          await cdpCall(entry.ws, 'Runtime.evaluate', {
            expression: `window.__AGY_RING_DATA__ = null; if (window.__AGY_RING_RENDER__) window.__AGY_RING_RENDER__();`,
            returnByValue: false,
          });
        }
      }
    } finally {
      ticking = false;
    }
  }

  tick();
  setInterval(tick, POLL_INTERVAL_MS);
  setInterval(fastPollResetsBridge, 280);
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  startRingInjector({ sidecarHosted: false });
}
