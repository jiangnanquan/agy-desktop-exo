// Official Quota Reset Watch & Alerts (Manual Refresh Only + Local Disk Cache + Curated ZH Translations)
// Ported faithfully from antigravity-context-viewer (7187dcc..df015da) for zero-ASAR sidecar architecture.

import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { readContextProConfig } from './config.mjs';

export const RESET_TRACKER_SOURCES = {
  agy: {
    key: 'agy',
    name: 'Gemini (AGY)',
    siteUrl: 'https://agyresets.com/',
    statusUrl: 'https://agyresets.com/api/v1/status',
    listUrl: 'https://agyresets.com/api/v1/resets?limit=12',
  },
  codex: {
    key: 'codex',
    name: 'Codex',
    siteUrl: 'https://codex-resets.com/',
    statusUrl: 'https://codex-resets.com/api/v1/status',
    listUrl: 'https://codex-resets.com/api/v1/resets?limit=12',
  },
  claude: {
    key: 'claude',
    name: 'Claude',
    siteUrl: 'https://clauderesets.com/',
    statusUrl: 'https://clauderesets.com/api/v1/status',
    listUrl: 'https://clauderesets.com/api/v1/resets?limit=12',
  },
};

const ALLOWED_RESET_API_HOSTS = new Set([
  'agyresets.com',
  'codex-resets.com',
  'clauderesets.com',
  'api.mymemory.translated.net',
]);

// 已知官方重置公告的精选人工校对中文译文（避免机翻歧义，100% 同步 df015da）
export const KNOWN_RESET_TRANSLATIONS = {
  '2121380918355234957': '为纪念连续一周密集发布更新，我们正在全员重置 Antigravity 上的 Gemini 配额！\n\n快去用多智能体蜂群（swarms）打造些厉害的作品吧 🚀',
  '2118855362518675720': '正在全员重置 Antigravity 上的 Gemini 与 Argon 配额。\n\n本周推出了大量更新，希望大家周末都能尽情开发。下周还有更多重磅内容！',
  '2111220356178751860': '本周大家在 Antigravity 上对 Argon 和 Gemini 的热情非常高涨。\n\n现已全员重置 Argon 与 Gemini 模型配额，祝周末愉快构建！',
  '2100088051934601229': '问题已修复，已为所有人推出配额重置。',
  '2095568203799806235': '我们正在重置 Antigravity 上的 Gemini 配额。\n\nGemini 3.8 Flash 的海量调用让 TPU 都快熔化了，但我们希望你们能继续畅快开发！',
  '2079636156589994347': 'Gemini 3.6 Flash 已上线 Antigravity！我们刚刚重置了所有人的每周配额，祝开发愉快。',
  '2068054113104069058': '我们已定位并缓解了 Gemini 3.5 Flash 文本输出高概率死循环的问题，新版模型导出已上线，并已全员重置 Gemini 每周配额，欢迎立即在 Antigravity 中试用！',
  '2065159034869830019': '我们听取了大家的反馈，现已推出更清晰、更详尽的模型配额用量看板（可在最新 Antigravity 2.0 版本的设置面板中查看），同时也正在全员重置 Gemini 每周配额——继续构建吧！\n\n该看板也会在 IDE 的下一版中同步上线，但面对大家如此热烈的反馈，我们一刻也不想多等。',
  '2061960989143441735': '我们在 Antigravity 上线了新版 Gemini 3.5 Flash，冗余输出大幅减少、复杂任务耐力更强。感谢大家对模型的持续反馈，我们将继续在全栈层面快速优化体验。\n\n我们也顺手为所有用户重置了 Gemini 速率限制，方便大家立即启用新模型。',
  '2058740603563966758': '我们听到大家担心 Antigravity 现在处理简单任务消耗过多 Token，因此新增了 Gemini 3.5 Flash (Low) 来优化此类任务的消耗。内部测试显示它比 Gemini 3.5 Flash (Medium) 少生成约 45% 的 Token，并在 SWE 任务上整体优于 Gemini 3 Flash (High)。\n\n我们也已为所有付费方案重置 Gemini 配额，确保大家下周拥有充足的额度继续开发 🙂',
  '2057910616153882949': '感谢过去几天大家对 Antigravity（尤其是 IDE 部分）的所有反馈。我们从未打算取消对开发者的 IDE 支持，这件事最初在产品引导上确实应该说明得更清楚。\n\n我们在 2.0 中已明确了如何连接 IDE、修复了 Windows 上打开 IDE 的问题，并提供了恢复 IDE 设置与扩展的说明等。\n\n包含这些改进的新版 Antigravity IDE 与 Antigravity 2.0 均已发布。\n\n我们本该做得更好，因此决定再次全员重置本周的 Gemini 配额。',
  '2057656550286885284': '昨天我们将 Antigravity 限额永久提升了 3 倍，看到大家开发热情空前高涨。我们注意到有用户担心工作几轮后还是会撞到周上限——为了给大家留出更充裕的余量，我们再次将所有付费方案的每周 Gemini 配额永久提升 3 倍。\n\n同时我们已对所有付费方案重置了 Gemini 配额，别停下创造的脚步！',
  '2057331857755422922': '同步一个更新：我们正在将 Antigravity 所有付费档位的 Gemini 模型速率限制永久提升 3 倍，并全员重置本周 Gemini 配额。\n\n我们理解部分用户很快撞上了限额，希望能第一时间快速响应。后续还有更多更新，祝开发愉快！',
  '2120999993079451919': '今天我们为 dots 推送了不少优质更新，已激活「储存重置次数（Banked Reset）」，很快就会发放到大家的账号中！',
  '2026-09-04-max-weekly': 'Lydia Hallie 宣布已为所有 Claude Max 订阅用户重置每周用量限额（配合 Fable 5.1 发布及即将到来的长周末）。该公告未提及 5 小时窗口或其他订阅档位。',
};

