// Sidecar backend for the Context Usage panel & Input Box Context Ring.
//
// Forked from https://github.com/dimitr-io/antigravity-desktop-context (MIT License)
// Enhanced with:
// - Cross-platform active conversation tracking (so pinned tabs never break)
// - Native hosting of the Input Box Context Ring & Telemetry Popover injector
// - DeepSeek Harness-style per-turn call telemetry & tool token inspection

import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Response, SidecarApp } from 'sidecar_sdk';
import { normalizeLangSetting, readContextProConfig, resolveConfigPath, updateContextProConfigLang } from './config.mjs';
import { ACTIVE_CONV_FILE, CLIENT_UI_SCRIPT, startRingInjector } from './inject-ring.mjs';
import { getResetWatchCachePath, getResetWatchState, refreshResetWatchAsync } from './resets_watch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'context_report.py');
const SWARM_SCRIPT = join(HERE, 'swarm_radar.py');
const GEMINI_DIR = process.env.ANTIGRAVITY_GEMINI_DIR || join(homedir(), '.gemini');
const CONVERSATIONS = join(GEMINI_DIR, 'antigravity', 'conversations');
const DATA_DIR = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR || join(HERE, '.data');
const BRIDGE_RUNTIME_PATH = join(GEMINI_DIR, 'context-pro-bridge.json');
const CATALOG_PATH = join(DATA_DIR, 'model-catalog.json');
const CATALOG_TTL_MS = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let latestActiveConvId = '';
let latestActiveConvAt = 0;
let lastBridgeActivityAt = 0;

const app = new SidecarApp();

// --- python -------------------------------------------------------------------

const PYTHON_CANDIDATES = process.platform === 'win32'
  ? [['python', []], ['py', ['-3']], ['python3', []]]
  : [['python3', []], ['python', []]];
let python = null;

function run(cmd, args, timeout = 20000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, {
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      windowsHide: true,
    }, (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout)));
  });
}

async function findPython() {
  if (python) return python;
  for (const [cmd, pre] of PYTHON_CANDIDATES) {
    try {
      const out = await run(cmd, [...pre, '--version'], 5000);
      if (/^Python 3\./.test(out.trim())) {
        python = { cmd, pre };
        return python;
      }
    } catch { /* try the next candidate */ }
  }
  throw new Error('Python 3 not found. Install it from python.org and restart Antigravity.');
}

// --- live model catalog -------------------------------------------------------

let catalogFetchedAt = 0;
let quotaFetchedAt = 0;
let liveQuotaState = { byKey: {}, pools: {} };

function updateQuotaState(models) {
  const byKey = {};
  const pools = {};
  for (const [id, m] of Object.entries(models || {})) {
    if (m?.isInternal) continue;
    const qi = m?.quotaInfo;
    if (!qi || typeof qi.remainingFraction !== 'number') continue;
    const pct = Math.max(0, Math.min(100, Math.round(qi.remainingFraction * 1000) / 10));
    const resetTime = qi.resetTime || '';
    if (!resetTime) continue;
    const provider = String(m.modelProvider || '');
    const pool = provider.includes('GOOGLE') ? 'google' : 'third_party';
    const entry = {
      id,
      displayName: m.displayName || id,
      pool,
      remaining_pct: pct,
      reset_time: resetTime,
    };
    byKey[id.toLowerCase()] = entry;
    if (m.displayName) byKey[String(m.displayName).toLowerCase()] = entry;
    if (!pools[pool]) {
      pools[pool] = { remaining_pct: pct, reset_time: resetTime };
    }
  }
  liveQuotaState = { byKey, pools };
}

