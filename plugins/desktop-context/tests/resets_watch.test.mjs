import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import {
  KNOWN_RESET_TRANSLATIONS,
  RESET_TAG_I18N,
  getResetWatchState,
  localizeResetTag,
  normalizeResetSourcePayload,
  postProcessResetTranslationZh,
  refreshResetWatchAsync,
} from '../sidecars/context/resets_watch.mjs';
import { CLIENT_UI_SCRIPT } from '../sidecars/context/inject-ring.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// 1. Backend resets_watch.mjs tests
// ---------------------------------------------------------------------------

test('resets_watch: 空缓存目录首次只读不发网络请求且返回标准空结构', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-resets-empty-'));
  try {
    const state = getResetWatchState({ targetDir: tmpDir });
    assert.equal(state.ok, true);
    assert.equal(state.migratedFrom, null);
    assert.equal(state.data.lastRefreshedAt, null);
    assert.deepEqual(state.data.sources, {});
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resets_watch: 自动无缝迁移旧版 reset_tracker_v1.json 至 resets-watch-cache.json 并补齐校对译文', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-resets-migrate-'));
  const legacyFile = path.join(tmpDir, 'reset_tracker_v1.json');
  const targetCache = path.join(tmpDir, 'sidecar_data', 'resets-watch-cache.json');
  try {
    const legacyPayload = {
      version: '1.0.0',
      lastRefreshedAt: '2026-11-16T07:51:19.343Z',
      acknowledged: {},
      translations: {
        'obs-1:Codex usage limits have been reset.': '法典使用限制已重置。',
      },
      sources: {
        agy: {
          key: 'agy',
          name: 'AGY (Gemini)',
          siteUrl: 'https://agyresets.com/',
          ok: true,
          latestReset: {
            id: '2121380918355234957',
            announcedAt: '2026-11-13T23:13:18Z',
            models: ['gemini'],
            plans: ['all'],
            trigger: 'product_release',
            text: 'To mark a week of relentless shipping, we’re resetting everyone’s Gemini quota on Antigravity!',
            textZh: null,
            author: '_mohansolo',
            url: 'https://x.com/_mohansolo/status/2121380918355234957',
          },
          stats: { total: 13, daysSinceLast: 2.4 },
          history: [],
        },
        codex: {
          key: 'codex',
          name: 'Codex',
          siteUrl: 'https://codex-resets.com/',
          ok: true,
          latestReset: {
            id: 'obs-1',
            announcedAt: '2026-11-10T00:00:00Z',
            text: 'Codex usage limits have been reset.',
            textZh: null,
          },
          stats: { total: 72, daysSinceLast: 3.5 },
          history: [],
        },
      },
    };
    fs.writeFileSync(legacyFile, JSON.stringify(legacyPayload), 'utf8');

    const migrated = getResetWatchState({ cachePath: targetCache, legacyPath: legacyFile });
    assert.equal(migrated.ok, true);
    assert.equal(migrated.migratedFrom, legacyFile);
    assert.equal(fs.existsSync(targetCache), true, '迁移后必须持久化落盘至目标缓存文件');
    assert.equal(
      migrated.data.sources.agy.latestReset.textZh,
      KNOWN_RESET_TRANSLATIONS['2121380918355234957']
    );
    assert.equal(migrated.data.sources.agy.name, 'Gemini (AGY)');
    assert.equal(migrated.data.sources.codex.latestReset.textZh, 'Codex 用量限额已重置。');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resets_watch: 手工刷新三站并发抓取、增量翻译缓存与单站故障容错降级', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-resets-refresh-'));
  try {
    let fetchCalls = 0;
    const mockFetch = async (url) => {
      fetchCalls++;
      if (url.includes('agyresets.com/api/v1/status')) {
        return {
          data: {
            latest_reset: {
              id: '2121380918355234957',
              announced_at: '2026-11-13T23:13:18Z',
              kind: 'weekly',
              models: ['gemini'],
              plans: ['all'],
              trigger: 'product_release',
              text: 'Resetting everyone Gemini quota on Antigravity!',
              source: { author: '_mohansolo', url: 'https://x.com/_mohansolo/status/2121380918355234957' },
            },
            scheduled_reset: null,
            active_watch: {
              level: 'elevated',
              reason: 'load',
              rule: 'TPU load',
              observed_at: '2026-11-16T06:00:00Z',
              text: 'High traffic observed across clusters.',
              source: { author: '_mohansolo', url: 'https://x.com/_mohansolo/status/99' },
            },
            stats: {
              total: 13,
              last_reset_at: '2026-11-13T23:13:18Z',
              days_since_last: 2.5,
              avg_interval_days: 14.7,
              median_interval_days: 8.9,
              longest_gap_days: 44,
            },
          },
        };
      }
      if (url.includes('agyresets.com/api/v1/resets')) {
        return {
          data: [
            {
              id: '2121380918355234957',
              announced_at: '2026-11-13T23:13:18Z',
              models: ['gemini'],
              plans: ['all'],
              trigger: 'product_release',
              text: 'Resetting everyone Gemini quota on Antigravity!',
              source: { author: '_mohansolo', url: 'https://x.com/_mohansolo/status/2121380918355234957' },
            },
            {
              id: 'new-unseen-post-1',
              announced_at: '2026-11-15T10:00:00Z',
              models: ['argon'],
              plans: ['paid'],
              trigger: 'model_launch',
              text: 'Brand new quota reset announcement for everyone.',
              source: { author: 'antigravity', url: 'https://x.com/antigravity/status/123' },
            },
          ],
        };
      }
      if (url.includes('codex-resets.com/api/v1/status')) {
        return {
          data: {
            latest_reset: {
              id: '2120999993079451919',
              announced_at: '2026-11-12T22:00:00Z',
              kind: 'banked',
              text: 'Activated banked reset for dots.',
              source: { author: 'thsottiaux', url: 'https://x.com/thsottiaux/status/2120999993079451919' },
            },
            stats: { total: 72, days_since_last: 3.6, avg_interval_days: 5.9 },
          },
        };
      }
      if (url.includes('clauderesets.com/api/v1/status')) {
        return {
          data: {
            latest_reset: {
              id: '2026-09-04-max-weekly',
              announced_at: '2026-09-04T18:00:00Z',
              windows: ['weekly', 'five_hour'],
              audience: { plans: ['paid'] },
              summary: 'Weekly usage limits reset for Claude Max.',
              sources: [{ handle: 'lydiahallie', url: 'https://x.com/lydiahallie/status/1' }],
            },
            stats: { total: 12, days_since_last: 72.7 },
          },
        };
      }
      return { data: [] };
    };

    const res = await refreshResetWatchAsync({
      targetDir: tmpDir,
      _fetchJson: mockFetch,
      _translateText: async (en) => `【机翻】反重力与蜂群：${en}`,
      nowMs: Date.parse('2026-11-16T12:00:00Z'),
    });

    assert.equal(res.ok, true);
    assert.ok(fetchCalls >= 5);
    assert.equal(res.data.sources.agy.ok, true);
    assert.equal(res.data.sources.agy.stats.total, 13);
    assert.equal(
      res.data.sources.agy.latestReset.textZh,
      KNOWN_RESET_TRANSLATIONS['2121380918355234957']
    );
    // 验证未知新帖走增量翻译且完成术语后处理（反重力 -> Antigravity，蜂群 -> 多智能体蜂群）
    const unseen = res.data.sources.agy.history[1];
    assert.match(unseen.textZh, /Antigravity与多智能体蜂群/);
    assert.equal(
      res.data.sources.codex.latestReset.textZh,
      KNOWN_RESET_TRANSLATIONS['2120999993079451919']
    );
    assert.equal(
      res.data.sources.claude.latestReset.textZh,
      KNOWN_RESET_TRANSLATIONS['2026-09-04-max-weekly']
    );
    assert.deepEqual(res.data.sources.claude.latestReset.models, ['weekly', 'five_hour']);

    // 模拟单站故障，验证保留旧缓存数据兜底
    const partialFail = await refreshResetWatchAsync({
      targetDir: tmpDir,
      _fetchJson: async (url) => {
        if (url.includes('codex-resets.com')) throw new Error('Codex 站点连接超时');
        return mockFetch(url);
      },
      skipTranslate: true,
    });
    assert.equal(partialFail.ok, true);
    assert.equal(partialFail.data.sources.codex.ok, false);
    assert.match(partialFail.data.sources.codex.error, /Codex 站点连接超时/);
    assert.equal(partialFail.data.sources.codex.stats.total, 72, '单站刷新失败时须保留上次有效统计缓存');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resets_watch: 标签汉化映射与译文术语后处理覆盖全部核心词条', () => {
  assert.equal(Object.keys(KNOWN_RESET_TRANSLATIONS).length, 15);
  assert.equal(Object.keys(RESET_TAG_I18N).length, 17);
  assert.equal(localizeResetTag('product_release', 'zh-CN'), '产品发布');
  assert.equal(localizeResetTag('banked', 'zh-CN'), '储存重置');
  assert.equal(localizeResetTag('five_hour', 'zh-CN'), '5小时窗口');
  assert.equal(localizeResetTag('product_release', 'en'), 'product release');
  assert.equal(
    postProcessResetTranslationZh('反重力上的法典使用限制已持续运送'),
    'Antigravity上的Codex 用量限额已密集发布更新'
  );
  const bad = normalizeResetSourcePayload('agy', null, null, '网络断开');
  assert.equal(bad.ok, false);
  assert.equal(bad.error, '网络断开');
});