export const RESET_TAG_I18N = {
  all: { 'zh-CN': '全员', 'zh-TW': '全員', en: 'all' },
  paid: { 'zh-CN': '付费方案', 'zh-TW': '付費方案', en: 'paid' },
  product_release: { 'zh-CN': '产品发布', 'zh-TW': '產品發布', en: 'product release' },
  model_launch: { 'zh-CN': '新模型上线', 'zh-TW': '新模型上線', en: 'model launch' },
  load: { 'zh-CN': '高负载', 'zh-TW': '高負載', en: 'high load' },
  incident: { 'zh-CN': '故障修复', 'zh-TW': '故障修復', en: 'incident' },
  backlash: { 'zh-CN': '社区反馈', 'zh-TW': '社群回饋', en: 'feedback' },
  weekly: { 'zh-CN': '周配额', 'zh-TW': '週配額', en: 'weekly' },
  rate_limit: { 'zh-CN': '速率限制', 'zh-TW': '速率限制', en: 'rate limit' },
  banked: { 'zh-CN': '储存重置', 'zh-TW': '儲存重置', en: 'banked' },
  usage_reset: { 'zh-CN': '用量重置', 'zh-TW': '用量重置', en: 'usage reset' },
  elevated: { 'zh-CN': '升温预警', 'zh-TW': '升溫預警', en: 'elevated' },
  strong: { 'zh-CN': '强预警', 'zh-TW': '強預警', en: 'strong' },
  promise: { 'zh-CN': '官方预告', 'zh-TW': '官方預告', en: 'scheduled' },
  gemini: { 'zh-CN': 'Gemini', 'zh-TW': 'Gemini', en: 'Gemini' },
  argon: { 'zh-CN': 'Argon', 'zh-TW': 'Argon', en: 'Argon' },
  five_hour: { 'zh-CN': '5小时窗口', 'zh-TW': '5小時視窗', en: '5-hour' },
};

