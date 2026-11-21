// Unified configuration loader & persistence for ~/.gemini/context-pro-config.json
// Supports AGY_CONTEXT_PRO_CONFIG override for hermetic unit testing and 100% graceful fallback.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_AUDIT_RULES = {
  enabled: false,
  forbidden_patterns: [],
  forbidden_label: { zh: '违禁模型', en: 'Forbidden' },
  warn_worker_patterns: [],
  safe_worker_patterns: [],
  exempt_role_keywords: [],
  warn_label: { zh: '越级模型', en: 'Over-tier' },
  ok_label: { zh: '合规', en: 'Compliant' },
};

export function normalizeLangSetting(rawLang) {
  const val = String(rawLang || 'auto').trim().toLowerCase();
  if (val.startsWith('zh')) return 'zh';
  if (val.startsWith('en')) return 'en';
  return 'auto';
}

export function resolveConfigPath(options = {}) {
  if (options && typeof options.configPath === 'string' && options.configPath.trim()) {
    return options.configPath.trim();
  }
  const envOverride = (process.env.AGY_CONTEXT_PRO_CONFIG || '').trim();
  if (envOverride) {
    return envOverride;
  }
  const geminiDir =
    (options && typeof options.geminiDir === 'string' && options.geminiDir.trim()) ||
    process.env.ANTIGRAVITY_GEMINI_DIR ||
    path.join(os.homedir(), '.gemini');
  return path.join(geminiDir, 'context-pro-config.json');
}

function cleanStringList(rawVal) {
  if (!Array.isArray(rawVal)) return [];
  const out = [];
  for (const item of rawVal) {
    if (typeof item === 'string' || typeof item === 'number') {
      const s = String(item).trim();
      if (s) out.push(s);
    }
  }
  return out;
}

function cloneDefaultAuditRules() {
  return {
    enabled: false,
    forbidden_patterns: [],
    forbidden_label: { ...DEFAULT_AUDIT_RULES.forbidden_label },
    warn_worker_patterns: [],
    safe_worker_patterns: [],
    exempt_role_keywords: [],
    warn_label: { ...DEFAULT_AUDIT_RULES.warn_label },
    ok_label: { ...DEFAULT_AUDIT_RULES.ok_label },
  };
}

function readRawConfigObject(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

export function readContextProConfig(options = {}) {
  const configPath = resolveConfigPath(options);
  const raw = readRawConfigObject(configPath) || {};
  const ar = raw.audit_rules && typeof raw.audit_rules === 'object' && !Array.isArray(raw.audit_rules)
    ? raw.audit_rules
    : {};

  return {
    lang: normalizeLangSetting(raw.lang),
    audit_rules: {
      enabled: ar.enabled === true,
      forbidden_patterns: cleanStringList(ar.forbidden_patterns),
      forbidden_label: ar.forbidden_label ?? { ...DEFAULT_AUDIT_RULES.forbidden_label },
      warn_worker_patterns: cleanStringList(ar.warn_worker_patterns),
      safe_worker_patterns: cleanStringList(ar.safe_worker_patterns),
      exempt_role_keywords: cleanStringList(ar.exempt_role_keywords),
      warn_label: ar.warn_label ?? { ...DEFAULT_AUDIT_RULES.warn_label },
      ok_label: ar.ok_label ?? { ...DEFAULT_AUDIT_RULES.ok_label },
    },
  };
}

export function updateContextProConfigLang(nextLang, options = {}) {
  const configPath = resolveConfigPath(options);
  const validLang = normalizeLangSetting(nextLang);
  const existing = readRawConfigObject(configPath);
  const nextRaw = existing
    ? { ...existing, lang: validLang }
    : { lang: validLang, audit_rules: cloneDefaultAuditRules() };

  if (!nextRaw.audit_rules || typeof nextRaw.audit_rules !== 'object' || Array.isArray(nextRaw.audit_rules)) {
    nextRaw.audit_rules = cloneDefaultAuditRules();
  }

  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${configPath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(nextRaw, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, configPath);

  return readContextProConfig(options);
}