function resolveQuotaForModel(modelStr) {
  const raw = String(modelStr || '').trim().toLowerCase();
  const { byKey, pools } = liveQuotaState;
  let matched = raw ? byKey[raw] : null;
  if (!matched && raw) {
    for (const [k, v] of Object.entries(byKey)) {
      if (raw.includes(k) || k.includes(raw)) {
        matched = v;
        break;
      }
    }
  }
  if (!matched) {
    if (raw.includes('claude') || raw.includes('opus') || raw.includes('sonnet') || raw.includes('gpt')) {
      matched = pools.third_party ? { ...pools.third_party, pool: 'third_party' } : null;
    } else {
      matched = pools.google ? { ...pools.google, pool: 'google' } : null;
    }
  }
  if (!matched && !Object.keys(pools).length) return null;
  return {
    remaining_pct: matched ? matched.remaining_pct : null,
    reset_time: matched ? matched.reset_time : '',
    pool: matched ? matched.pool : '',
    google: pools.google || null,
    third_party: pools.third_party || null,
  };
}

function lsRequest(method, body) {
  const addr = (process.env.ANTIGRAVITY_LS_ADDRESS || '').trim();
  const csrf = (process.env.ANTIGRAVITY_CSRF_TOKEN || '').trim();
  if (!addr || !csrf) return Promise.reject(new Error('no language server address'));
  const base = new URL(addr.startsWith('http') ? addr : `http://${addr}`);
  const data = JSON.stringify(body);
  const transport = base.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request({
      hostname: base.hostname,
      port: base.port,
      path: `/exa.language_server_pb.LanguageServerService/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'x-codeium-csrf-token': csrf,
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: 5000,
      rejectUnauthorized: false,
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${method}: HTTP ${res.statusCode}`));
          return;
        }
        try { resolve(JSON.parse(text)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`${method}: timeout`)));
    req.on('error', reject);
    req.end(data);
  });
}

async function refreshCatalog() {
  const now = Date.now();
  const needQuota = now - quotaFetchedAt >= 25 * 1000;
  const needCatalog = now - catalogFetchedAt >= CATALOG_TTL_MS || !existsSync(CATALOG_PATH);
  if (!needQuota && !needCatalog) return;
  quotaFetchedAt = now;
  try {
    const resp = await lsRequest('GetAvailableModels', { metadata: { ideName: 'antigravity', extensionName: 'antigravity' } });
    const models = resp?.response?.models || resp?.models || {};
    updateQuotaState(models);
    if (needCatalog) {
      catalogFetchedAt = now;
      const catalog = {};
      for (const [id, m] of Object.entries(models)) {
        const maxTokens = Number(m?.maxTokens) || 0;
        if (maxTokens > 0) catalog[id] = { maxTokens, displayName: m.displayName || '' };
      }
      if (Object.keys(catalog).length) {
        mkdirSync(DATA_DIR, { recursive: true });
        writeFileSync(CATALOG_PATH, JSON.stringify(catalog));
      }
    }
  } catch (err) {
    console.error('[context] model catalog unavailable, using built-in limits:', err.message);
  }
}

// --- report -------------------------------------------------------------------

const cache = new Map(); // conversationId -> { key, report }