export function localizeResetTag(rawTag, lang = 'zh-CN') {
  const k = String(rawTag || '').trim().toLowerCase();
  const normLang = lang === 'zh' ? 'zh-CN' : (String(lang || '').startsWith('en') ? 'en' : lang);
  const hit = RESET_TAG_I18N[k];
  if (!hit) return normLang === 'en' ? String(rawTag || '').replace(/_/g, ' ') : String(rawTag || '');
  return hit[normLang] || hit['zh-CN'] || String(rawTag || '');
}

function getGeminiDir() {
  return process.env.ANTIGRAVITY_GEMINI_DIR || path.join(os.homedir(), '.gemini');
}

export function getResetWatchCachePath(options = {}) {
  if (options.cachePath) return String(options.cachePath);
  if (options.targetDir) {
    const t = String(options.targetDir);
    return t.endsWith('.json') ? t : path.join(t, 'resets-watch-cache.json');
  }
  return path.join(getGeminiDir(), 'antigravity', 'sidecar_data', 'desktop-context', 'resets-watch-cache.json');
}

export function getLegacyResetTrackerPaths(options = {}) {
  if (Array.isArray(options.legacyPaths)) {
    return options.legacyPaths.filter(Boolean).map(String);
  }
  if (options.legacyPath) {
    return [String(options.legacyPath)];
  }
  // 当显式传入隔离测试路径且未指定 legacyPath 时，不自动读取宿主真实全局目录，保证单测纯净
  if (options.cachePath || options.targetDir) {
    return [];
  }
  const candidates = [];
  if (process.env.AG_DIR) {
    candidates.push(path.join(process.env.AG_DIR, 'reset_tracker_v1.json'));
  }
  const home = process.env.USERPROFILE || os.homedir();
  candidates.push(path.join(getGeminiDir(), 'antigravity', 'reset_tracker_v1.json'));
  candidates.push(path.join(home, '.gemini', 'antigravity', 'reset_tracker_v1.json'));
  return [...new Set(candidates)];
}

function detectLocalProxyUrl() {
  const envProxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy ||
    '';
  if (envProxy && /^https?:\/\//i.test(envProxy.trim())) {
    return envProxy.trim();
  }

  const localBase =
    process.env.LOCALAPPDATA ||
    (process.platform === 'win32'
      ? path.join(os.homedir(), 'AppData', 'Local')
      : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'));

  const cfgPaths = [
    process.env.ANTIGRAVITY_PROXY_CONFIG ? path.resolve(process.env.ANTIGRAVITY_PROXY_CONFIG) : null,
    path.join(localBase, 'AntigravityContextMeter', 'proxy.json'),
    path.join(localBase, 'AntigravityProxyNoTun', 'config.json'),
  ].filter(Boolean);

  for (const p of cfgPaths) {
    try {
      if (!fs.existsSync(p)) continue;
      const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!cfg || typeof cfg !== 'object') continue;
      if (cfg.enabled === false) return '';
      const url = cfg.httpProxy || cfg.proxyUrl || cfg.allProxy || '';
      if (url && /^https?:\/\//i.test(String(url).trim())) {
        return String(url).trim();
      }
    } catch {}
  }
  return '';
}