// ---------------------------------------------------------------------------
// 2. Frontend CLIENT_UI_SCRIPT syntax, topbar slimming & Reset Watch UI tests
// ---------------------------------------------------------------------------

function createMiniDom() {
  const byId = new Map();
  const docListeners = new Map();
  const winListeners = new Map();

  class MiniElement {
    constructor(tagName) {
      this.tagName = String(tagName || 'DIV').toUpperCase();
      this._id = '';
      this.className = '';
      this.dataset = {};
      this.style = { display: '' };
      this.title = '';
      this.href = '';
      this.target = '';
      this.rel = '';
      this.hidden = false;
      this.attributes = new Map();
      this.children = [];
      this.parentElement = null;
      this.listeners = new Map();
      this._textContent = '';
      this._innerHTML = '';
      const self = this;
      this.classList = {
        add(...cls) {
          const set = new Set(self.className.split(/\s+/).filter(Boolean));
          for (const c of cls) if (c) set.add(c);
          self.className = [...set].join(' ');
        },
        remove(...cls) {
          const set = new Set(self.className.split(/\s+/).filter(Boolean));
          for (const c of cls) set.delete(c);
          self.className = [...set].join(' ');
        },
        contains(c) {
          return self.className.split(/\s+/).filter(Boolean).includes(c);
        },
        toggle(c, force) {
          const has = this.contains(c);
          const next = force === undefined ? !has : Boolean(force);
          if (next) this.add(c);
          else this.remove(c);
          return next;
        },
      };
    }

    get id() {
      return this._id;
    }
    set id(v) {
      if (this._id && byId.get(this._id) === this) byId.delete(this._id);
      this._id = String(v || '');
      if (this._id) byId.set(this._id, this);
    }

    get firstElementChild() {
      return this.children[0] || null;
    }
    get lastElementChild() {
      return this.children[this.children.length - 1] || null;
    }
    get nextElementSibling() {
      if (!this.parentElement) return null;
      const idx = this.parentElement.children.indexOf(this);
      return idx >= 0 ? this.parentElement.children[idx + 1] || null : null;
    }

    get textContent() {
      if (this.children.length === 0) return this._textContent;
      return this._textContent + this.children.map((c) => c.textContent).join('');
    }
    set textContent(v) {
      this.children = [];
      this._textContent = String(v ?? '');
    }

    get innerHTML() {
      return this._innerHTML;
    }
    set innerHTML(html) {
      this._innerHTML = String(html || '');
      this.children = [];
      this._textContent = '';
      parseSimpleHtmlInto(this, this._innerHTML, byId);
    }

    setAttribute(k, v) {
      const sv = String(v);
      this.attributes.set(k, sv);
      if (k === 'id') this.id = sv;
      if (k === 'class') this.className = sv;
      if (k === 'href') this.href = sv;
      if (k.startsWith('data-')) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        this.dataset[camel] = sv;
      }
    }
    getAttribute(k) {
      if (k === 'id') return this._id || null;
      if (k === 'class') return this.className || null;
      if (k === 'href') return this.href || this.attributes.get('href') || null;
      return this.attributes.has(k) ? this.attributes.get(k) : null;
    }
    removeAttribute(k) {
      this.attributes.delete(k);
      if (k.startsWith('data-')) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        delete this.dataset[camel];
      }
    }

    appendChild(child) {
      if (child.parentElement) {
        const arr = child.parentElement.children;
        const i = arr.indexOf(child);
        if (i >= 0) arr.splice(i, 1);
      }
      child.parentElement = this;
      this.children.push(child);
      registerSubtreeIds(child, byId);
      return child;
    }
    insertBefore(child, refNode) {
      if (!refNode) return this.appendChild(child);
      if (child.parentElement) {
        const arr = child.parentElement.children;
        const i = arr.indexOf(child);
        if (i >= 0) arr.splice(i, 1);
      }
      const idx = this.children.indexOf(refNode);
      child.parentElement = this;
      if (idx >= 0) this.children.splice(idx, 0, child);
      else this.children.push(child);
      registerSubtreeIds(child, byId);
      return child;
    }
    replaceChildren(...nodes) {
      this.children = [];
      this._textContent = '';
      for (const n of nodes) this.appendChild(n);
    }
    remove() {
      if (this.parentElement) {
        const idx = this.parentElement.children.indexOf(this);
        if (idx >= 0) this.parentElement.children.splice(idx, 1);
        this.parentElement = null;
      }
      unregisterSubtreeIds(this, byId);
    }
    getBoundingClientRect() {
      return { top: 10, bottom: 32, left: 600, right: 960, width: 120, height: 24 };
    }
    matches(sel) {
      return matchSimpleSelector(this, sel);
    }
    closest(selList) {
      const parts = String(selList).split(',').map((s) => s.trim()).filter(Boolean);
      let cur = this;
      while (cur) {
        if (parts.some((p) => matchSimpleSelector(cur, p))) return cur;
        cur = cur.parentElement;
      }
      return null;
    }
    querySelector(selList) {
      return this.querySelectorAll(selList)[0] || null;
    }
    querySelectorAll(selList) {
      const parts = String(selList).split(',').map((s) => s.trim()).filter(Boolean);
      const out = [];
      const walk = (node) => {
        for (const ch of node.children) {
          if (parts.some((p) => matchSimpleSelector(ch, p))) out.push(ch);
          walk(ch);
        }
      };
      walk(this);
      return out;
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    click() {
      let stopped = false;
      const ev = {
        type: 'click',
        target: this,
        preventDefault() {},
        stopPropagation() {
          stopped = true;
        },
      };
      let cur = this;
      while (cur && !stopped) {
        for (const fn of cur.listeners.get('click') || []) {
          fn(ev);
        }
        cur = cur.parentElement;
      }
      if (!stopped) {
        for (const fn of docListeners.get('click') || []) fn(ev);
      }
    }
  }

  function registerSubtreeIds(node, map) {
    if (node._id) map.set(node._id, node);
    for (const c of node.children) registerSubtreeIds(c, map);
  }
  function unregisterSubtreeIds(node, map) {
    if (node._id && map.get(node._id) === node) map.delete(node._id);
    for (const c of node.children) unregisterSubtreeIds(c, map);
  }

  function matchSimpleSelector(el, sel) {
    if (!sel) return false;
    if (sel.startsWith('#')) return el._id === sel.slice(1);
    if (sel.startsWith('.')) return el.classList.contains(sel.slice(1));
    const attrM = sel.match(/^\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]$/);
    if (attrM) {
      const val = el.getAttribute(attrM[1]);
      if (attrM[2] === undefined) return val !== null;
      return val === attrM[2];
    }
    return el.tagName === sel.toUpperCase();
  }

  function parseSimpleHtmlInto(rootEl, html, map) {
    const tokenRe = /<\/?([a-zA-Z0-9]+)\b([^>]*)>|([^<]+)/g;
    const voidTags = new Set(['br', 'hr', 'img', 'input', 'meta', 'link']);
    const stack = [rootEl];
    let m;
    while ((m = tokenRe.exec(html)) !== null) {
      if (m[3] !== undefined) {
        const txt = m[3];
        if (txt.trim() || stack[stack.length - 1].children.length === 0) {
          stack[stack.length - 1]._textContent += txt;
        }
        continue;
      }
      const full = m[0];
      const tag = m[1].toLowerCase();
      const attrs = m[2] || '';
      if (full.startsWith('</')) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const el = new MiniElement(tag);
      const attrRe = /([a-zA-Z0-9_:-]+)(?:="([^"]*)")?/g;
      let am;
      while ((am = attrRe.exec(attrs)) !== null) {
        const k = am[1];
        if (k === '/') continue;
        el.setAttribute(k, am[2] ?? '');
        if (k === 'style' && am[2]?.includes('display:none')) {
          el.style.display = 'none';
        }
      }
      stack[stack.length - 1].appendChild(el);
      if (!voidTags.has(tag) && !full.endsWith('/>')) {
        stack.push(el);
      }
    }
    registerSubtreeIds(rootEl, map);
  }

  const docElement = new MiniElement('html');
  const head = new MiniElement('head');
  const body = new MiniElement('body');
  const toolbar = new MiniElement('div');
  toolbar.setAttribute('data-testid', 'pane-titlebar-toolbar');
  body.appendChild(toolbar);

  const document = {
    documentElement: docElement,
    head,
    body,
    createElement: (t) => new MiniElement(t),
    getElementById: (id) => byId.get(id) || null,
    querySelector: (sel) => head.querySelector(sel) || body.querySelector(sel),
    querySelectorAll: (sel) => [...head.querySelectorAll(sel), ...body.querySelectorAll(sel)],
    addEventListener: (type, fn) => {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    dispatchKeydown: (key) => {
      const ev = { key, stopPropagation() {}, preventDefault() {} };
      for (const fn of docListeners.get('keydown') || []) fn(ev);
    },
  };

  const window = {
    innerWidth: 1280,
    innerHeight: 820,
    location: { pathname: '/c/1dfbacb2-8b22-422b-a2f8-fbc1f7f35ca4' },
    addEventListener: (type, fn) => {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    dispatchMessage: (data) => {
      for (const fn of winListeners.get('message') || []) fn({ data });
    },
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
  };
  window.window = window;
  window.document = document;

  return { window, document, byId, toolbar };
}

test('inject-ring UI (ZH auto-detected via agExoLang): 顶栏精简微胶囊、无未读橙点、支持原文/译文切换与纯手工刷新桥接', () => {
  // 1. vm.Script 严格语法检查
  const script = new vm.Script(CLIENT_UI_SCRIPT, { filename: 'inject-ring-client.js' });
  const dom = createMiniDom();
  dom.document.documentElement.setAttribute('data-ag-exo-lang', 'zh');
  const ctx = vm.createContext({
    window: dom.window,
    document: dom.document,
    setInterval: dom.window.setInterval,
    clearInterval: dom.window.clearInterval,
    setTimeout: dom.window.setTimeout,
    clearTimeout: dom.window.clearTimeout,
    URL,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
  });

  // 初始无活跃上下文时：顶栏「重置监视」按钮依然常驻可见，而 ctx 与 swarm 胶囊隐藏
  dom.window.location.pathname = '/new';
  script.runInContext(ctx);
  const topBar = dom.document.getElementById('agy-top-telemetry-bar');
  assert.ok(topBar, '主对话顶栏容器必须挂载');
  assert.equal(dom.document.getElementById('agy-tb-ctx').style.display, 'none');
  assert.equal(dom.document.getElementById('agy-tb-swarm').style.display, 'none');
  const resetsBtn = dom.document.getElementById('agy-tb-resets');
  assert.ok(resetsBtn, '重置监视按钮必须常驻存在');
  assert.match(resetsBtn.textContent, /重置监视/);
  assert.equal(topBar.querySelectorAll('.resets-tab-dot, .unread-dot').length, 0, '严禁包含未读橙点');
  assert.equal(dom.document.getElementById('agy-tb-ttl'), null, '旧独立保活汉字胶囊应已合并移除');
  assert.equal(dom.document.getElementById('agy-tb-bust'), null, '旧独立崩塌汉字胶囊应已移除');
  assert.equal(dom.document.getElementById('agy-tb-quota'), null, '旧独立额度汉字胶囊应已移除');

  // 注入活跃上下文与蜂群数据，验证极简微胶囊文本
  const convId = '1dfbacb2-8b22-422b-a2f8-fbc1f7f35ca4';
  dom.window.location.pathname = '/c/' + convId;
  const twoMinAgo = new Date(Date.now() - 125 * 1000).toISOString();
  dom.window.__AGY_RING_DATA__ = {
    conversation_id: convId,
    model: 'Gemini 3.1 Pro',
    used_tokens: 366200,
    request_budget_tokens: 512000,
    limit_tokens: 1048576,
    cache_bust_count: 2,
    cache_bust_tokens: 84000,
    last_turn_at: twoMinAgo,
    telemetry: {
      latest: { cache_hit_pct: 99 },
      summary: { cache_bust_count: 2, cache_bust_tokens: 84000 },
    },
    swarm_meta: {
      has_cluster: true,
      cluster_type: 'subagents',
      active_count: 3,
      member_count: 3,
      violation_count: 1,
      warn_count: 0,
    },
  };
  dom.window.__AGY_RING_RENDER__();

  assert.equal(dom.document.getElementById('agy-tb-ctx-txt').textContent, '366k (72%)');
  assert.equal(dom.document.getElementById('agy-tb-ttl-txt').textContent, '02:05');
  assert.ok(
    !dom.document.getElementById('agy-tb-ttl-txt').textContent.includes('保活'),
    '秒表仅显示纯数字，绝不堆砌保活/濒危汉字'
  );
  assert.match(dom.document.getElementById('agy-tb-ctx').title, /缓存命中 99%/);
  assert.equal(dom.document.getElementById('agy-tb-swarm-txt').textContent, '3/3');
  assert.ok(dom.document.getElementById('agy-tb-swarm').classList.contains('swarm-warn'), '越级告警时胶囊呈琥珀色边框');
  assert.match(dom.document.getElementById('agy-tb-swarm').title, /关联蜂群\/子代理 3\/3 在线/);

  // 验证超过 60 分钟时秒表格式如 1h12m
  dom.window.__AGY_RING_DATA__.last_turn_at = new Date(Date.now() - (72 * 60 + 15) * 1000).toISOString();
  dom.window.__AGY_RING_TTL_TICK__();
  assert.equal(dom.document.getElementById('agy-tb-ttl-txt').textContent, '1h12m');

  // 注入本地重置缓存并点击「重置监视」打开弹窗（绝不自动触发刷新请求）
  dom.window.__AGY_RESETS_UPDATE__({
    ok: true,
    data: {
      lastRefreshedAt: '2026-11-16T07:51:19.343Z',
      sources: {
        agy: {
          key: 'agy',
          name: 'Gemini (AGY)',
          siteUrl: 'https://agyresets.com/',
          ok: true,
          latestReset: {
            id: '2121380918355234957',
            announcedAt: '2026-11-13T23:13:18Z',
            models: ['gemini'],
            plans: ['all'],
            trigger: 'product_release',
            text: 'Resetting everyone Gemini quota on Antigravity!',
            textZh: KNOWN_RESET_TRANSLATIONS['2121380918355234957'],
            author: '_mohansolo',
            url: 'https://x.com/_mohansolo/status/2121380918355234957',
          },
          stats: { total: 13, daysSinceLast: 2.5, avgIntervalDays: 14.7, medianIntervalDays: 8.9, longestGapDays: 44 },
          history: [
            {
              id: '2121380918355234957',
              announcedAt: '2026-11-13T23:13:18Z',
              models: ['gemini'],
              trigger: 'product_release',
              text: 'Resetting everyone Gemini quota on Antigravity!',
              textZh: KNOWN_RESET_TRANSLATIONS['2121380918355234957'],
              author: '_mohansolo',
              url: 'https://x.com/_mohansolo/status/2121380918355234957',
            },
          ],
        },
        codex: {
          key: 'codex',
          name: 'Codex',
          siteUrl: 'https://codex-resets.com/',
          ok: true,
          latestReset: null,
          stats: { total: 72, daysSinceLast: 3.6, avgIntervalDays: 5.9 },
          history: [],
        },
        claude: {
          key: 'claude',
          name: 'Claude',
          siteUrl: 'https://clauderesets.com/',
          ok: true,
          latestReset: null,
          stats: { total: 12, daysSinceLast: 72.7 },
          history: [],
        },
      },
    },
  });

  resetsBtn.click();
  const pop = dom.document.getElementById('agy-resets-popover');
  assert.equal(pop.classList.contains('open'), true, '点击重置监视应展开浮层');
  assert.equal(dom.window.__AGY_RESETS_REFRESH_REQ__ || null, null, '打开浮层严禁自动发起远端刷新');
  assert.equal(dom.document.getElementById('agy-resets-st-total').textContent, '13');
  assert.match(dom.document.getElementById('agy-resets-latest-text').textContent, /为纪念连续一周密集发布更新/);
  assert.match(dom.document.getElementById('agy-resets-latest-tags').textContent, /产品发布/);

  // 点击「原文」按钮切换英文原文与英文标签，且不关闭浮层
  const langBtn = dom.document.getElementById('agy-resets-lang-btn');
  assert.equal(langBtn.textContent, '原文');
  langBtn.click();
  assert.equal(pop.classList.contains('open'), true);
  assert.equal(langBtn.textContent, '译文');
  assert.match(dom.document.getElementById('agy-resets-latest-text').textContent, /Resetting everyone Gemini quota/);
  assert.match(dom.document.getElementById('agy-resets-latest-tags').textContent, /product release/);

  // 再点「译文」切回中文
  langBtn.click();
  assert.equal(langBtn.textContent, '原文');
  assert.match(dom.document.getElementById('agy-resets-latest-text').textContent, /为纪念连续一周密集发布更新/);

  // 切换 Codex 标签页不触发刷新且不关闭浮层
  dom.document.getElementById('agy-resets-tab-codex').click();
  assert.equal(pop.classList.contains('open'), true);
  assert.equal(dom.document.getElementById('agy-resets-st-total').textContent, '72');
  assert.equal(dom.window.__AGY_RESETS_REFRESH_REQ__ || null, null);

  // 点击「刷新」按钮才发出手工刷新请求并进入加载态
  const refreshBtn = dom.document.getElementById('agy-resets-refresh-btn');
  refreshBtn.click();
  assert.equal(dom.window.__AGY_RESETS_REFRESH_REQ__, 'all');
  assert.equal(refreshBtn.textContent, '刷新中…');
  assert.equal(refreshBtn.getAttribute('data-busy'), 'true');

  // Node 侧回推结果后自动解除加载态并提示成功
  dom.window.__AGY_RESETS_REFRESH_REQ__ = null;
  dom.window.__AGY_RESETS_UPDATE__({ ok: true, data: dom.window.__AGY_RESETS_DATA__ });
  assert.equal(refreshBtn.textContent, '刷新');
  assert.equal(refreshBtn.getAttribute('data-busy'), null);

  // 按 Escape 自动关闭浮层
  dom.document.dispatchKeydown('Escape');
  assert.equal(pop.classList.contains('open'), false);
});

test('inject-ring UI (EN fallback & live hot-switch): 默认无汉化回退英文，支持 postMessage 动态切换中英文', () => {
  const script = new vm.Script(CLIENT_UI_SCRIPT, { filename: 'inject-ring-client.js' });
  const dom = createMiniDom();
  // Mount an input box footer so the input ring and telemetry popover also render
  const composerFooter = dom.document.createElement('div');
  composerFooter.setAttribute('class', 'agy-composer-footer');
  const rightGroup = dom.document.createElement('div');
  rightGroup.setAttribute('class', 'shrink-0');
  const sendBtn = dom.document.createElement('button');
  sendBtn.setAttribute('data-testid', 'send-button');
  rightGroup.appendChild(sendBtn);
  composerFooter.appendChild(rightGroup);
  dom.document.body.appendChild(composerFooter);

  const ctx = vm.createContext({
    window: dom.window,
    document: dom.document,
    navigator: { language: 'en-US' },
    setInterval: dom.window.setInterval,
    clearInterval: dom.window.clearInterval,
    setTimeout: dom.window.setTimeout,
    clearTimeout: dom.window.clearTimeout,
    URL,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
  });

  const convId = '1dfbacb2-8b22-422b-a2f8-fbc1f7f35ca4';
  dom.window.location.pathname = '/c/' + convId;
  script.runInContext(ctx);

  // Default auto-detect without agExoLang on en-US -> English UI
  const resetsBtn = dom.document.getElementById('agy-tb-resets');
  assert.match(resetsBtn.textContent, /Reset Watch/);

  // Inject active context with >5m cold TTL
  const sixMinAgo = new Date(Date.now() - 370 * 1000).toISOString();
  dom.window.__AGY_RING_DATA__ = {
    conversation_id: convId,
    lang: 'auto',
    model: 'Gemini 4 Hydrogen',
    used_tokens: 120000,
    request_budget_tokens: 512000,
    limit_tokens: 1048576,
    cache_bust_count: 1,
    cache_bust_tokens: 45000,
    last_turn_at: sixMinAgo,
    telemetry: {
      total_calls: 6,
      latest: { cache_hit_pct: 88, cache_read_tokens: 95000, output_tps: 92, ttft_ms: 820, prefill_tps: 110000, output_tokens: 420 },
      summary: { cache_bust_count: 1, cache_bust_tokens: 45000, avg_output_tps: 85, avg_ttft_ms: 900, peak_prefill_tps: 130000, sum_output_tokens: 2400 },
    },
    swarm_meta: {
      has_cluster: true,
      audit_enabled: false,
      active_count: 2,
      member_count: 4,
      total_turns: 12,
      cache_bust_count: 0,
      violation_count: 0,
      warn_count: 0,
    },
  };
  dom.window.__AGY_RING_RENDER__();

  assert.match(dom.document.getElementById('agy-tb-ctx').title, /Cache hit 88%/);
  assert.match(dom.document.getElementById('agy-tb-swarm').title, /Swarm \/ Subagents 2\/4 active/);
  assert.equal(dom.document.getElementById('agy-ring-ttl-txt').textContent, 'Cold');
  assert.equal(dom.document.getElementById('agy-pop-ttl-val').textContent, 'Cold >5m (re-prefill)');
  const ringPop = dom.document.getElementById('agy-input-context-popover');
  assert.match(ringPop.innerHTML, /Open Context & Turn Inspector/);
  assert.match(ringPop.innerHTML, /Swarm Radar · 2\/4 active/);

  // Open Resets Watch in EN mode -> hides translation toggle & renders English labels
  resetsBtn.click();
  const resetsPop = dom.document.getElementById('agy-resets-popover');
  assert.equal(dom.document.getElementById('agy-resets-hdr-title').textContent, 'Official Quota Reset Watch');
  assert.equal(dom.document.getElementById('agy-resets-refresh-btn').textContent, 'Refresh');
  assert.equal(dom.document.getElementById('agy-resets-lang-btn').style.display, 'none');

  // Hot-switch to Chinese via postMessage from side panel!
  dom.window.dispatchMessage({ type: 'agy-context-lang-changed', lang: 'zh' });
  assert.match(resetsBtn.textContent, /重置监视/);
  assert.equal(dom.document.getElementById('agy-ring-ttl-txt').textContent, '已冷');
  assert.equal(dom.document.getElementById('agy-pop-ttl-val').textContent, '已冷 >5m (必重灌)');
  assert.match(ringPop.innerHTML, /打开上下文与单轮审查面板/);
  assert.equal(dom.document.getElementById('agy-resets-hdr-title').textContent, '官方重置监视与通知');
  assert.equal(dom.document.getElementById('agy-resets-refresh-btn').textContent, '刷新');
  assert.equal(resetsPop.classList.contains('open'), true);
});