function workspacePath(uri) {
  if (!uri || !uri.startsWith('file:')) return '';
  let p = decodeURIComponent(uri.replace(/^file:\/\//, ''));
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  return p;
}

function fileStamp(path) {
  try {
    const s = statSync(path);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return '-';
  }
}

function resolveConversationId(requestedId) {
  // Prefer the live active conversation tracked by inject-ring (so pinned tabs
  // and plugin:// iframes opened without ?conversationId= always track the active chat)
  if (
    latestActiveConvId &&
    Date.now() - latestActiveConvAt < 60000 &&
    UUID.test(latestActiveConvId) &&
    existsSync(join(CONVERSATIONS, `${latestActiveConvId}.db`))
  ) {
    return latestActiveConvId;
  }

  // If an explicit conversationId was passed:
  if (UUID.test(requestedId || '')) {
    return requestedId;
  }

  // If inject-ring recently confirmed no active conversation (e.g. New Conversation screen)
  if (latestActiveConvAt > 0 && Date.now() - latestActiveConvAt < 60000 && !latestActiveConvId) {
    return '';
  }

  try {
    if (existsSync(ACTIVE_CONV_FILE)) {
      const st = statSync(ACTIVE_CONV_FILE);
      if (Date.now() - st.mtimeMs < 60000) {
        const activeId = readFileSync(ACTIVE_CONV_FILE, 'utf8').trim();
        if (UUID.test(activeId) && existsSync(join(CONVERSATIONS, `${activeId}.db`))) {
          return activeId;
        }
      }
    }
  } catch {}

  // Do not guess the newest DB file when no conversation is active
  return '';
}

const swarmCache = new Map(); // cacheKey -> { fetchedAt, data }
const SWARM_CACHE_TTL_MS = 2000;

function extractClusterSummary(radar) {
  if (!radar || !radar.has_cluster) {
    return { has_cluster: false, audit_enabled: Boolean(radar?.audit_enabled) };
  }
  const s = radar.summary || {};
  return {
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
    waiting_count: Number(s.waiting_count) || 0,
    killed_count: Number(s.killed_count) || 0,
    total_turns: Number(s.total_turns) || 0,
    overall_hit_rate: Number(s.overall_hit_rate) || 0,
    cache_bust_count: Number(s.cache_bust_count) || 0,
    cache_bust_tokens: Number(s.cache_bust_tokens) || 0,
    violation_count: Number(s.violation_count) || 0,
    warn_count: Number(s.warn_count) || 0,
  };
}

async function swarmRadar(requestedConversationId, latestFallback = false, requestedLang = '') {
  const cfg = readContextProConfig({ geminiDir: GEMINI_DIR });
  const auditEnabled = Boolean(cfg.audit_rules?.enabled);
  const conversationId = resolveConversationId(requestedConversationId);
  if (!latestFallback && !UUID.test(conversationId || '')) {
    return { has_cluster: false, audit_enabled: auditEnabled, config_lang: cfg.lang, conversation_id: '' };
  }
  const normReqLang = requestedLang ? normalizeLangSetting(requestedLang) : '';
  const effLang = (normReqLang === 'zh' || normReqLang === 'en')
    ? normReqLang
    : (cfg.lang === 'zh' || cfg.lang === 'en' ? cfg.lang : '');
  const cfgStamp = fileStamp(resolveConfigPath({ geminiDir: GEMINI_DIR }));
  const cacheKey = `${conversationId || '_none_'}|${latestFallback ? '1' : '0'}|${effLang}|${cfgStamp}`;
  const hit = swarmCache.get(cacheKey);
  if (hit && Date.now() - hit.fetchedAt < SWARM_CACHE_TTL_MS) {
    return hit.data;
  }
  if (!existsSync(SWARM_SCRIPT)) {
    return { has_cluster: false, audit_enabled: auditEnabled, config_lang: cfg.lang, conversation_id: conversationId || '' };
  }
  const { cmd, pre } = await findPython();
  const args = [...pre, SWARM_SCRIPT];
  if (conversationId) args.push(conversationId);
  args.push('--gemini-dir', GEMINI_DIR, '--json');
  if (effLang) args.push('--lang', effLang);
  if (latestFallback) args.push('--latest-fallback');
  const out = await run(cmd, args, 10000);
  const parsed = { ...JSON.parse(out), config_lang: cfg.lang, updatedAt: new Date().toISOString() };
  swarmCache.set(cacheKey, { fetchedAt: Date.now(), data: parsed });
  return parsed;
}

async function report(requestedConversationId, workspaceUri, requestedLang = '') {
  const cfg = readContextProConfig({ geminiDir: GEMINI_DIR });
  const conversationId = resolveConversationId(requestedConversationId);
  if (!UUID.test(conversationId || '')) {
    return { error: 'no-conversation', lang: cfg.lang };
  }
  const db = join(CONVERSATIONS, `${conversationId}.db`);
  if (!existsSync(db)) {
    return { error: 'no-database', lang: cfg.lang };
  }
  await refreshCatalog();
  const workspace = workspacePath(workspaceUri);
  const key = [fileStamp(db), fileStamp(`${db}-wal`), workspace, fileStamp(CATALOG_PATH)].join('|');
  let baseReport = null;
  const cached = cache.get(conversationId);
  if (cached && cached.key === key) {
    baseReport = cached.report;
  } else {
    const { cmd, pre } = await findPython();
    const args = [...pre, SCRIPT, '--db', db, '--json'];
    if (existsSync(CATALOG_PATH)) args.push('--model-catalog', CATALOG_PATH);
    if (workspace) args.push('--workspace', workspace);
    const out = await run(cmd, args);
    baseReport = JSON.parse(out);
    cache.set(conversationId, { key, report: baseReport });
  }

  let cluster = { has_cluster: false, audit_enabled: Boolean(cfg.audit_rules?.enabled) };
  try {
    const radar = await swarmRadar(conversationId, false, requestedLang);
    cluster = extractClusterSummary(radar);
  } catch { /* non-fatal */ }

  const quota = resolveQuotaForModel(baseReport?.model || baseReport?.model_id || '');

  return {
    ...baseReport,
    lang: cfg.lang,
    audit_enabled: Boolean(cfg.audit_rules?.enabled),
    quota,
    cluster,
    swarm_meta: cluster,
    updatedAt: new Date().toISOString(),
  };
}

function handleGetConfig() {
  try {
    const cfg = readContextProConfig({ geminiDir: GEMINI_DIR });
    return { ok: true, lang: cfg.lang, config: cfg };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function handleUpdateConfig(data) {
  try {
    const updated = updateContextProConfigLang(data?.lang ?? 'auto', { geminiDir: GEMINI_DIR });
    swarmCache.clear();
    return { ok: true, lang: updated.lang, config: updated };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

app.page('/', () => new Response(readFileSync(join(HERE, 'index.html'), 'utf8'), { contentType: 'text/html' }));

app.api('/config', handleGetConfig, 'GET');
app.api('/config', handleUpdateConfig, 'POST');
app.api('/api/config', handleGetConfig, 'GET');
app.api('/api/config', handleUpdateConfig, 'POST');

app.api('/api/report', async (data) => {
  try {
    return await report(data.conversationId, data.workspace, data.lang);
  } catch (err) {
    return { error: 'failed', message: err.message };
  }
}, 'GET');

app.api('/api/context', async (data) => {
  try {
    return await report(data.conversationId, data.workspace, data.lang);
  } catch (err) {
    return { error: 'failed', message: err.message };
  }
}, 'GET');

app.api('/api/swarm', async (data) => {
  try {
    const latestFallback = data.latestFallback === '1' || data.latestFallback === 'true' || data.latestFallback === true;
    return await swarmRadar(data.conversationId, latestFallback, data.lang);
  } catch (err) {
    return { error: 'failed', message: err.message };
  }
}, 'GET');

app.api('/api/resets', async (data) => {
  try {
    const wantRefresh = data?.refresh === '1' || data?.refresh === 'true' || data?.refresh === true;
    if (wantRefresh) {
      return await refreshResetWatchAsync({ provider: data?.provider || 'all' });
    }
    return getResetWatchState();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}, 'GET');

function getResetsDiskStamp() {
  try {
    const st = statSync(getResetWatchCachePath());
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return 'missing';
  }
}

function updateActiveConversationFromBridge(rawConvId) {
  const convId = typeof rawConvId === 'string' && UUID.test(rawConvId.trim()) ? rawConvId.trim() : '';
  latestActiveConvId = convId;
  latestActiveConvAt = Date.now();
  try {
    if (convId) {
      writeFileSync(ACTIVE_CONV_FILE, convId);
    } else if (existsSync(ACTIVE_CONV_FILE)) {
      unlinkSync(ACTIVE_CONV_FILE);
    }
  } catch {}
  return convId;
}

function writeBridgeRuntimeDescriptor(port) {
  if (!Number.isInteger(port) || port <= 0) return;
  try {
    mkdirSync(dirname(BRIDGE_RUNTIME_PATH), { recursive: true });
    const payload = {
      version: 1,
      pid: process.pid,
      host: '127.0.0.1',
      port,
      token: process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN || '',
      startedAt: new Date().toISOString(),
    };
    const tmpPath = `${BRIDGE_RUNTIME_PATH}.tmp.${process.pid}`;
    writeFileSync(tmpPath, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { chmodSync(tmpPath, 0o600); } catch {}
    renameSync(tmpPath, BRIDGE_RUNTIME_PATH);
    try { chmodSync(BRIDGE_RUNTIME_PATH, 0o600); } catch {}
  } catch (err) {
    console.error('[context] failed to write bridge runtime descriptor:', err.message);
  }
}

function cleanupBridgeRuntimeDescriptor() {
  try {
    if (!existsSync(BRIDGE_RUNTIME_PATH)) return;
    const parsed = JSON.parse(readFileSync(BRIDGE_RUNTIME_PATH, 'utf8'));
    if (parsed && Number(parsed.pid) === process.pid) {
      unlinkSync(BRIDGE_RUNTIME_PATH);
    }
  } catch {}
}

app.api('/api/bridge/ui-script', () => {
  lastBridgeActivityAt = Date.now();
  const cfg = readContextProConfig({ geminiDir: GEMINI_DIR });
  return {
    ok: true,
    version: '3',
    lang: cfg.lang,
    script: CLIENT_UI_SCRIPT,
  };
}, 'GET');

app.api('/api/bridge/snapshot', async (data) => {
  lastBridgeActivityAt = Date.now();
  try {
    const cfg = readContextProConfig({ geminiDir: GEMINI_DIR });
    const trackActive = data?.trackActive === '1' || data?.trackActive === 'true' || data?.trackActive === true;
    const rawConvId = typeof data?.conversationId === 'string' ? data.conversationId.trim() : '';
    const convId = trackActive
      ? updateActiveConversationFromBridge(rawConvId)
      : (UUID.test(rawConvId) ? rawConvId : '');

    let rep = null;
    if (convId) {
      rep = await report(convId, data?.workspace || '', data?.lang || '');
    }
    const resets = getResetWatchState();
    const resetsStamp = getResetsDiskStamp();
    return {
      ok: true,
      lang: cfg.lang,
      conversationId: convId,
      report: rep,
      resets,
      resetsStamp,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}, 'GET');

app.api('/api/resets/refresh', async (data) => {
  lastBridgeActivityAt = Date.now();
  try {
    return await refreshResetWatchAsync({ provider: data?.provider || 'all' });
  } catch (err) {
    return { ok: false, error: err.message };
  }
}, 'POST');

Promise.resolve(app.run())
  .then((server) => {
    const actualPort = server?.address?.()?.port || Number.parseInt(process.env.ANTIGRAVITY_SIDECAR_WEB_PORT || '', 10);
    if (actualPort > 0) writeBridgeRuntimeDescriptor(actualPort);
  })
  .catch((err) => {
    console.error('[context] sidecar startup failed:', err?.message || err);
  });

process.on('exit', cleanupBridgeRuntimeDescriptor);
process.on('SIGINT', () => { cleanupBridgeRuntimeDescriptor(); process.exit(0); });
process.on('SIGTERM', () => { cleanupBridgeRuntimeDescriptor(); process.exit(0); });

refreshCatalog();

startRingInjector({
  sidecarHosted: true,
  isBridgeActive: () => Date.now() - lastBridgeActivityAt < 60000,
  onActiveConversation: (id) => {
    latestActiveConvId = id || '';
    latestActiveConvAt = Date.now();
  },
  getReport: (id) => (id ? report(id, '') : null),
});