export async function requestResetApiJson(rawUrl, options = {}) {
  const timeoutMs = options.timeout || 9000;
  const redirectCount = options.redirectCount || 0;
  const parsedUrl = new URL(rawUrl);
  if (parsedUrl.protocol !== 'https:' || !ALLOWED_RESET_API_HOSTS.has(parsedUrl.hostname)) {
    throw new Error(`不受信任的重置追踪地址: ${rawUrl}`);
  }

  const headers = {
    'User-Agent': 'AntigravityContextPro/1.0',
    Accept: 'application/json',
    ...(options.headers || {}),
  };

  const proxyRaw = options.proxyUrl !== undefined ? options.proxyUrl : detectLocalProxyUrl();

  // 无显式 HTTP 代理时，优先走 Node 原生 fetch（内建 Happy Eyeballs 自动 IPv6/IPv4 切换，防 IPv6 黑洞卡超时）
  if (!proxyRaw && typeof fetch === 'function') {
    const res = await fetch(parsedUrl.toString(), {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.url) {
      const finalHost = new URL(res.url).hostname;
      if (!ALLOWED_RESET_API_HOSTS.has(finalHost)) {
        throw new Error(`不受信任的重定向目标: ${res.url}`);
      }
    }
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error(`JSON 解析失败: ${e.message}`);
    }
  }

  return new Promise((resolve, reject) => {
    const doHttpsRequest = (customAgent) => {
      const req = https.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || 443,
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'GET',
          headers,
          agent: customAgent,
          autoSelectFamily: !customAgent,
          autoSelectFamilyAttemptTimeout: 500,
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            if (redirectCount >= 3) return reject(new Error('重置 API 重定向次数过多'));
            const nextUrl = new URL(res.headers.location, parsedUrl).toString();
            requestResetApiJson(nextUrl, { ...options, redirectCount: redirectCount + 1 }).then(resolve, reject);
            return;
          }
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            if (res.statusCode !== 200) {
              reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 120)}`));
              return;
            }
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error(`JSON 解析失败: ${e.message}`));
            }
          });
        }
      );
      req.setTimeout(timeoutMs, () => req.destroy(new Error(`请求超时 (${timeoutMs}ms)`)));
      req.on('error', reject);
      req.end();
    };

    if (proxyRaw) {
      try {
        const proxyUrl = new URL(proxyRaw);
        const connectReq = http.request({
          host: proxyUrl.hostname,
          port: Number(proxyUrl.port) || 80,
          method: 'CONNECT',
          path: `${parsedUrl.hostname}:${parsedUrl.port || 443}`,
        });
        connectReq.on('connect', (res, socket) => {
          if (res.statusCode === 200) doHttpsRequest(new https.Agent({ socket }));
          else doHttpsRequest(undefined);
        });
        connectReq.on('error', () => doHttpsRequest(undefined));
        connectReq.setTimeout(Math.min(3500, timeoutMs), () => {
          connectReq.destroy();
          doHttpsRequest(undefined);
        });
        connectReq.end();
        return;
      } catch {}
    }

    doHttpsRequest(undefined);
  });
}

export function normalizeResetEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const srcObj =
    raw.source && typeof raw.source === 'object'
      ? raw.source
      : Array.isArray(raw.sources) && raw.sources[0] && typeof raw.sources[0] === 'object'
        ? raw.sources[0]
        : null;
  const author = srcObj?.author || srcObj?.handle || null;
  const url = srcObj?.url || null;
  const models = Array.isArray(raw.models)
    ? raw.models.map(String)
    : Array.isArray(raw.windows)
      ? raw.windows.map(String)
      : [];
  const plans = Array.isArray(raw.plans)
    ? raw.plans.map(String)
    : Array.isArray(raw.audience?.plans)
      ? raw.audience.plans.map(String)
      : [];
  const text = raw.text || raw.summary || srcObj?.excerpt || raw.title || '';
  const id = raw.id ? String(raw.id) : null;
  return {
    id,
    announcedAt: raw.announced_at || raw.announcedAt || null,
    kind: raw.kind || raw.reset_type || 'unspecified',
    models,
    plans,
    trigger: raw.trigger || null,
    limitChange: raw.limit_change ?? raw.limitChange ?? null,
    note: raw.note || raw.effective_note || null,
    title: raw.title || null,
    text: String(text || ''),
    textZh: id && KNOWN_RESET_TRANSLATIONS[id] ? KNOWN_RESET_TRANSLATIONS[id] : (raw.textZh || null),
    author: author ? String(author) : null,
    url: url ? String(url) : null,
  };
}

function normalizeWatchSignal(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const srcObj = raw.source && typeof raw.source === 'object' ? raw.source : null;
  return {
    level: raw.level ? String(raw.level) : 'elevated',
    reason: raw.reason ? String(raw.reason) : null,
    rule: raw.rule ? String(raw.rule) : null,
    trackRecord: raw.track_record ? String(raw.track_record) : null,
    observedAt: raw.observed_at || raw.observedAt || null,
    expiresAt: raw.expires_at || raw.expiresAt || null,
    text: raw.text ? String(raw.text) : '',
    textZh: raw.textZh || null,
    author: srcObj?.author ? String(srcObj.author) : (raw.author || null),
    url: srcObj?.url ? String(srcObj.url) : (raw.url || null),
  };
}

function normalizeScheduledReset(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const srcObj = raw.source && typeof raw.source === 'object' ? raw.source : null;
  const id = raw.id ? String(raw.id) : null;
  return {
    id,
    status: raw.status ? String(raw.status) : 'scheduled',
    announcedAt: raw.announced_at || raw.announcedAt || null,
    text: raw.text ? String(raw.text) : '',
    textZh: id && KNOWN_RESET_TRANSLATIONS[id] ? KNOWN_RESET_TRANSLATIONS[id] : (raw.textZh || null),
    author: srcObj?.author ? String(srcObj.author) : (raw.author || null),
    url: srcObj?.url ? String(srcObj.url) : (raw.url || null),
  };
}

export function normalizeResetSourcePayload(sourceKey, statusJson, listJson = null, errMsg = null, lang = 'zh') {
  const meta = RESET_TRACKER_SOURCES[sourceKey] || { key: sourceKey, name: sourceKey, siteUrl: '', statusUrl: '' };
  const isZh = String(lang || '').startsWith('zh');
  if (errMsg || !statusJson || typeof statusJson !== 'object' || !statusJson.data) {
    return {
      key: meta.key,
      name: meta.name,
      siteUrl: meta.siteUrl,
      ok: false,
      error: errMsg || (isZh ? '未获取到有效响应' : 'No valid response received'),
      latestReset: null,
      scheduledReset: null,
      activeWatch: null,
      stats: null,
      history: [],
    };
  }
  const d = statusJson.data;
  const latestReset = normalizeResetEntry(d.latest_reset);
  const scheduledReset = normalizeScheduledReset(d.scheduled_reset);
  const activeWatch = normalizeWatchSignal(d.active_watch);
  const rawStats = d.stats && typeof d.stats === 'object' ? d.stats : {};
  const stats = {
    total: typeof rawStats.total === 'number' ? rawStats.total : null,
    lastResetAt: rawStats.last_reset_at || latestReset?.announcedAt || null,
    daysSinceLast: typeof rawStats.days_since_last === 'number' ? rawStats.days_since_last : null,
    avgIntervalDays: typeof rawStats.avg_interval_days === 'number' ? rawStats.avg_interval_days : null,
    medianIntervalDays: typeof rawStats.median_interval_days === 'number' ? rawStats.median_interval_days : null,
    longestGapDays: typeof rawStats.longest_gap_days === 'number' ? rawStats.longest_gap_days : null,
  };

  let history = [];
  if (listJson && Array.isArray(listJson.data)) {
    history = listJson.data.map(normalizeResetEntry).filter(Boolean);
  } else if (latestReset) {
    history = [latestReset];
  }

  return {
    key: meta.key,
    name: meta.name,
    siteUrl: meta.siteUrl,
    ok: true,
    error: null,
    latestReset,
    scheduledReset,
    activeWatch,
    stats,
    history,
  };
}

export function postProcessResetTranslationZh(zhText) {
  if (!zhText || typeof zhText !== 'string') return '';
  return zhText
    .replace(/反重力/g, 'Antigravity')
    .replace(/法典使用限制/g, 'Codex 用量限额')
    .replace(/法典/g, 'Codex')
    .replace(/(?<!多智能体)蜂群/g, '多智能体蜂群')
    .replace(/储存重置/g, '已储存重置次数')
    .replace(/不懈的运输|不懈地运送|持续运送/g, '密集发布更新')
    .replace(/\s+([，。！？；：])/g, '$1')
    .trim();
}

function isMostlyChinese(text) {
  if (!text || typeof text !== 'string') return false;
  const han = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  return han >= 4 && han >= text.length * 0.15;
}

async function translateResetSingleText(rawText, itemId, translationsCache, options = {}) {
  const clean = String(rawText || '').replace(/https?:\/\/t\.co\/\S+/g, '').trim();
  if (!clean) return null;
  if (itemId && KNOWN_RESET_TRANSLATIONS[String(itemId)]) {
    return KNOWN_RESET_TRANSLATIONS[String(itemId)];
  }
  if (isMostlyChinese(clean)) return clean;

  const cacheKey = itemId ? `${itemId}:${clean.slice(0, 64)}` : clean.slice(0, 120);
  if (translationsCache && typeof translationsCache[cacheKey] === 'string' && translationsCache[cacheKey]) {
    return postProcessResetTranslationZh(translationsCache[cacheKey]);
  }

  // 若处于单测自定义 fetcher 且未提供 _translateText，则跳过外网机翻保持离线确定性
  if (options._fetchJson && typeof options._translateText !== 'function') {
    return null;
  }
  if (options.skipTranslate) return null;

  try {
    let translated = null;
    if (typeof options._translateText === 'function') {
      translated = await options._translateText(clean);
      if (translated) translated = postProcessResetTranslationZh(String(translated));
    } else {
      const q = clean.slice(0, 480);
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=en|zh-CN`;
      const resp = await requestResetApiJson(url, { timeout: 3800, proxyUrl: options.proxyUrl });
      if (resp && resp.responseStatus === 200 && resp.responseData?.translatedText) {
        const candidate = String(resp.responseData.translatedText).trim();
        if (candidate && !/^MYMEMORY WARNING:/i.test(candidate)) {
          translated = postProcessResetTranslationZh(candidate);
        }
      }
    }
    if (translated && translationsCache) {
      translationsCache[cacheKey] = translated;
    }
    return translated || null;
  } catch {
    return null;
  }
}

