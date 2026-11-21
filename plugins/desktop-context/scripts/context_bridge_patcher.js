#!/usr/bin/env node
"use strict";
/**
 * antigravity-context-pro Standalone Zero-CDP Electron ASAR Overlay Bridge (macOS / Windows / Linux)
 *
 * 将极薄的零 CDP 原生 IPC 桥接层叠加注入 Antigravity Desktop 的 app.asar：
 * - 彻底摆脱对 DevToolsActivePort / --remote-debugging-port 的依赖（完美适配 Antigravity v2.33.0+ 默认关闭 CDP 的安全策略）；
 * - 零业务代码固化在 app.asar 中：所有 UI 与遥测计算仍由 desktop-context Sidecar（main.mjs / inject-ring.mjs）作为唯一真相源提供；
 * - 支持原版英文 Antigravity Desktop，亦支持叠加在 antigravity-desktop-cn + agy-meme 之上；
 * - 卸载 (--uninstall) 仅剥离 context-bridge 标记区块，绝不破坏已安装的中文汉化与猫娘表情包。
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const child_process = require("child_process");
const vm = require("vm");

if (process.platform === "win32") {
    const defaultNodePaths = [
        "C:\\Program Files\\nodejs",
        "C:\\Program Files (x86)\\nodejs",
        path.join(process.env.LOCALAPPDATA || "", "Programs", "node"),
        path.join(process.env.APPDATA || "", "npm")
    ];
    for (const nodePath of defaultNodePaths) {
        if (fs.existsSync(nodePath) && !String(process.env.PATH || "").includes(nodePath)) {
            process.env.PATH = nodePath + ";" + (process.env.PATH || "");
        }
    }
}

const IPC_BRIDGE_SIGNATURE_START = "'__ANTIGRAVITY_IPC_CONTEXT_BRIDGE_START__';";
const IPC_BRIDGE_SIGNATURE_END = "'__ANTIGRAVITY_IPC_CONTEXT_BRIDGE_END__';";
const PRELOAD_BRIDGE_SIGNATURE_START = "'__ANTIGRAVITY_PRELOAD_CONTEXT_BRIDGE_START__';";
const PRELOAD_BRIDGE_SIGNATURE_END = "'__ANTIGRAVITY_PRELOAD_CONTEXT_BRIDGE_END__';";
const BRIDGE_MARKER = "ag-context-bridge-v1";

function __agRegisterContextBridgeIpcHandlers(electron_1) {
    const fsSync = require("fs");
    const pathMod = require("path");
    const osMod = require("os");
    const httpMod = require("http");

    const GEMINI_DIR = process.env.ANTIGRAVITY_GEMINI_DIR || pathMod.join(osMod.homedir(), ".gemini");
    const RUNTIME_FILE = pathMod.join(GEMINI_DIR, "context-pro-bridge.json");
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ALLOWED_PROVIDERS = new Set(["all", "agy", "codex", "claude"]);
    const MAX_UI_SCRIPT_BYTES = 512 * 1024;

    function assertMainFrame(event) {
        if (event && event.senderFrame && event.senderFrame.parent) {
            throw new Error("Unauthorized subframe Context Bridge IPC call");
        }
    }

    function isPidAlive(pid) {
        if (!Number.isInteger(pid) || pid <= 0) return false;
        try {
            process.kill(pid, 0);
            return true;
        } catch (err) {
            return Boolean(err && err.code === "EPERM");
        }
    }

    function readLiveRuntime() {
        try {
            if (!fsSync.existsSync(RUNTIME_FILE)) return null;
            const parsed = JSON.parse(fsSync.readFileSync(RUNTIME_FILE, "utf8"));
            if (!parsed || typeof parsed !== "object") return null;
            const host = String(parsed.host || "");
            const port = Number(parsed.port);
            const pid = Number(parsed.pid);
            if (host !== "127.0.0.1") return null;
            if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
            if (!isPidAlive(pid)) return null;
            return {
                host,
                port,
                pid,
                token: typeof parsed.token === "string" ? parsed.token : ""
            };
        } catch (_) {
            return null;
        }
    }

    function sidecarJsonRequest(runtime, method, reqPath, bodyObj, timeoutMs) {
        return new Promise((resolve, reject) => {
            const payload = bodyObj !== undefined ? JSON.stringify(bodyObj) : "";
            const headers = { Accept: "application/json" };
            if (runtime.token) headers["x-sidecar-token"] = runtime.token;
            if (payload) {
                headers["Content-Type"] = "application/json";
                headers["Content-Length"] = Buffer.byteLength(payload);
            }
            const req = httpMod.request({
                hostname: runtime.host,
                port: runtime.port,
                path: reqPath,
                method,
                headers,
                timeout: timeoutMs || 3500
            }, (res) => {
                const chunks = [];
                let total = 0;
                res.on("data", (chunk) => {
                    total += chunk.length;
                    if (total <= MAX_UI_SCRIPT_BYTES + 65536) chunks.push(chunk);
                });
                res.on("end", () => {
                    const text = Buffer.concat(chunks).toString("utf8");
                    if (res.statusCode < 200 || res.statusCode >= 300) {
                        reject(new Error("HTTP " + res.statusCode));
                        return;
                    }
                    try {
                        resolve(JSON.parse(text));
                    } catch (err) {
                        reject(err);
                    }
                });
            });
            req.on("timeout", () => req.destroy(new Error("sidecar-timeout")));
            req.on("error", reject);
            if (payload) req.write(payload);
            req.end();
        });
    }

    try { electron_1.ipcMain.removeHandler("ag-ux:context-ui-script"); } catch (_) {}
    electron_1.ipcMain.handle("ag-ux:context-ui-script", async (event) => {
        assertMainFrame(event);
        const runtime = readLiveRuntime();
        if (!runtime) {
            return { ok: false, retryable: true, reason: "sidecar-offline" };
        }
        try {
            const res = await sidecarJsonRequest(runtime, "GET", "/api/bridge/ui-script", undefined, 3000);
            const script = res && typeof res.script === "string" ? res.script : "";
            if (!res || !res.ok || !script || Buffer.byteLength(script, "utf8") > MAX_UI_SCRIPT_BYTES) {
                return { ok: false, retryable: true, reason: "invalid-ui-script" };
            }
            const out = { ok: true, version: String(res.version || "1"), script };
            if (typeof res.lang === "string" && res.lang) out.lang = res.lang;
            return out;
        } catch (err) {
            return { ok: false, retryable: true, reason: (err && err.message) || "sidecar-unreachable" };
        }
    });

    try { electron_1.ipcMain.removeHandler("ag-ux:context-snapshot"); } catch (_) {}
    electron_1.ipcMain.handle("ag-ux:context-snapshot", async (event, payload) => {
        assertMainFrame(event);
        const runtime = readLiveRuntime();
        if (!runtime) {
            return { ok: false, reason: "sidecar-offline" };
        }
        const rawConvId = payload && typeof payload.conversationId === "string" ? payload.conversationId.trim() : "";
        const convId = UUID_RE.test(rawConvId) ? rawConvId : "";
        const qs = "?trackActive=1&conversationId=" + encodeURIComponent(convId);
        try {
            return await sidecarJsonRequest(runtime, "GET", "/api/bridge/snapshot" + qs, undefined, 8000);
        } catch (err) {
            return { ok: false, error: (err && err.message) || "snapshot-failed" };
        }
    });

    try { electron_1.ipcMain.removeHandler("ag-ux:context-resets-refresh"); } catch (_) {}
    electron_1.ipcMain.handle("ag-ux:context-resets-refresh", async (event, payload) => {
        assertMainFrame(event);
        const runtime = readLiveRuntime();
        if (!runtime) {
            return { ok: false, error: "Context Sidecar offline, please retry shortly" };
        }
        const rawProvider = payload && typeof payload.provider === "string" ? payload.provider.trim().toLowerCase() : "all";
        const provider = ALLOWED_PROVIDERS.has(rawProvider) ? rawProvider : "all";
        try {
            return await sidecarJsonRequest(runtime, "POST", "/api/resets/refresh", { provider }, 14000);
        } catch (err) {
            return { ok: false, error: (err && err.message) || "refresh-failed" };
        }
    });
}

function __agSetupContextBridgePreload(elec) {
    const MARKER = "ag-context-bridge-v1";
    if (!elec || !elec.ipcRenderer || !elec.contextBridge || !elec.webFrame) return;
    if (globalThis.__agContextBridgePreloadLoaded) return;

    function isAllowedContextHost() {
        try {
            const loc = globalThis.location;
            if (!loc) return false;
            const proto = typeof loc.protocol === "string" ? loc.protocol.toLowerCase() : "";
            const host = typeof loc.hostname === "string" ? loc.hostname.toLowerCase() : "";
            if (proto !== "http:" && proto !== "https:") return false;
            if (host !== "127.0.0.1" && host !== "localhost" && host !== "[::1]") return false;
            return Boolean(globalThis.top && globalThis.self && globalThis.top === globalThis.self);
        } catch (_) {
            return false;
        }
    }

    if (!isAllowedContextHost()) return;
    globalThis.__agContextBridgePreloadLoaded = MARKER;

    const invokeFn = elec.ipcRenderer.invoke.bind(elec.ipcRenderer);
    try {
        elec.contextBridge.exposeInMainWorld("__agContextBridge", {
            version: 1,
            marker: MARKER,
            getSnapshot: (conversationId) => invokeFn("ag-ux:context-snapshot", {
                conversationId: typeof conversationId === "string" ? conversationId : ""
            }),
            refreshResets: (provider) => invokeFn("ag-ux:context-resets-refresh", {
                provider: typeof provider === "string" ? provider : "all"
            })
        });
    } catch (err) {
        try { console.error("[AG-Context Bridge] exposeInMainWorld failed:", err); } catch (_) {}
        return;
    }

    const BACKOFF_MS = [300, 600, 1000, 1500, 2000, 2500, 3000];
    const MAX_ATTEMPTS = 45;
    let attempt = 0;
    let injected = false;

    async function bootstrapUiScript() {
        if (injected) return;
        attempt += 1;
        try {
            const res = await invokeFn("ag-ux:context-ui-script");
            if (res && res.ok && typeof res.script === "string" && res.script.length > 0) {
                injected = true;
                await elec.webFrame.executeJavaScript(res.script, false);
                return;
            }
        } catch (_) {}
        if (!injected && attempt < MAX_ATTEMPTS) {
            const delay = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)];
            setTimeout(() => { void bootstrapUiScript(); }, delay);
        }
    }

    if (typeof document !== "undefined" && document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => { void bootstrapUiScript(); }, { once: true });
    } else {
        setTimeout(() => { void bootstrapUiScript(); }, 150);
    }
}

class AsarArchive {
    static readHeader(asarPath) {
        const fd = fs.openSync(asarPath, "r");
        try {
            const sizeBuf = Buffer.alloc(8);
            fs.readSync(fd, sizeBuf, 0, 8, 0);
            const headerSize = sizeBuf.readUInt32LE(4);
            const headerBuf = Buffer.alloc(headerSize);
            fs.readSync(fd, headerBuf, 0, headerSize, 8);
            const jsonLen = headerBuf.readUInt32LE(4);
            const jsonStr = headerBuf.slice(8, 8 + jsonLen).toString("utf8");
            const header = JSON.parse(jsonStr);
            const baseOffset = 8 + headerSize;
            return { header, baseOffset };
        } finally {
            fs.closeSync(fd);
        }
    }

    static createHeaderBuffer(headerJson) {
        const jsonBuf = Buffer.from(headerJson, "utf8");
        const jsonLen = jsonBuf.length;
        const alignedJsonLen = Math.ceil(jsonLen / 4) * 4;
        const headerPayloadSize = 4 + alignedJsonLen;
        const headerBuf = Buffer.alloc(4 + headerPayloadSize);
        headerBuf.writeUInt32LE(headerPayloadSize, 0);
        headerBuf.writeUInt32LE(jsonLen, 4);
        jsonBuf.copy(headerBuf, 8);
        const sizeBuf = Buffer.alloc(8);
        sizeBuf.writeUInt32LE(4, 0);
        sizeBuf.writeUInt32LE(headerBuf.length, 4);
        return Buffer.concat([sizeBuf, headerBuf]);
    }

    static readFile(sourceAsar, targetFile) {
        const { header, baseOffset } = this.readHeader(sourceAsar);
        const parts = targetFile.split("/");
        let cur = header.files;
        for (const p of parts) {
            if (!cur || !cur[p]) return null;
            cur = cur[p].files ? cur[p].files : cur[p];
        }
        if (!cur || typeof cur.offset === "undefined") return null;
        const fd = fs.openSync(sourceAsar, "r");
        try {
            const buf = Buffer.alloc(cur.size);
            fs.readSync(fd, buf, 0, cur.size, baseOffset + parseInt(cur.offset, 10));
            return buf;
        } finally {
            fs.closeSync(fd);
        }
    }

    static patchFiles(sourceAsar, destAsar, filePatches) {
        const { header, baseOffset } = this.readHeader(sourceAsar);
        const srcFd = fs.openSync(sourceAsar, "r");
        const chunks = [];
        let currentOffset = 0;

        try {
            const walk = (node, currentPath) => {
                for (const key of Object.keys(node)) {
                    const entry = node[key];
                    const fullPath = currentPath ? currentPath + "/" + key : key;
                    if (entry.files) {
                        walk(entry.files, fullPath);
                    } else if (!entry.unpacked) {
                        if (Object.prototype.hasOwnProperty.call(filePatches, fullPath)) {
                            const newBuf = Buffer.from(filePatches[fullPath], "utf8");
                            entry.offset = String(currentOffset);
                            entry.size = newBuf.length;
                            delete entry.integrity;
                            chunks.push(newBuf);
                            currentOffset += newBuf.length;
                        } else {
                            const buf = Buffer.alloc(entry.size);
                            fs.readSync(srcFd, buf, 0, entry.size, baseOffset + parseInt(entry.offset, 10));
                            entry.offset = String(currentOffset);
                            chunks.push(buf);
                            currentOffset += entry.size;
                        }
                    }
                }
            };
            walk(header.files, "");
            const newHeaderBuf = this.createHeaderBuffer(JSON.stringify(header));
            const outFd = fs.openSync(destAsar, "w");
            try {
                fs.writeSync(outFd, newHeaderBuf, 0, newHeaderBuf.length);
                for (const chunk of chunks) {
                    if (chunk.length > 0) fs.writeSync(outFd, chunk, 0, chunk.length);
                }
            } finally {
                fs.closeSync(outFd);
            }
        } finally {
            fs.closeSync(srcFd);
        }
    }
}

function removeMarkedBlocks(content, startMarker, endMarker) {
    let result = String(content || "");
    while (true) {
        const startIdx = result.indexOf(startMarker);
        if (startIdx === -1) break;
        const endIdx = result.indexOf(endMarker, startIdx);
        if (endIdx === -1) break;
        result = result.substring(0, startIdx).trimEnd() + "\n" + result.substring(endIdx + endMarker.length).trimStart();
    }
    return result;
}

function resolveResourcesDir(installDir) {
    if (!installDir) return "";
    const cleaned = path.resolve(installDir);
    if (fs.existsSync(path.join(cleaned, "app.asar")) || fs.existsSync(path.join(cleaned, "app.asar.bak"))) {
        return cleaned;
    }
    const macRes = path.join(cleaned, "Contents", "Resources");
    if (fs.existsSync(path.join(macRes, "app.asar")) || fs.existsSync(path.join(macRes, "app.asar.bak"))) {
        return macRes;
    }
    const winRes = path.join(cleaned, "resources");
    if (fs.existsSync(path.join(winRes, "app.asar")) || fs.existsSync(path.join(winRes, "app.asar.bak"))) {
        return winRes;
    }
    return cleaned;
}

function findMacAppBundle(resourcesDir) {
    if (process.platform !== "darwin" || !resourcesDir) return null;
    const candidate = path.resolve(resourcesDir, "..", "..");
    if (candidate.endsWith(".app") && fs.existsSync(path.join(candidate, "Contents", "Info.plist"))) {
        return candidate;
    }
    return null;
}

function detectInstallationDir(manualDir) {
    if (manualDir) return manualDir;
    const candidates = process.platform === "darwin"
        ? ["/Applications/Antigravity.app", path.join(os.homedir(), "Applications", "Antigravity.app")]
        : process.platform === "win32"
            ? [
                path.join(process.env.LOCALAPPDATA || "", "Programs", "Antigravity"),
                path.join(process.env.ProgramFiles || "C:\\Program Files", "Antigravity")
            ]
            : ["/opt/Antigravity", "/usr/share/antigravity", "/usr/lib/antigravity"];
    for (const cand of candidates) {
        if (cand && fs.existsSync(cand)) return cand;
    }
    return "";
}

function isInsideAntigravityProcessTree() {
    if (process.platform === "win32") return false;
    try {
        let cur = process.ppid;
        for (let depth = 0; depth < 24 && cur > 1; depth++) {
            const line = child_process.execFileSync("ps", ["-p", String(cur), "-o", "ppid=,command="], { encoding: "utf8" }).trim();
            if (!line) break;
            const m = line.match(/^(\d+)\s+([\s\S]+)$/);
            if (!m) break;
            const nextPpid = Number.parseInt(m[1], 10);
            const cmd = m[2];
            if (cmd.includes("Antigravity.app") || cmd.includes("language_server --standalone --override_ide_name antigravity")) {
                return true;
            }
            if (!Number.isFinite(nextPpid) || nextPpid === cur) break;
            cur = nextPpid;
        }
    } catch (_) {}
    return false;
}

function atomicWritePatchedAsar(sourceAsar, targetAsar, filePatches) {
    const tmpAsar = targetAsar + ".context-bridge-tmp." + process.pid;
    try {
        AsarArchive.patchFiles(sourceAsar, tmpAsar, filePatches);
        fs.renameSync(tmpAsar, targetAsar);
        return true;
    } catch (err) {
        try { if (fs.existsSync(tmpAsar)) fs.unlinkSync(tmpAsar); } catch (_) {}
        console.error("[错误] 写入 app.asar 失败: " + err.message);
        return false;
    }
}

function resolveTargetUserHome(deps = {}) {
    const env = deps.env || process.env;
    const execSyncFn = deps.execFileSync || child_process.execFileSync;
    const uid = typeof deps.uid === "number" ? deps.uid : (typeof process.getuid === "function" ? process.getuid() : -1);
    const sudoUser = String(env.SUDO_USER || "").trim();
    if (uid === 0 && sudoUser && sudoUser !== "root") {
        try {
            const out = execSyncFn("dscl", [".", "-read", "/Users/" + sudoUser, "NFSHomeDirectory"], { encoding: "utf8" });
            const m = String(out || "").match(/NFSHomeDirectory:\s*(\S+)/);
            if (m && m[1]) return m[1].trim();
        } catch (_) {}
        return path.join("/Users", sudoUser);
    }
    return env.HOME || os.homedir();
}

function resolveMacLoginKeychainPath(deps = {}) {
    const fsMod = deps.fs || fs;
    const userHome = resolveTargetUserHome(deps);
    if (!userHome) return null;
    const candidates = [
        path.join(userHome, "Library", "Keychains", "login.keychain-db"),
        path.join(userHome, "Library", "Keychains", "login.keychain")
    ];
    for (const cand of candidates) {
        try {
            if (fsMod.existsSync(cand)) return cand;
        } catch (_) {}
    }
    return null;
}

function isTrustedIdentityInSecurityOutput(output, signIdentity) {
    if (!output || !signIdentity) return false;
    const needle = '"' + signIdentity + '"';
    const lines = String(output).split(/\r?\n/);
    for (const line of lines) {
        if (line.includes(needle) && !line.includes("CSSMERR_")) {
            return true;
        }
    }
    return false;
}

function detectMacCodesignIdentity(deps = {}) {
    const env = deps.env || process.env;
    const execSyncFn = deps.execFileSync || child_process.execFileSync;
    const signIdentity = String(env.AGY_CODESIGN_IDENTITY || "Antigravity Local Signer").trim() || "Antigravity Local Signer";
    const loginKeychain = resolveMacLoginKeychainPath(deps);

    if (loginKeychain) {
        try {
            const kcOut = execSyncFn("security", ["find-identity", "-v", "-p", "codesigning", loginKeychain], { encoding: "utf8" });
            if (isTrustedIdentityInSecurityOutput(kcOut, signIdentity)) {
                return { identity: signIdentity, keychain: loginKeychain };
            }
        } catch (_) {}
    }

    try {
        const defOut = execSyncFn("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
        if (isTrustedIdentityInSecurityOutput(defOut, signIdentity)) {
            return { identity: signIdentity, keychain: null };
        }
    } catch (_) {}

    return { identity: "-", keychain: null };
}

function collectExecutableFiles(dirPath, fsMod) {
    const results = [];
    if (!dirPath || !fsMod.existsSync(dirPath)) return results;
    const walk = (curDir) => {
        let names = [];
        try {
            names = fsMod.readdirSync(curDir).slice().sort();
        } catch (_) {
            return;
        }
        for (const name of names) {
            const full = path.join(curDir, name);
            let st = null;
            try {
                st = fsMod.lstatSync(full);
            } catch (_) {
                continue;
            }
            if (!st || st.isSymbolicLink()) continue;
            if (st.isDirectory()) {
                walk(full);
            } else if (st.isFile() && (st.mode & 0o111) !== 0) {
                results.push(full);
            }
        }
    };
    walk(dirPath);
    return results;
}

function resignAppOnMac(resourcesDir, deps = {}) {
    const fsMod = deps.fs || fs;
    const execSyncFn = deps.execFileSync || child_process.execFileSync;
    const stdioMode = deps.stdio || "inherit";
    const platform = deps.platform || process.platform;

    let appBundle = null;
    if (platform === "darwin" && resourcesDir) {
        const candidate = path.resolve(resourcesDir, "..", "..");
        if (candidate.endsWith(".app") && fsMod.existsSync(path.join(candidate, "Contents", "Info.plist"))) {
            appBundle = candidate;
        }
    }
    if (!appBundle) return true;

    try {
        execSyncFn("xattr", ["-dr", "com.apple.quarantine", appBundle], { stdio: "ignore" });
    } catch (_) {}

    const resolved = detectMacCodesignIdentity(deps);
    if (resolved.identity === "-") {
        try {
            execSyncFn("codesign", ["--force", "--sign", "-", appBundle], { stdio: stdioMode });
            return true;
        } catch (err) {
            console.error("[错误] macOS adhoc 签名失败: " + err.message);
            return false;
        }
    }

    const kcArgs = resolved.keychain ? ["--keychain", resolved.keychain] : [];
    try {
        const frameworksDir = path.join(appBundle, "Contents", "Frameworks");
        if (fsMod.existsSync(frameworksDir)) {
            const entries = fsMod.readdirSync(frameworksDir).slice().sort();
            const deepTargets = [];
            const dylibTargets = [];
            for (const name of entries) {
                const full = path.join(frameworksDir, name);
                let st = null;
                try { st = fsMod.lstatSync(full); } catch (_) { continue; }
                if (!st || st.isSymbolicLink()) continue;
                if (st.isDirectory() && (name.endsWith(".framework") || name.endsWith(".app"))) {
                    deepTargets.push(full);
                } else if (st.isFile() && name.endsWith(".dylib")) {
                    dylibTargets.push(full);
                }
            }
            for (const fwPath of deepTargets) {
                execSyncFn("codesign", ["--force", "--deep", ...kcArgs, "--sign", resolved.identity, fwPath], { stdio: stdioMode });
            }
            for (const dylibPath of dylibTargets) {
                execSyncFn("codesign", ["--force", ...kcArgs, "--sign", resolved.identity, dylibPath], { stdio: stdioMode });
            }
        }

        const resBinDir = path.join(appBundle, "Contents", "Resources", "bin");
        const binExecutables = collectExecutableFiles(resBinDir, fsMod);
        for (const binFile of binExecutables) {
            execSyncFn("codesign", ["--force", ...kcArgs, "--sign", resolved.identity, binFile], { stdio: stdioMode });
        }

        execSyncFn("codesign", ["--force", ...kcArgs, "--sign", resolved.identity, appBundle], { stdio: stdioMode });
        return true;
    } catch (err) {
        console.error("[错误] macOS 固定证书签名失败: " + err.message);
        return false;
    }
}

function inspectStatus(resourcesDir) {
    const asarPath = path.join(resourcesDir, "app.asar");
    const bakPath = path.join(resourcesDir, "app.asar.bak");
    const st = {
        resourcesDir,
        asarExists: fs.existsSync(asarPath),
        bakExists: fs.existsSync(bakPath),
        hasLocalization: false,
        hasMemeIpc: false,
        hasContextBridgeIpc: false,
        hasContextBridgePreload: false
    };
    if (!st.asarExists) return st;
    const preloadBuf = AsarArchive.readFile(asarPath, "dist/preload.js");
    const ipcBuf = AsarArchive.readFile(asarPath, "dist/ipcHandlers.js");
    const preloadTxt = preloadBuf ? preloadBuf.toString("utf8") : "";
    const ipcTxt = ipcBuf ? ipcBuf.toString("utf8") : "";
    st.hasLocalization = preloadTxt.includes("__ANTIGRAVITY_CHINESE_LOCALIZATION_START__");
    st.hasMemeIpc = ipcTxt.includes("__ANTIGRAVITY_IPC_MEME_START__");
    st.hasContextBridgeIpc = ipcTxt.includes(IPC_BRIDGE_SIGNATURE_START);
    st.hasContextBridgePreload = preloadTxt.includes(PRELOAD_BRIDGE_SIGNATURE_START) && preloadTxt.includes(BRIDGE_MARKER);
    return st;
}

function buildPatchedPreload(rawPreload) {
    const cleaned = removeMarkedBlocks(rawPreload, PRELOAD_BRIDGE_SIGNATURE_START, PRELOAD_BRIDGE_SIGNATURE_END).trimEnd();
    const block = [
        "",
        PRELOAD_BRIDGE_SIGNATURE_START,
        "(() => {",
        "    try {",
        "        const elec = typeof electron_1 !== 'undefined' ? electron_1 : (typeof require === 'function' ? (() => { try { return require('electron'); } catch (_) { return null; } })() : null);",
        "        (" + __agSetupContextBridgePreload.toString() + ")(elec);",
        "    } catch (e) { try { console.error('[AG-Context Bridge Preload]', e); } catch (_) {} }",
        "})();",
        PRELOAD_BRIDGE_SIGNATURE_END,
        ""
    ].join("\n");
    return cleaned + "\n" + block;
}

function buildPatchedIpcHandlers(rawIpc) {
    const cleaned = removeMarkedBlocks(rawIpc, IPC_BRIDGE_SIGNATURE_START, IPC_BRIDGE_SIGNATURE_END);
    const match = cleaned.match(/function\s+registerIpcHandlers\s*\([^)]*\)\s*\{/);
    if (!match) {
        throw new Error("未能在 dist/ipcHandlers.js 中找到 registerIpcHandlers 函数插入点");
    }
    const header = match[0];
    const pos = cleaned.indexOf(header);
    const block = [
        "",
        "    " + IPC_BRIDGE_SIGNATURE_START,
        "    try {",
        "        const _agCtxElec = typeof electron_1 !== 'undefined' ? electron_1 : require('electron');",
        "        (" + __agRegisterContextBridgeIpcHandlers.toString() + ")(_agCtxElec);",
        "    } catch (e) {",
        "        console.error('[AG-Context Bridge IPC] Register failed:', e);",
        "    }",
        "    " + IPC_BRIDGE_SIGNATURE_END
    ].join("\n");
    return cleaned.substring(0, pos + header.length) + block + cleaned.substring(pos + header.length);
}

function installContextBridge(resourcesDir, options = {}) {
    const asarPath = path.join(resourcesDir, "app.asar");
    const bakPath = path.join(resourcesDir, "app.asar.bak");
    if (!fs.existsSync(asarPath) && !fs.existsSync(bakPath)) {
        console.error("[错误] 未在资源目录中找到 app.asar: " + resourcesDir);
        return false;
    }
    if (!fs.existsSync(bakPath)) {
        console.log("[备份] 首次注入，正在创建官方原始包备份 app.asar.bak ...");
        fs.copyFileSync(asarPath, bakPath);
    }

    const sourceAsar = fs.existsSync(asarPath) ? asarPath : bakPath;
    const preloadBuf = AsarArchive.readFile(sourceAsar, "dist/preload.js");
    const ipcBuf = AsarArchive.readFile(sourceAsar, "dist/ipcHandlers.js");
    if (!preloadBuf || !ipcBuf) {
        console.error("[错误] 无法从 app.asar 读取 dist/preload.js 或 dist/ipcHandlers.js");
        return false;
    }

    let patchedPreload = "";
    let patchedIpc = "";
    try {
        patchedPreload = buildPatchedPreload(preloadBuf.toString("utf8"));
        patchedIpc = buildPatchedIpcHandlers(ipcBuf.toString("utf8"));
        new vm.Script(patchedPreload);
        new vm.Script(patchedIpc);
    } catch (err) {
        console.error("[致命错误] 上下文桥接补丁语法校验失败: " + err.message);
        return false;
    }

    console.log("[打包] 正在将 antigravity-context-pro 零 CDP 原生 IPC 桥接层叠加写入 app.asar ...");
    const filePatches = {
        "dist/preload.js": patchedPreload,
        "dist/ipcHandlers.js": patchedIpc
    };
    if (!atomicWritePatchedAsar(sourceAsar, asarPath, filePatches)) return false;

    console.log("[√] antigravity-context-pro 零 CDP 桥接层注入成功！");
    if (process.platform === "darwin" && !options.skipSign && !resignAppOnMac(resourcesDir)) {
        return false;
    }
    return true;
}

function uninstallContextBridge(resourcesDir, options = {}) {
    const asarPath = path.join(resourcesDir, "app.asar");
    if (!fs.existsSync(asarPath)) {
        console.error("[错误] 未找到 app.asar: " + asarPath);
        return false;
    }
    const preloadBuf = AsarArchive.readFile(asarPath, "dist/preload.js");
    const ipcBuf = AsarArchive.readFile(asarPath, "dist/ipcHandlers.js");
    if (!preloadBuf || !ipcBuf) {
        console.error("[错误] 无法读取 app.asar 内容。");
        return false;
    }
    const rawPreload = preloadBuf.toString("utf8");
    const rawIpc = ipcBuf.toString("utf8");
    const cleanPreload = removeMarkedBlocks(rawPreload, PRELOAD_BRIDGE_SIGNATURE_START, PRELOAD_BRIDGE_SIGNATURE_END);
    const cleanIpc = removeMarkedBlocks(rawIpc, IPC_BRIDGE_SIGNATURE_START, IPC_BRIDGE_SIGNATURE_END);

    if (cleanPreload === rawPreload && cleanIpc === rawIpc) {
        console.log("[跳过] 当前 app.asar 未检测到 context-bridge 补丁标记，已是干净状态。");
        return true;
    }

    try {
        new vm.Script(cleanPreload);
        new vm.Script(cleanIpc);
    } catch (err) {
        console.error("[致命错误] 剥离 context-bridge 补丁后语法校验失败: " + err.message);
        return false;
    }

    const filePatches = {};
    if (cleanPreload !== rawPreload) filePatches["dist/preload.js"] = cleanPreload;
    if (cleanIpc !== rawIpc) filePatches["dist/ipcHandlers.js"] = cleanIpc;

    console.log("[还原] 正在从 app.asar 无损剥离 antigravity-context-pro 桥接层（保留汉化与猫娘补丁）...");
    if (!atomicWritePatchedAsar(asarPath, asarPath, filePatches)) return false;

    console.log("[√] antigravity-context-pro 桥接层已无损卸载！");
    if (process.platform === "darwin" && !options.skipSign && !resignAppOnMac(resourcesDir)) {
        return false;
    }
    return true;
}

function parseArgs(argv) {
    const opts = {
        action: "install",
        manualDir: "",
        noKill: false,
        skipSign: false,
        checkWriteOnly: false,
        forceSelf: false,
        jsonOut: false
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--install") opts.action = "install";
        else if (a === "--uninstall") opts.action = "uninstall";
        else if (a === "--status") opts.action = "status";
        else if (a === "--no-kill") opts.noKill = true;
        else if (a === "--skip-sign") opts.skipSign = true;
        else if (a === "--check-write") opts.checkWriteOnly = true;
        else if (a === "--force-self") opts.forceSelf = true;
        else if (a === "--json") opts.jsonOut = true;
        else if (a === "--install-dir") opts.manualDir = argv[++i] || "";
        else if (a.startsWith("--install-dir=")) opts.manualDir = a.slice("--install-dir=".length);
        else if (a === "-h" || a === "--help") {
            console.log([
                "用法: node context_bridge_patcher.js [选项]",
                "  --install             叠加注入零 CDP 原生 IPC 桥接层 (默认)",
                "  --uninstall           无损剥离桥接层（保留汉化与猫娘补丁）",
                "  --status [--json]     只读查看当前注入状态",
                "  --install-dir <path>  手动指定 Antigravity 安装目录或沙箱目录",
                "  --no-kill             不尝试关闭/重启运行中的 Antigravity 进程",
                "  --skip-sign           仅修补 ASAR，跳过单次 codesign（适合统一由外层脚本持久签名）",
                "  --check-write         仅检测写入权限 (退出码 0=可写, 2=需提权, 3=未找到)"
            ].join("\n"));
            process.exit(0);
        }
    }
    return opts;
}

function main() {
    const opts = parseArgs(process.argv.slice(2));
    const installDir = detectInstallationDir(opts.manualDir);
    if (!installDir) {
        if (opts.jsonOut) console.log(JSON.stringify({ installed: false }));
        else if (!opts.checkWriteOnly) console.error("[未找到] 未检测到 Antigravity Desktop 客户端。");
        process.exit(opts.checkWriteOnly ? 3 : 1);
    }

    const resourcesDir = resolveResourcesDir(installDir);
    if (!fs.existsSync(resourcesDir)) {
        if (opts.checkWriteOnly) process.exit(3);
        console.error("[错误] 无效的资源目录: " + resourcesDir);
        process.exit(1);
    }

    if (opts.checkWriteOnly) {
        const asarPath = path.join(resourcesDir, "app.asar");
        if (!fs.existsSync(asarPath)) process.exit(3);
        try {
            fs.accessSync(resourcesDir, fs.constants.W_OK | fs.constants.X_OK);
            fs.accessSync(asarPath, fs.constants.R_OK | fs.constants.W_OK);
            const appBundle = findMacAppBundle(resourcesDir);
            if (appBundle) fs.accessSync(appBundle, fs.constants.W_OK | fs.constants.X_OK);
            process.exit(0);
        } catch (_) {
            process.exit(2);
        }
    }

    if (opts.action === "status") {
        const st = inspectStatus(resourcesDir);
        if (opts.jsonOut) {
            console.log(JSON.stringify(st, null, 2));
        } else {
            console.log("Antigravity Resources: " + st.resourcesDir);
            console.log("  app.asar          : " + (st.asarExists ? "✅" : "❌"));
            console.log("  app.asar.bak      : " + (st.bakExists ? "✅" : "❌"));
            console.log("  中文汉化          : " + (st.hasLocalization ? "✅" : "—"));
            console.log("  agy-meme IPC      : " + (st.hasMemeIpc ? "✅" : "—"));
            console.log("  上下文IPC桥       : " + (st.hasContextBridgeIpc ? "✅" : "❌"));
            console.log("  上下文Preload桥   : " + (st.hasContextBridgePreload ? "✅" : "❌"));
        }
        process.exit(0);
    }

    if (!opts.manualDir && !opts.forceSelf && isInsideAntigravityProcessTree()) {
        console.error("[安全拦截] 检测到当前正运行在 Antigravity 桌面端会话内！");
        console.error("请在系统独立外部终端中执行：");
        console.error("  node " + path.resolve(__filename) + " --" + opts.action);
        process.exit(2);
    }

    const ok = opts.action === "uninstall"
        ? uninstallContextBridge(resourcesDir, opts)
        : installContextBridge(resourcesDir, opts);
    process.exit(ok ? 0 : 1);
}

if (require.main === module) {
    main();
}

module.exports = {
    IPC_BRIDGE_SIGNATURE_START,
    IPC_BRIDGE_SIGNATURE_END,
    PRELOAD_BRIDGE_SIGNATURE_START,
    PRELOAD_BRIDGE_SIGNATURE_END,
    BRIDGE_MARKER,
    AsarArchive,
    buildPatchedPreload,
    buildPatchedIpcHandlers,
    inspectStatus,
    installContextBridge,
    uninstallContextBridge,
    resolveTargetUserHome,
    resolveMacLoginKeychainPath,
    isTrustedIdentityInSecurityOutput,
    detectMacCodesignIdentity,
    resignAppOnMac
};
