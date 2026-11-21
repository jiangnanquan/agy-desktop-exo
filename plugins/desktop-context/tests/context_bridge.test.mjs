import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { readContextProConfig, updateContextProConfigLang } from '../sidecars/context/config.mjs';
import { CLIENT_UI_SCRIPT } from '../sidecars/context/inject-ring.mjs';

const require = createRequire(import.meta.url);
const patcher = require('../scripts/context_bridge_patcher.js');

// ---------------------------------------------------------------------------
// 1. 主进程 IPC 桥接处理器集成测试（真实本地 HTTP Sidecar + 安全边界）
// ---------------------------------------------------------------------------

test('context_bridge IPC: 主框架可拉取 UI 脚本/快照/手工刷新，子框架与越权参数被拦截', async () => {
  const tmpGemini = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-ctx-bridge-ipc-'));
  const prevGeminiDir = process.env.ANTIGRAVITY_GEMINI_DIR;
  const TOKEN = 'test-sidecar-secret-token-123';
  const requests = [];

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://127.0.0.1');
      requests.push({
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        token: req.headers['x-sidecar-token'] || '',
        body: body ? JSON.parse(body) : null,
      });

      if (req.method !== 'GET' && req.headers['x-sidecar-token'] !== TOKEN) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }

      if (url.pathname === '/api/bridge/ui-script') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, version: '2', script: CLIENT_UI_SCRIPT }));
        return;
      }
      if (url.pathname === '/api/bridge/snapshot') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          conversationId: url.searchParams.get('conversationId') || '',
          report: { used_tokens: 42000, request_budget_tokens: 200000, limit_tokens: 1000000 },
          resets: { ok: true, data: { lastRefreshedAt: '2026-11-20T00:00:00Z', sources: {} } },
          resetsStamp: '100:20',
        }));
        return;
      }
      if (url.pathname === '/api/resets/refresh') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, refreshed: true, data: { sources: {} } }));
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    process.env.ANTIGRAVITY_GEMINI_DIR = tmpGemini;
    fs.writeFileSync(
      path.join(tmpGemini, 'context-pro-bridge.json'),
      JSON.stringify({ version: 1, pid: process.pid, host: '127.0.0.1', port, token: TOKEN }),
      'utf8'
    );

    // 通过 buildPatchedIpcHandlers 抽取出真实注入进 ipcHandlers.js 的代码并运行
    const fakeIpcSource = 'function registerIpcHandlers() {\n}\n';
    const patchedIpc = patcher.buildPatchedIpcHandlers(fakeIpcSource);
    const handlers = new Map();
    const mockElectron = {
      ipcMain: {
        removeHandler: (ch) => handlers.delete(ch),
        handle: (ch, fn) => handlers.set(ch, fn),
      },
    };
    const sandbox = {
      electron_1: mockElectron,
      require,
      process,
      console,
      Buffer,
      URL,
      encodeURIComponent,
      setTimeout,
      clearTimeout,
    };
    vm.runInNewContext(`${patchedIpc}\nregisterIpcHandlers();`, sandbox);

    assert.equal(handlers.has('ag-ux:context-ui-script'), true);
    assert.equal(handlers.has('ag-ux:context-snapshot'), true);
    assert.equal(handlers.has('ag-ux:context-resets-refresh'), true);

    const mainEvent = { senderFrame: { parent: null } };
    const subEvent = { senderFrame: { parent: {} } };

    // 1. 子框架调用必须被拒绝
    await assert.rejects(
      () => handlers.get('ag-ux:context-ui-script')(subEvent),
      /Unauthorized subframe/
    );

    // 2. 主框架拉取 UI 脚本
    const uiRes = await handlers.get('ag-ux:context-ui-script')(mainEvent);
    assert.equal(uiRes.ok, true);
    assert.equal(uiRes.script, CLIENT_UI_SCRIPT);

    // 3. 快照调用：合法 UUID 透传，非法 UUID 自动清洗为空串
    const validId = '11111111-2222-3333-4444-555555555555';
    const snap1 = await handlers.get('ag-ux:context-snapshot')(mainEvent, { conversationId: validId });
    assert.equal(snap1.ok, true);
    assert.equal(snap1.conversationId, validId);
    assert.equal(snap1.report.used_tokens, 42000);

    const snapBad = await handlers.get('ag-ux:context-snapshot')(mainEvent, { conversationId: '../evil?x=1' });
    assert.equal(snapBad.ok, true);
    assert.equal(snapBad.conversationId, '');

    // 4. 手工刷新：携带 x-sidecar-token 且非法 provider 归一为 all
    const refreshRes = await handlers.get('ag-ux:context-resets-refresh')(mainEvent, { provider: 'evil-site' });
    assert.equal(refreshRes.ok, true);
    assert.equal(refreshRes.refreshed, true);
    const postReq = requests.find((r) => r.path === '/api/resets/refresh');
    assert.equal(postReq.token, TOKEN);
    assert.deepEqual(postReq.body, { provider: 'all' });
  } finally {
    server.close();
    if (prevGeminiDir === undefined) delete process.env.ANTIGRAVITY_GEMINI_DIR;
    else process.env.ANTIGRAVITY_GEMINI_DIR = prevGeminiDir;
    fs.rmSync(tmpGemini, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 2. Preload 桥接层：仅在本地主窗口暴露 __agContextBridge 并自动执行 UI 脚本
// ---------------------------------------------------------------------------

test('context_bridge Preload: 本地主窗口暴露桥接并注入主世界，子帧/plugin 帧自动跳过', async () => {
  const patchedPreload = patcher.buildPatchedPreload('// base preload\n');
  new vm.Script(patchedPreload);

  // 2a. 正常主窗口 (https://127.0.0.1:60630)
  const exposed = {};
  const executedScripts = [];
  const ipcCalls = [];
  const mainWin = {
    location: { protocol: 'https:', hostname: '127.0.0.1' },
  };
  mainWin.top = mainWin;
  mainWin.self = mainWin;

  const mockElec = {
    contextBridge: {
      exposeInMainWorld: (name, api) => { exposed[name] = api; },
    },
    ipcRenderer: {
      invoke: async (ch, payload) => {
        ipcCalls.push({ ch, payload });
        if (ch === 'ag-ux:context-ui-script') {
          return { ok: true, version: '2', script: 'window.__TEST_BOOTED__ = 1;' };
        }
        return { ok: true };
      },
    },
    webFrame: {
      executeJavaScript: async (code) => { executedScripts.push(code); },
    },
  };

  const timers = [];
  const sandbox = {
    globalThis: mainWin,
    window: mainWin,
    document: { readyState: 'complete', addEventListener: () => {} },
    electron_1: mockElec,
    console,
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
  };
  vm.runInNewContext(patchedPreload, sandbox);
  assert.ok(exposed.__agContextBridge, '主窗口必须暴露 __agContextBridge');
  assert.equal(typeof exposed.__agContextBridge.getSnapshot, 'function');
  assert.equal(typeof exposed.__agContextBridge.refreshResets, 'function');

  // 触发定时回调并等待微任务完成以拉取并执行 UI 脚本
  for (const fn of timers) fn();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(executedScripts.length, 1);
  assert.equal(executedScripts[0], 'window.__TEST_BOOTED__ = 1;');

  // 2b. plugin: iframe 必须静默跳过
  const pluginExposed = {};
  const pluginWin = { location: { protocol: 'plugin:', hostname: 'desktop-context' } };
  pluginWin.top = {};
  pluginWin.self = pluginWin;
  vm.runInNewContext(patchedPreload, {
    globalThis: pluginWin,
    window: pluginWin,
    document: { readyState: 'complete', addEventListener: () => {} },
    electron_1: {
      contextBridge: { exposeInMainWorld: (n, a) => { pluginExposed[n] = a; } },
      ipcRenderer: { invoke: async () => ({ ok: true }) },
      webFrame: { executeJavaScript: async () => {} },
    },
    console,
    setTimeout: () => 0,
  });
  assert.equal(pluginExposed.__agContextBridge, undefined, 'plugin: 子帧严禁暴露桥接');
});

// ---------------------------------------------------------------------------
// 3. 真实 app.asar 沙箱叠加安装与无损剥离闭环测试（绝不修改宿主 App）
// ---------------------------------------------------------------------------

test('context_bridge_patcher: 沙箱副本叠加安装 -> 状态校验 -> 幂等重装 -> 无损剥离', () => {
  const realAsar = '/Applications/Antigravity.app/Contents/Resources/app.asar';
  if (!fs.existsSync(realAsar)) return;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-ctx-asar-sandbox-'));
  try {
    const tmpAsar = path.join(tmpDir, 'app.asar');
    const tmpBak = path.join(tmpDir, 'app.asar.bak');
    fs.copyFileSync(realAsar, tmpAsar);
    fs.copyFileSync(realAsar, tmpBak);

    const before = patcher.inspectStatus(tmpDir);

    // 第一次叠加安装
    assert.equal(patcher.installContextBridge(tmpDir, { skipSign: true }), true);
    const afterInstall = patcher.inspectStatus(tmpDir);
    assert.equal(afterInstall.hasContextBridgeIpc, true);
    assert.equal(afterInstall.hasContextBridgePreload, true);
    assert.equal(afterInstall.hasLocalization, before.hasLocalization, '不得破坏第1层汉化');
    assert.equal(afterInstall.hasMemeIpc, before.hasMemeIpc, '不得破坏第2层猫娘补丁');

    // 第二次幂等安装，确认不会出现重复标记
    assert.equal(patcher.installContextBridge(tmpDir, { skipSign: true }), true);
    const preloadTxt = patcher.AsarArchive.readFile(tmpAsar, 'dist/preload.js').toString('utf8');
    const ipcTxt = patcher.AsarArchive.readFile(tmpAsar, 'dist/ipcHandlers.js').toString('utf8');
    assert.equal(preloadTxt.split(patcher.PRELOAD_BRIDGE_SIGNATURE_START).length - 1, 1);
    assert.equal(ipcTxt.split(patcher.IPC_BRIDGE_SIGNATURE_START).length - 1, 1);
    new vm.Script(preloadTxt);
    new vm.Script(ipcTxt);

    // 无损剥离
    assert.equal(patcher.uninstallContextBridge(tmpDir, { skipSign: true }), true);
    const afterUninstall = patcher.inspectStatus(tmpDir);
    assert.equal(afterUninstall.hasContextBridgeIpc, false);
    assert.equal(afterUninstall.hasContextBridgePreload, false);
    assert.equal(afterUninstall.hasLocalization, before.hasLocalization, '卸载后第1层汉化须完好');
    assert.equal(afterUninstall.hasMemeIpc, before.hasMemeIpc, '卸载后第2层猫娘须完好');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. CLIENT_UI_SCRIPT 零 CDP 原生桥接驱动闭环测试
// ---------------------------------------------------------------------------

test('CLIENT_UI_SCRIPT Native Bridge: 零 CDP 模式下自动同步快照并支持 Promise 手工刷新', async () => {
  const listeners = new Map();
  const makeEl = (tag) => {
    const attrs = new Map();
    const classes = new Set();
    const el = {
      tagName: tag.toUpperCase(),
      id: '',
      dataset: {},
      style: {},
      textContent: '',
      children: [],
      parentElement: null,
      classList: {
        add: (...cs) => cs.forEach((c) => classes.add(c)),
        remove: (...cs) => cs.forEach((c) => classes.delete(c)),
        toggle: (c, force) => {
          const on = force === undefined ? !classes.has(c) : Boolean(force);
          if (on) classes.add(c);
          else classes.delete(c);
          return on;
        },
        contains: (c) => classes.has(c),
      },
      setAttribute: (k, v) => {
        attrs.set(k, String(v));
        if (k === 'id') el.id = String(v);
      },
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      removeAttribute: (k) => attrs.delete(k),
      appendChild: (child) => {
        child.parentElement = el;
        el.children.push(child);
        return child;
      },
      insertBefore: (child, ref) => {
        child.parentElement = el;
        const idx = ref ? el.children.indexOf(ref) : -1;
        if (idx >= 0) el.children.splice(idx, 0, child);
        else el.children.push(child);
        return child;
      },
      remove: () => {
        if (!el.parentElement) return;
        const idx = el.parentElement.children.indexOf(el);
        if (idx >= 0) el.parentElement.children.splice(idx, 1);
        el.parentElement = null;
      },
      replaceChildren: () => { el.children = []; },
      addEventListener: (ev, fn) => {
        if (!listeners.has(el)) listeners.set(el, {});
        (listeners.get(el)[ev] ||= []).push(fn);
      },
      get firstElementChild() { return el.children[0] || null; },
      getBoundingClientRect: () => ({ left: 100, right: 400, top: 8, bottom: 38, width: 300, height: 30 }),
      closest: () => null,
      querySelector: (sel) => {
        const idM = sel.match(/^#([a-z0-9_-]+)$/i);
        if (idM) {
          const stack = [...el.children];
          while (stack.length) {
            const cur = stack.shift();
            if (cur.id === idM[1]) return cur;
            stack.push(...cur.children);
          }
        }
        return null;
      },
      querySelectorAll: () => [],
      set innerHTML(html) {
        el.children = [];
        const re = /<(button|span|div|section|a)\b([^>]*)>/gi;
        let m;
        while ((m = re.exec(html))) {
          const child = makeEl(m[1]);
          const idM = m[2].match(/\bid="([^"]+)"/i);
          if (idM) child.id = idM[1];
          el.appendChild(child);
        }
      },
    };
    return el;
  };

  const head = makeEl('head');
  const body = makeEl('body');
  const toolbar = makeEl('div');
  toolbar.setAttribute('data-testid', 'pane-titlebar-toolbar');
  body.appendChild(toolbar);

  const convId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  let snapshotCalls = 0;
  let refreshCalls = 0;

  const doc = {
    head,
    body,
    hidden: false,
    createElement: makeEl,
    addEventListener: () => {},
    getElementById: (id) => head.querySelector('#' + id) || body.querySelector('#' + id),
    querySelector: (sel) => (sel === '[data-testid="pane-titlebar-toolbar"]' ? toolbar : null),
    querySelectorAll: (sel) => (sel === '[data-testid="pane-titlebar-toolbar"]' ? [toolbar] : []),
  };

  const win = {
    innerWidth: 1280,
    innerHeight: 800,
    location: { pathname: `/c/${convId}` },
    __TSR_ROUTER__: { state: { matches: [{ params: { cascadeId: convId } }], location: { pathname: `/c/${convId}` } } },
    addEventListener: () => {},
    __agContextBridge: {
      version: 1,
      getSnapshot: async (cid) => {
        snapshotCalls += 1;
        return {
          ok: true,
          conversationId: cid,
          report: {
            conversation_id: cid,
            model: 'Gemini 4 Neon',
            used_tokens: 68000,
            request_budget_tokens: 200000,
            limit_tokens: 1000000,
            last_turn_at: new Date().toISOString(),
            telemetry: { latest: { cache_hit_pct: 92 }, summary: { cache_bust_count: 0 } },
            cluster: { has_cluster: true, active_count: 2, member_count: 3, violation_count: 0, warn_count: 0 },
          },
          resets: { ok: true, data: { lastRefreshedAt: '2026-11-20T00:00:00Z', sources: {} } },
          resetsStamp: '1:1',
        };
      },
      refreshResets: async (provider) => {
        refreshCalls += 1;
        return {
          ok: true,
          data: {
            lastRefreshedAt: '2026-11-20T07:00:00Z',
            sources: { agy: { key: 'agy', ok: true, stats: { total: 15 }, history: [] } },
          },
        };
      },
    },
  };

  vm.runInNewContext(CLIENT_UI_SCRIPT, {
    window: win,
    document: doc,
    console,
    Date,
    Math,
    Number,
    String,
    Array,
    Object,
    Set,
    Promise,
    encodeURIComponent,
    setInterval: () => 0,
    setTimeout: () => 0,
    clearTimeout: () => {},
  });

  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(snapshotCalls, 1, '启动时应自动通过 __agContextBridge 拉取首帧快照');
  assert.equal(refreshCalls, 0, '初始化绝不可自动触发外部重置刷新');
  assert.equal(win.__AGY_BRIDGE_LOOP_STARTED__, true);
  assert.equal(win.__AGY_RING_DATA__.used_tokens, 68000);
  const topBar = doc.getElementById('agy-top-telemetry-bar');
  assert.ok(topBar, '顶栏遥测胶囊容器必须挂载到 pane-titlebar-toolbar');
  assert.equal(doc.getElementById('agy-tb-ctx-txt').textContent, '68k (34%)');
  assert.equal(doc.getElementById('agy-tb-swarm-txt').textContent, '2/3');
});

// ---------------------------------------------------------------------------
// 5. Antigravity v2.33.0 sidePanelV2/sidePanel panelScope 打开与关闭回归测试
// ---------------------------------------------------------------------------

test('CLIENT_UI_SCRIPT sidePanelV2: 适配 v2.33.0 panelScope，从新标签页点击可直达上下文 UI 且关闭不抖动', () => {
  const convId = '4c0bcab4-61b0-4959-a533-dc1ddb6be892';
  const tabId = 'sidecar__desktop-context/context__/';
  const sidecarUrl = 'plugin://desktop-context-token/';
  const dispatched = [];
  let routerSearch = {};
  let toggleAuxClicks = 0;

  // 严格复刻 Antigravity v2.33.0 main.js 的 jp()/Fp()：缺失 payload.panelScope 时直接抛 TypeError
  const state = {
    sidePanelV2: {
      conversationPanes: {
        [convId]: {
          tabs: [
            {
              id: tabId,
              content: {
                type: 'sidecarView',
                sidecarView: { sidecarId: 'desktop-context/context', path: '/', url: sidecarUrl, title: 'Context Usage' },
              },
            },
          ],
          activeTabId: 'newTab__empty',
        },
      },
      newConversationPanes: {},
      customViewPanes: {},
      homePane: undefined,
    },
    sidePanel: {
      conversationPanes: {
        [convId]: { tabs: [], activeTabId: 'overview', isPaneOpen: true },
      },
      newConversationPanes: {},
      customViewPanes: {},
      homePane: undefined,
    },
  };

  const getPane = (slice, panelScope) => {
    // 与官方 jp/Fp 完全一致：若 panelScope 为 undefined，访问 panelScope.kind 必抛 TypeError
    if (panelScope.kind === 'cascadeId') return slice.conversationPanes[panelScope.cascadeId];
    if (panelScope.kind === 'newConversation') return slice.newConversationPanes[panelScope.projectId];
    return slice.homePane;
  };

  const store = {
    getState: () => state,
    dispatch: (action) => {
      dispatched.push(action);
      const { type, payload } = action;
      if (type === 'sidePanelV2/setContent') {
        const pane = getPane(state.sidePanelV2, payload.panelScope);
        const existing = pane.tabs.find((t) => t.id === payload.tabId);
        if (existing) existing.content = payload.content;
        else pane.tabs.push({ id: payload.tabId, content: payload.content });
        pane.activeTabId = payload.tabId;
      } else if (type === 'sidePanelV2/setActiveTab') {
        const pane = getPane(state.sidePanelV2, payload.panelScope);
        pane.activeTabId = payload.tabId;
      } else if (type === 'sidePanel/setContent') {
        const pane = getPane(state.sidePanel, payload.panelScope);
        pane.activeTabId = payload.tabId;
      } else if (type === 'sidePanel/setActiveTab') {
        const pane = getPane(state.sidePanel, payload.panelScope);
        pane.activeTabId = payload.tabId;
      } else if (type === 'sidePanel/setSidePanelOpen') {
        const pane = getPane(state.sidePanel, payload.panelScope);
        pane.isPaneOpen = payload.isOpen;
      }
    },
  };

  const toggleAuxBtn = {
    click: () => { toggleAuxClicks += 1; },
  };
  const fakeIframe = {
    src: sidecarUrl,
    getBoundingClientRect: () => ({ width: 420, left: 860 }),
  };

  const doc = {
    head: { appendChild: () => {} },
    body: { appendChild: () => {}, firstElementChild: null },
    getElementById: () => null,
    createElement: () => ({ style: {}, setAttribute: () => {}, addEventListener: () => {}, appendChild: () => {} }),
    querySelector: (sel) => {
      if (sel === '[data-testid="toggle-aux-sidebar"]') return toggleAuxBtn;
      if (sel === 'iframe[src*="desktop-context"]') return fakeIframe;
      return null;
    },
    querySelectorAll: () => [],
    addEventListener: () => {},
  };

  const win = {
    innerWidth: 1280,
    innerHeight: 800,
    location: { pathname: `/c/${convId}`, search: '' },
    __AGY_REDUX_STORE__: store,
    __AGY_FEAT_CTX__: { get: () => null },
    __TSR_ROUTER__: {
      state: { matches: [{ params: { cascadeId: convId } }], location: { pathname: `/c/${convId}`, search: routerSearch } },
      navigate: ({ search }) => {
        routerSearch = typeof search === 'function' ? search(routerSearch) : search;
      },
    },
    addEventListener: () => {},
  };

  vm.runInNewContext(CLIENT_UI_SCRIPT, {
    window: win,
    document: doc,
    console,
    Date,
    Math,
    Number,
    String,
    Array,
    Object,
    Set,
    URLSearchParams,
    Promise,
    encodeURIComponent,
    setInterval: () => 0,
    setTimeout: () => 0,
    clearTimeout: () => {},
  });

  // 场景 1：在 + 新标签页点击「上下文与蜂群监控」-> openContextSidecar()
  win.__AGY_OPEN_CONTEXT_SIDECAR__();
  assert.equal(state.sidePanelV2.conversationPanes[convId].activeTabId, tabId, 'activeTabId 须从 newTab__empty 切回上下文标签');
  assert.equal(state.sidePanelV2.conversationPanes[convId].tabs[0].content.sidecarView.url, sidecarUrl, '原有 plugin:// URL 不得被清空');
  assert.equal(state.sidePanel.conversationPanes[convId].isPaneOpen, true, 'sidePanel 须处于打开态');
  assert.equal(routerSearch.tab, tabId, '路由 search.tab 须同步为上下文标签');
  assert.ok(
    dispatched.every((a) => a.payload.panelScope?.cascadeId === convId && a.payload.treeId?.cascadeId === convId),
    '所有 Redux action 须同时携带 panelScope 与 treeId 双字段兼容'
  );
  assert.equal(
    dispatched.some((a) => a.type.startsWith('auxPane')),
    false,
    'v2.33.0 环境不存在 auxPane 切片时不应派发废弃 auxPane action'
  );

  // 场景 2：点击切换为 swarm 子视图
  win.__AGY_OPEN_CONTEXT_SIDECAR__('swarm');
  assert.equal(
    state.sidePanelV2.conversationPanes[convId].tabs[0].content.sidecarView.queryParams?.view,
    'swarm'
  );

  // 场景 3：关闭侧边栏 -> Redux 成功关闭后不得再同步点击 toggleAuxBtn 造成反向打开
  const beforeCloseCount = dispatched.length;
  // 模拟标签处于激活态以验证 toggle -> close
  doc.querySelector = (sel) => {
    if (sel === `[data-tab-id="${tabId}"]`) {
      return {
        getBoundingClientRect: () => ({ width: 120, left: 900 }),
        getAttribute: (k) => (k === 'aria-selected' ? 'true' : null),
        classList: { contains: () => false },
      };
    }
    if (sel === '[data-testid="toggle-aux-sidebar"]') return toggleAuxBtn;
    if (sel === 'iframe[src*="desktop-context"]') return fakeIframe;
    return null;
  };
  win.__AGY_LAST_SIDECAR_TAB__ = 'single';
  win.__AGY_TOGGLE_CONTEXT_SIDECAR__('single');
  assert.equal(state.sidePanel.conversationPanes[convId].isPaneOpen, false, 'toggle 应经由 sidePanel/setSidePanelOpen 关闭侧边栏');
  assert.equal(toggleAuxClicks, 0, 'Redux 成功关闭后严禁同步点击 toggle-aux-sidebar 防止反向重开');
  assert.ok(dispatched.length > beforeCloseCount);
});

test('CLIENT_UI_SCRIPT sidePanelV2 fallback: Redux 切片异常时自动降级点击已有 DOM 标签页', () => {
  const convId = '4c0bcab4-61b0-4959-a533-dc1ddb6be892';
  const tabId = 'sidecar__desktop-context/context__/';
  let tabClicks = 0;

  const brokenStore = {
    getState: () => ({ sidePanelV2: {}, sidePanel: {} }),
    dispatch: () => {
      throw new TypeError('Simulated future schema break');
    },
  };

  const doc = {
    head: { appendChild: () => {} },
    body: { appendChild: () => {}, firstElementChild: null },
    getElementById: () => null,
    createElement: () => ({ style: {}, setAttribute: () => {}, addEventListener: () => {}, appendChild: () => {} }),
    querySelector: (sel) => {
      if (sel === `[data-tab-id="${tabId}"]`) {
        return {
          getBoundingClientRect: () => ({ width: 110, left: 900 }),
          click: () => { tabClicks += 1; },
        };
      }
      return null;
    },
    querySelectorAll: () => [],
    addEventListener: () => {},
  };

  const win = {
    innerWidth: 1280,
    innerHeight: 800,
    location: { pathname: `/c/${convId}`, search: '' },
    __AGY_REDUX_STORE__: brokenStore,
    __AGY_FEAT_CTX__: { get: () => null },
    __TSR_ROUTER__: { state: { matches: [{ params: { cascadeId: convId } }], location: { pathname: `/c/${convId}`, search: {} } } },
    addEventListener: () => {},
  };

  vm.runInNewContext(CLIENT_UI_SCRIPT, {
    window: win,
    document: doc,
    console,
    Date,
    Math,
    Number,
    String,
    Array,
    Object,
    Set,
    URLSearchParams,
    Promise,
    encodeURIComponent,
    setInterval: () => 0,
    setTimeout: () => 0,
    clearTimeout: () => {},
  });

  win.__AGY_OPEN_CONTEXT_SIDECAR__();
  assert.equal(tabClicks, 1, 'Redux 派发全部失败时必须自动降级点击已有上下文标签页');
});

// ---------------------------------------------------------------------------
// 6. ~/.gemini/context-pro-config.json 统一配置读取与保留更新契约测试
// ---------------------------------------------------------------------------

test('config.mjs: 文件缺失/损坏时 100% 优雅兜底，更新 lang 时无损保留自定义 audit_rules', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-ctx-cfg-'));
  const prevEnv = process.env.AGY_CONTEXT_PRO_CONFIG;
  try {
    const cfgPath = path.join(tmpDir, 'context-pro-config.json');
    process.env.AGY_CONTEXT_PRO_CONFIG = cfgPath;

    // 1. 文件不存在 -> 优雅返回默认结构
    const defCfg = readContextProConfig();
    assert.equal(defCfg.lang, 'auto');
    assert.equal(defCfg.audit_rules.enabled, false);
    assert.deepEqual(defCfg.audit_rules.forbidden_patterns, []);

    // 2. 写入自定义 audit_rules 后调用 updateContextProConfigLang -> 保留 audit_rules 不被覆盖
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({
        lang: 'auto',
        audit_rules: {
          enabled: true,
          forbidden_patterns: ['legacy-preview'],
          warn_worker_patterns: ['opus'],
        },
        extra_user_note: 'keep-me',
      }),
      'utf8'
    );

    const updated = updateContextProConfigLang('zh');
    assert.equal(updated.lang, 'zh');
    assert.equal(updated.audit_rules.enabled, true);
    assert.deepEqual(updated.audit_rules.forbidden_patterns, ['legacy-preview']);
    const rawSaved = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    assert.equal(rawSaved.extra_user_note, 'keep-me');

    // 3. 损坏 JSON -> 零报错回退默认
    fs.writeFileSync(cfgPath, '{invalid-json', 'utf8');
    const broken = readContextProConfig();
    assert.equal(broken.lang, 'auto');
    assert.equal(broken.audit_rules.enabled, false);
  } finally {
    if (prevEnv === undefined) delete process.env.AGY_CONTEXT_PRO_CONFIG;
    else process.env.AGY_CONTEXT_PRO_CONFIG = prevEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 7. macOS 固定证书持久签名（Inside-Out + SUDO_USER 钥匙串）与 adhoc 回退测试
// ---------------------------------------------------------------------------

test('context_bridge_patcher macOS 签名: SUDO_USER 钥匙串探测、固定证书 Inside-Out 顺序与 CSSMERR 回退', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-ctx-mac-sign-'));
  try {
    // 搭建沙箱假 .app 目录结构（绝不触碰真实 /Applications/Antigravity.app）
    const fakeHome = path.join(tmpDir, 'Users', 'alice');
    const loginKc = path.join(fakeHome, 'Library', 'Keychains', 'login.keychain-db');
    fs.mkdirSync(path.dirname(loginKc), { recursive: true });
    fs.writeFileSync(loginKc, 'mock-kc');

    const appBundle = path.join(tmpDir, 'MockAntigravity.app');
    const resDir = path.join(appBundle, 'Contents', 'Resources');
    const fwDir = path.join(appBundle, 'Contents', 'Frameworks');
    const binDir = path.join(resDir, 'bin');
    fs.mkdirSync(path.join(fwDir, 'Electron Framework.framework'), { recursive: true });
    fs.mkdirSync(path.join(fwDir, 'Antigravity Helper.app'), { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(appBundle, 'Contents', 'Info.plist'), '<plist/>');
    fs.writeFileSync(path.join(fwDir, 'libffmpeg.dylib'), 'macho');
    const agyBin = path.join(binDir, 'agy');
    fs.writeFileSync(agyBin, '#!/bin/sh\n');
    fs.chmodSync(agyBin, 0o755);

    // 场景 A: sudo 下找到受信任固定证书 -> 执行 Inside-Out 签名，且绝不传 --preserve-metadata
    const callsA = [];
    const okA = patcher.resignAppOnMac(resDir, {
      platform: 'darwin',
      uid: 0,
      stdio: 'ignore',
      env: { SUDO_USER: 'alice', AGY_CODESIGN_IDENTITY: 'Antigravity Local Signer' },
      execFileSync: (cmd, args) => {
        callsA.push([cmd, ...args]);
        if (cmd === 'dscl') {
          return `NFSHomeDirectory: ${fakeHome}\n`;
        }
        if (cmd === 'security') {
          return '  1) ABCDEF1234567890 "Antigravity Local Signer"\n     1 valid identities found\n';
        }
        return '';
      },
    });
    assert.equal(okA, true);

    const codesignCalls = callsA.filter((c) => c[0] === 'codesign');
    assert.equal(codesignCalls.length, 5, '应依次签 2 个 framework/helper + 1 个 dylib + 1 个 bin + 1 个顶层 app');
    // 1 & 2: .app / .framework 带 --deep
    assert.ok(codesignCalls[0].includes('--deep') && codesignCalls[0].at(-1).endsWith('Antigravity Helper.app'));
    assert.ok(codesignCalls[1].includes('--deep') && codesignCalls[1].at(-1).endsWith('Electron Framework.framework'));
    // 3: .dylib 单签（不带 --deep）
    assert.ok(!codesignCalls[2].includes('--deep') && codesignCalls[2].at(-1).endsWith('libffmpeg.dylib'));
    // 4: Resources/bin/agy 单签
    assert.ok(!codesignCalls[3].includes('--deep') && codesignCalls[3].at(-1).endsWith(path.join('bin', 'agy')));
    // 5: 最后签顶层 .app
    assert.equal(codesignCalls[4].at(-1), appBundle);
    assert.ok(!codesignCalls[4].includes('--deep'));
    for (const call of codesignCalls) {
      assert.ok(call.includes('--keychain') && call.includes(loginKc), 'sudo 下须显式携带用户登录钥匙串');
      assert.ok(call.includes('Antigravity Local Signer'));
      assert.equal(
        call.some((arg) => arg.includes('--preserve-metadata')),
        false,
        '严禁传递 --preserve-metadata=flags,runtime'
      );
    }

    // 场景 B: 证书带 CSSMERR_TP_NOT_TRUSTED -> 必须拒绝并平滑回退 adhoc (--sign -)
    const callsB = [];
    const okB = patcher.resignAppOnMac(resDir, {
      platform: 'darwin',
      uid: 501,
      stdio: 'ignore',
      env: { HOME: fakeHome },
      execFileSync: (cmd, args) => {
        callsB.push([cmd, ...args]);
        if (cmd === 'security') {
          return '  1) ABCDEF "Antigravity Local Signer" (CSSMERR_TP_NOT_TRUSTED)\n';
        }
        return '';
      },
    });
    assert.equal(okB, true);
    const csB = callsB.filter((c) => c[0] === 'codesign');
    assert.deepEqual(csB, [['codesign', '--force', '--sign', '-', appBundle]]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 8. index.html 侧边栏双语词典完整性与无审计纯净展示验证
// ---------------------------------------------------------------------------

test('sidecar index.html: 内联脚本语法合法，I18N 中英键 100% 对齐，audit_enabled=false 隐藏合规徽章', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const html = fs.readFileSync(path.join(here, '..', 'sidecars', 'context', 'index.html'), 'utf8');
  const scriptMatches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scriptMatches.length, 1);
  const inlineCode = scriptMatches[0][1];

  // 1. vm.Script 严格语法校验
  new vm.Script(inlineCode, { filename: 'sidecars/context/index.html' });

  // 2. 提取 I18N 对象校验 zh / en 词条 100% 对称
  const i18nMatch = inlineCode.match(/const I18N = (\{[\s\S]*?\n  \});\n\n  function normalizeLangSetting/);
  assert.ok(i18nMatch, '应包含标准 I18N 映射常量');
  const i18nObj = vm.runInNewContext(`(${i18nMatch[1]})`);
  const zhKeys = Object.keys(i18nObj.zh).sort();
  const enKeys = Object.keys(i18nObj.en).sort();
  assert.deepEqual(zhKeys, enKeys, 'I18N.zh 与 I18N.en 的键集合必须 100% 一致');
  assert.ok(zhKeys.length >= 90);

  // 3. 在沙箱中运行侧边栏渲染：验证语言切换与 audit_enabled=false 隐藏徽章
  const postedToParent = [];
  const configPosts = [];
  let auditEnabledFlag = false;
  let serverConfigLang = 'en';

  const mainEl = {
    innerHTML: '',
  };
  const doc = {
    title: '',
    hidden: false,
    documentElement: { lang: 'en', dataset: {} },
    getElementById: (id) => (id === 'main' ? mainEl : null),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  };

  const mockFetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith('/api/config') && opts?.method === 'POST') {
      const body = JSON.parse(opts.body);
      serverConfigLang = body.lang;
      configPosts.push(body.lang);
      return { json: async () => ({ ok: true, lang: serverConfigLang }) };
    }
    if (u.startsWith('/api/config')) {
      return { json: async () => ({ ok: true, lang: serverConfigLang }) };
    }
    if (u.startsWith('/api/report')) {
      return {
        json: async () => ({
          conversation_id: '11111111-1111-4111-8111-111111111111',
          lang: serverConfigLang,
          model: 'Gemini 4 Neon',
          heading: 'Token usage by category',
          used_tokens: 50000,
          request_budget_tokens: 512000,
          limit_tokens: 1048576,
          used_pct: 9.8,
          grid_segments: [10000, 10000, 15000, 15000, 0],
          categories: [{ key: 'user', name: 'User messages', tokens: 10000, pct: 2.0 }],
          cluster: { has_cluster: true, audit_enabled: auditEnabledFlag, cluster_type: 'swarm', active_count: 2, member_count: 2, working_count: 1 },
        }),
      };
    }
    if (u.startsWith('/api/swarm')) {
      return {
        json: async () => ({
          has_cluster: true,
          cluster_type: 'swarm',
          audit_enabled: auditEnabledFlag,
          config_lang: serverConfigLang,
          title: 'Demo Swarm',
          scan_ms: 4.2,
          summary: {
            member_count: 2,
            active_count: 2,
            working_count: 1,
            waiting_count: 1,
            killed_count: 0,
            total_turns: 8,
            overall_hit_rate: 91.5,
            cache_bust_count: 0,
            cache_bust_tokens: 0,
            violation_count: auditEnabledFlag ? 1 : 0,
            warn_count: 0,
          },
          members: [
            {
              name: '@worker-1',
              kind: 'swarm_worker',
              role: 'worker',
              conversation_id: '22222222-2222-4222-8222-222222222222',
              state: 'working',
              workspace_mode: 'share',
              model: 'gemini-3.8-flash-medium',
              base_model: 'gemini-3.8-flash-medium',
              model_audit: auditEnabledFlag
                ? { status: 'violation', label: 'Forbidden', audit_enabled: true }
                : { status: 'ok', label: 'OK', audit_enabled: false },
              turns: 4,
              current_context: 64000,
              request_budget: 512000,
              hit_rate: 90.0,
              total_output: 1200,
            },
          ],
        }),
      };
    }
    return { json: async () => ({}) };
  };

  const win = {
    scrollY: 0,
    scrollTo: () => {},
    location: { search: '?view=swarm' },
    parent: { postMessage: (msg) => postedToParent.push(msg) },
    sidecar: { fetch: mockFetch },
    addEventListener: () => {},
  };

  vm.runInNewContext(inlineCode, {
    window: win,
    location: win.location,
    document: doc,
    navigator: { language: 'en-US' },
    fetch: mockFetch,
    URLSearchParams,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    RegExp,
    JSON,
    encodeURIComponent,
    setInterval: () => 0,
    setTimeout: () => 0,
  });

  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  // Swarm view in EN with audit_enabled=false:
  assert.match(mainEl.innerHTML, /Session/);
  assert.match(mainEl.innerHTML, /Swarm Radar/);
  assert.match(mainEl.innerHTML, /lang-toggle-btn/);
  assert.match(mainEl.innerHTML, /Cluster Members/);
  assert.doesNotMatch(mainEl.innerHTML, /Models compliant/, 'audit_enabled=false 时不应显示合规状态徽章');
  assert.doesNotMatch(mainEl.innerHTML, />OK</, 'audit_enabled=false 时成员卡片仅显示纯净模型名');
});