export async function enrichResetTranslations(sources, prevTranslations = {}, options = {}) {
  const translationsCache = { ...(prevTranslations || {}) };
  const tasks = [];
  const MAX_ONLINE_TRANSLATIONS = 8;
  let onlineCount = 0;

  const queueItem = (item, idHint = null) => {
    if (!item || !item.text) return;
    const itemId = item.id || idHint || null;
    if (itemId && KNOWN_RESET_TRANSLATIONS[String(itemId)]) {
      item.textZh = KNOWN_RESET_TRANSLATIONS[String(itemId)];
      return;
    }
    if (item.textZh) {
      item.textZh = postProcessResetTranslationZh(item.textZh);
      return;
    }
    const clean = String(item.text || '').replace(/https?:\/\/t\.co\/\S+/g, '').trim();
    const cacheKey = itemId ? `${itemId}:${clean.slice(0, 64)}` : clean.slice(0, 120);
    if (translationsCache[cacheKey]) {
      item.textZh = postProcessResetTranslationZh(translationsCache[cacheKey]);
      return;
    }
    if (onlineCount >= MAX_ONLINE_TRANSLATIONS) return;
    onlineCount++;
    tasks.push(
      (async () => {
        const zh = await translateResetSingleText(item.text, itemId, translationsCache, options);
        if (zh) item.textZh = zh;
      })()
    );
  };

  for (const src of Object.values(sources || {})) {
    if (!src || !src.ok) continue;
    queueItem(src.latestReset);
    queueItem(src.scheduledReset);
    queueItem(src.activeWatch, src.activeWatch?.observedAt || null);
    if (Array.isArray(src.history)) {
      for (const h of src.history) {
        queueItem(h);
        if (h && !h.textZh && src.latestReset?.id && h.id === src.latestReset.id && src.latestReset.textZh) {
          h.textZh = src.latestReset.textZh;
        }
      }
    }
  }

  if (tasks.length > 0) {
    await Promise.all(tasks);
    for (const src of Object.values(sources || {})) {
      if (!src || !Array.isArray(src.history)) continue;
      for (const h of src.history) {
        if (h && !h.textZh && src.latestReset?.id && h.id === src.latestReset.id && src.latestReset.textZh) {
          h.textZh = src.latestReset.textZh;
        }
        if (src.latestReset && !src.latestReset.textZh && h?.id && h.id === src.latestReset.id && h.textZh) {
          src.latestReset.textZh = h.textZh;
        }
      }
    }
  }

  return translationsCache;
}

export function applyLocalKnownTranslations(sources = {}, translationsCache = {}) {
  for (const [sourceKey, src] of Object.entries(sources || {})) {
    if (!src || typeof src !== 'object') continue;
    if (RESET_TRACKER_SOURCES[sourceKey]) {
      src.name = RESET_TRACKER_SOURCES[sourceKey].name;
      src.siteUrl = src.siteUrl || RESET_TRACKER_SOURCES[sourceKey].siteUrl;
    }
    if (!src.ok) continue;
    const fill = (item) => {
      if (!item) return;
      if (item.id && KNOWN_RESET_TRANSLATIONS[String(item.id)]) {
        item.textZh = KNOWN_RESET_TRANSLATIONS[String(item.id)];
        return;
      }
      if (item.textZh) {
        item.textZh = postProcessResetTranslationZh(item.textZh);
        return;
      }
      const clean = String(item.text || '').replace(/https?:\/\/t\.co\/\S+/g, '').trim();
      const cacheKey = item.id ? `${item.id}:${clean.slice(0, 64)}` : clean.slice(0, 120);
      if (translationsCache && translationsCache[cacheKey]) {
        item.textZh = postProcessResetTranslationZh(translationsCache[cacheKey]);
      }
    };
    fill(src.latestReset);
    fill(src.scheduledReset);
    fill(src.activeWatch);
    if (Array.isArray(src.history)) {
      for (const h of src.history) fill(h);
    }
  }
}

function parseStoreFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return {
      version: raw.version || '1.0.0',
      lastRefreshedAt: raw.lastRefreshedAt || null,
      acknowledged: raw.acknowledged && typeof raw.acknowledged === 'object' ? raw.acknowledged : {},
      translations: raw.translations && typeof raw.translations === 'object' ? raw.translations : {},
      sources: raw.sources && typeof raw.sources === 'object' ? raw.sources : {},
    };
  } catch {
    return null;
  }
}

export function saveResetWatchStore(store, options = {}) {
  const filePath = getResetWatchCachePath(options);
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const cleanStore = {
      version: store.version || '1.0.0',
      lastRefreshedAt: store.lastRefreshedAt || null,
      acknowledged: store.acknowledged || {},
      translations: store.translations || {},
      sources: store.sources || {},
    };
    const tmpPath = `${filePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(cleanStore, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch {
    return false;
  }
}

export function loadResetWatchStore(options = {}) {
  const primaryPath = getResetWatchCachePath(options);
  const primary = parseStoreFile(primaryPath);
  if (primary && Object.keys(primary.sources).length > 0) {
    return primary;
  }

  // 若主缓存尚不存在或为空，优先无缝兼容读取已有 reset_tracker_v1.json 缓存并持久化至 sidecar_data
  const legacyPaths = getLegacyResetTrackerPaths(options);
  for (const legacyPath of legacyPaths) {
    if (path.resolve(legacyPath) === path.resolve(primaryPath)) continue;
    const legacy = parseStoreFile(legacyPath);
    if (legacy && Object.keys(legacy.sources).length > 0) {
      applyLocalKnownTranslations(legacy.sources, legacy.translations);
      saveResetWatchStore(legacy, options);
      return { ...legacy, _migratedFrom: legacyPath };
    }
  }

  if (primary) return primary;

  return {
    version: '1.0.0',
    lastRefreshedAt: null,
    acknowledged: {},
    translations: {},
    sources: {},
  };
}

/**
 * 纯本地缓存读取（绝不发起任何外部网络请求）
 */
export function getResetWatchState(options = {}) {
  const cachePath = getResetWatchCachePath(options);
  const store = loadResetWatchStore(options);
  applyLocalKnownTranslations(store.sources, store.translations);
  return {
    ok: true,
    cachePath,
    migratedFrom: store._migratedFrom || null,
    data: {
      lastRefreshedAt: store.lastRefreshedAt,
      sources: store.sources,
      translations: store.translations,
      acknowledged: store.acknowledged,
    },
  };
}

/**
 * 仅在用户手工点击「刷新」按钮时触发外部 API 拉取并落盘
 */
export async function refreshResetWatchAsync(options = {}) {
  const fetcher = options._fetchJson || requestResetApiJson;
  const cfg = readContextProConfig();
  const effLang = options.lang || cfg.lang || 'auto';
  const isZh = String(effLang).startsWith('zh');
  const prevStore = loadResetWatchStore(options);
  const requested = String(options.provider || options.source || 'all').toLowerCase();
  const keys =
    requested && requested !== 'all' && RESET_TRACKER_SOURCES[requested]
      ? [requested]
      : Object.keys(RESET_TRACKER_SOURCES);

  const nextSources = { ...prevStore.sources };
  const results = await Promise.all(
    keys.map(async (key) => {
      const meta = RESET_TRACKER_SOURCES[key];
      try {
        const statusPromise = fetcher(meta.statusUrl, { timeout: 9000, proxyUrl: options.proxyUrl });
        const listPromise = meta.listUrl
          ? fetcher(meta.listUrl, { timeout: 9000, proxyUrl: options.proxyUrl }).catch(() => null)
          : Promise.resolve(null);
        const [statusJson, listJson] = await Promise.all([statusPromise, listPromise]);
        const normalized = normalizeResetSourcePayload(key, statusJson, listJson, null, effLang);
        return { key, normalized };
      } catch (err) {
        const prev = prevStore.sources?.[key] || null;
        const errMsg = err?.message || (isZh ? '请求失败' : 'Request failed');
        const fallback =
          prev && (prev.latestReset || prev.stats)
            ? { ...prev, name: meta.name, siteUrl: meta.siteUrl, ok: false, error: errMsg }
            : normalizeResetSourcePayload(key, null, null, errMsg, effLang);
        return { key, normalized: fallback };
      }
    })
  );

  for (const item of results) {
    nextSources[item.key] = item.normalized;
  }

  applyLocalKnownTranslations(nextSources, prevStore.translations);
  const nextTranslations = await enrichResetTranslations(nextSources, prevStore.translations, options);

  const nextStore = {
    version: '1.0.0',
    lastRefreshedAt: new Date(options.nowMs || Date.now()).toISOString(),
    acknowledged: prevStore.acknowledged || {},
    translations: nextTranslations,
    sources: nextSources,
  };
  saveResetWatchStore(nextStore, options);

  const anySucceeded = keys.some((k) => nextSources[k]?.ok);
  const firstErr =
    keys.map((k) => nextSources[k]?.error).find(Boolean) ||
    (isZh ? '全部重置数据源请求失败' : 'Failed to fetch all reset tracker sources');
  return {
    ok: anySucceeded,
    cachePath: getResetWatchCachePath(options),
    error: anySucceeded ? null : firstErr,
    data: {
      lastRefreshedAt: nextStore.lastRefreshedAt,
      sources: nextStore.sources,
      translations: nextStore.translations,
      acknowledged: nextStore.acknowledged,
    },
  };
}
