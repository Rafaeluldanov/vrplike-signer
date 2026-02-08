"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatDoctorReport = formatDoctorReport;
const ws_1 = __importDefault(require("ws"));
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const os_1 = require("os");
const net_1 = __importDefault(require("net"));
const path = __importStar(require("path"));
const readline = __importStar(require("readline"));
const cryptopro_signer_1 = require("./cryptopro/cryptopro-signer");
const cryptopro_certmgr_1 = require("./cryptopro/cryptopro-certmgr");
const certificate_selection_1 = require("./certificate-selection");
const deeplink_1 = require("./deeplink");
const win_hta_cert_select_1 = require("./ui/win-hta-cert-select");
const register_deeplink_1 = require("./windows/register-deeplink");
const register_autostart_1 = require("./windows/register-autostart");
const tray_1 = require("./windows/tray");
const ipc_1 = require("./windows/ipc");
const tray_host_1 = require("./windows/tray-host");
const log_1 = require("./log");
const launcher_plan_1 = require("./launcher-plan");
let isBackgroundRuntime = false;
function toNonEmptyString(v) {
    return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function isNonEmptyString(v) {
    return typeof v === 'string' && v.length > 0;
}
function safeJsonParse(text) {
    try {
        return JSON.parse(text);
    }
    catch (_a) {
        return null;
    }
}
function normalizeCliKey(k) {
    return String(k !== null && k !== void 0 ? k : '')
        .replace(/^-+/, '')
        .trim()
        .replace(/_/g, '-')
        .toLowerCase();
}
function parseCliArgs(argv) {
    const out = { help: false, doctor: false, installed: false };
    const set = (key, value) => {
        if (key === 'help')
            out.help = Boolean(value);
        if (key === 'doctor')
            out.doctor = Boolean(value);
        if (key === 'installed')
            out.installed = Boolean(value);
        if (typeof value !== 'string')
            return;
        if (key === 'wssurl')
            out.wssUrl = value;
        if (key === 'pairingtoken')
            out.pairingToken = value;
        if (key === 'certificateref')
            out.certificateRef = value;
    };
    for (let i = 0; i < argv.length; i++) {
        const raw = argv[i];
        if (raw === '-h' || raw === '--help') {
            out.help = true;
            continue;
        }
        if (raw === '--doctor') {
            out.doctor = true;
            continue;
        }
        if (raw === '--installed') {
            out.installed = true;
            continue;
        }
        if (!raw.startsWith('--'))
            continue;
        const eqIdx = raw.indexOf('=');
        const keyRaw = eqIdx >= 0 ? raw.slice(0, eqIdx) : raw;
        const keyNorm = normalizeCliKey(keyRaw).replace(/-/g, '');
        const value = eqIdx >= 0 ? raw.slice(eqIdx + 1) : argv[i + 1];
        if (keyNorm === 'help') {
            out.help = true;
            continue;
        }
        if (keyNorm === 'doctor') {
            out.doctor = true;
            continue;
        }
        if (keyNorm === 'installed') {
            out.installed = true;
            continue;
        }
        if (keyNorm === 'wssurl' || keyNorm === 'pairingtoken' || keyNorm === 'certificateref') {
            if (eqIdx < 0)
                i++;
            const v = toNonEmptyString(value);
            if (v)
                set(keyNorm, v);
        }
    }
    return out;
}
function truncateUtf8(buf, maxBytes) {
    if (buf.length <= maxBytes)
        return buf.toString('utf8');
    return buf.subarray(0, maxBytes).toString('utf8') + '\n[...truncated...]';
}
function resolveWindowsAppDataFallback() {
    var _a, _b;
    let appData = String((_a = process.env.APPDATA) !== null && _a !== void 0 ? _a : '').trim();
    if (appData)
        return appData;
    const userProfile = String((_b = process.env.USERPROFILE) !== null && _b !== void 0 ? _b : '').trim();
    if (userProfile)
        return path.join(userProfile, 'AppData', 'Roaming');
    return path.join((0, os_1.homedir)(), 'AppData', 'Roaming');
}
function resolveWindowsLocalAppDataFallback() {
    var _a, _b;
    const local = String((_a = process.env.LOCALAPPDATA) !== null && _a !== void 0 ? _a : '').trim();
    if (local)
        return local;
    const userProfile = String((_b = process.env.USERPROFILE) !== null && _b !== void 0 ? _b : '').trim();
    if (userProfile)
        return path.join(userProfile, 'AppData', 'Local');
    return path.join((0, os_1.homedir)(), 'AppData', 'Local');
}
function looksLikeInstalledWindowsExecPath(execPath) {
    if (process.platform !== 'win32')
        return false;
    const exe = path.normalize(String(execPath !== null && execPath !== void 0 ? execPath : ''));
    if (!exe)
        return false;
    const localApp = path.normalize(path.join(resolveWindowsLocalAppDataFallback(), 'vrplike-signer'));
    const exeLower = exe.toLowerCase();
    const localLower = localApp.toLowerCase();
    if (exeLower.startsWith(localLower + path.sep))
        return true;
    return exeLower.includes(`${path.sep}vrplike-signer${path.sep}`);
}
function checkVrplikeSignerProtocolRegistryWindows() {
    var _a, _b;
    if (process.platform !== 'win32')
        return null;
    const key = 'HKCU\\Software\\Classes\\vrplike-signer\\shell\\open\\command';
    const command = `reg.exe query "${key}"`;
    try {
        const r = (0, child_process_1.spawnSync)('reg.exe', ['query', key], {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf8',
            maxBuffer: 1024 * 1024,
        });
        return {
            ok: r.status === 0,
            exitCode: typeof r.status === 'number' ? r.status : null,
            command,
            stdout: String((_a = r.stdout) !== null && _a !== void 0 ? _a : ''),
            stderr: String((_b = r.stderr) !== null && _b !== void 0 ? _b : ''),
        };
    }
    catch (e) {
        return {
            ok: false,
            exitCode: null,
            command,
            stdout: '',
            stderr: e instanceof Error ? e.message : String(e),
        };
    }
}
function formatDoctorReport(info) {
    var _a, _b, _c, _d, _e, _f;
    const homeDrive = String((_a = info.env.HOMEDRIVE) !== null && _a !== void 0 ? _a : '').trim();
    const homePath = String((_b = info.env.HOMEPATH) !== null && _b !== void 0 ? _b : '').trim();
    const homeDrivePath = (homeDrive || homePath) && `${homeDrive}${homePath}`;
    const lines = [];
    lines.push('vrplike-signer --doctor');
    lines.push(`platform: ${info.platform}`);
    lines.push(`process.execPath: ${info.execPath}`);
    lines.push(`process.cwd(): ${info.cwd}`);
    lines.push(`env.APPDATA: ${String((_c = info.env.APPDATA) !== null && _c !== void 0 ? _c : '')}`);
    lines.push(`env.USERPROFILE: ${String((_d = info.env.USERPROFILE) !== null && _d !== void 0 ? _d : '')}`);
    lines.push(`env.HOMEDRIVE+env.HOMEPATH: ${homeDrivePath || ''}`);
    lines.push(`os.homedir(): ${info.osHomedir}`);
    lines.push(`calculated appDataFallback: ${info.appDataFallback}`);
    lines.push(`agent.json: ${info.agentJsonPath}`);
    if (info.registryCheck) {
        lines.push(`registry vrplike-signer://: ${info.registryCheck.ok ? 'YES' : 'NO'}`);
        lines.push(`registry command: ${info.registryCheck.command}`);
        lines.push(`registry exitCode: ${(_e = info.registryCheck.exitCode) !== null && _e !== void 0 ? _e : 'n/a'}`);
        if (!info.registryCheck.ok) {
            const tail = (info.registryCheck.stderr || info.registryCheck.stdout || '').trim();
            if (tail)
                lines.push(`registry output:\n${truncateUtf8(Buffer.from(tail, 'utf8'), 2048)}`);
        }
    }
    else {
        lines.push('registry vrplike-signer://: n/a (non-windows)');
    }
    if (info.tray) {
        lines.push(`tray-host exe (expected): ${info.tray.expectedExePath}`);
        lines.push(`tray-host exe exists: ${info.tray.expectedExeExists ? 'YES' : 'NO'}${info.tray.expectedExeExists ? ` size=${(_f = info.tray.expectedExeSize) !== null && _f !== void 0 ? _f : 'n/a'}` : ''}`);
        lines.push(`tray pipe name: ${info.tray.pipeName}`);
        lines.push(`tray pipe path: ${info.tray.pipePath}`);
        lines.push(`tray pipe server running: ${info.tray.pipeServerRunning ? 'YES' : 'NO'}`);
    }
    else {
        lines.push('tray-host: n/a');
    }
    return lines.join('\n');
}
function printCryptoProNotFound(details) {
    console.error('CryptoPro CSP не найден.');
    console.error('Установите CryptoPro CSP и повторите.');
    console.error('');
    const checkedPaths = (details && typeof details === 'object' && 'checkedPaths' in details ? details.checkedPaths : null);
    const list = Array.isArray(checkedPaths) ? checkedPaths.filter((x) => typeof x === 'string' && String(x).trim()) : [];
    if (!list.length)
        return;
    console.error('Проверенные пути:');
    for (const p of list) {
        console.error(`— ${p}`);
    }
}
async function runDoctor(args) {
    const trayInfo = process.platform !== 'win32'
        ? null
        : await (async () => {
            const pipeName = (0, tray_host_1.computeTrayHostPipeName)({ platform: 'win32' });
            const pipePath = (0, tray_host_1.namedPipePathWindows)(pipeName);
            const expectedExePath = looksLikeInstalledWindowsExecPath(process.execPath)
                ? path.join(path.dirname(process.execPath), 'vrplike-signer-tray.exe')
                : (0, tray_host_1.resolveTrayHostPaths)({}).targetPath;
            let expectedExeExists = false;
            let expectedExeSize = null;
            try {
                if ((0, fs_1.existsSync)(expectedExePath)) {
                    expectedExeExists = true;
                    const st = (0, fs_1.statSync)(expectedExePath);
                    expectedExeSize = st.isFile() ? st.size : null;
                }
            }
            catch (_a) {
            }
            const pipeServerRunning = await new Promise((resolve) => {
                let done = false;
                const finish = (v) => {
                    if (done)
                        return;
                    done = true;
                    resolve(v);
                };
                const sock = net_1.default.connect(pipePath);
                const t = setTimeout(() => {
                    try {
                        sock.destroy();
                    }
                    catch (_a) {
                    }
                    finish(false);
                }, 200);
                sock.on('connect', () => {
                    clearTimeout(t);
                    try {
                        sock.end();
                    }
                    catch (_a) {
                    }
                    finish(true);
                });
                sock.on('error', () => {
                    clearTimeout(t);
                    finish(false);
                });
            });
            return { pipeName, pipePath, expectedExePath, expectedExeExists, expectedExeSize, pipeServerRunning };
        })();
    const report = formatDoctorReport({
        platform: process.platform,
        execPath: process.execPath,
        cwd: process.cwd(),
        env: {
            APPDATA: process.env.APPDATA,
            USERPROFILE: process.env.USERPROFILE,
            HOMEDRIVE: process.env.HOMEDRIVE,
            HOMEPATH: process.env.HOMEPATH,
        },
        osHomedir: (0, os_1.homedir)(),
        appDataFallback: resolveWindowsAppDataFallback(),
        agentJsonPath: args.statePath,
        registryCheck: checkVrplikeSignerProtocolRegistryWindows(),
        tray: trayInfo !== null && trayInfo !== void 0 ? trayInfo : undefined,
    });
    console.log(report);
}
function defaultAgentStatePath() {
    const appData = toNonEmptyString(process.env.APPDATA);
    if (appData) {
        return path.join(appData, 'vrplike-signer', 'agent.json');
    }
    return path.join((0, os_1.homedir)(), '.vrplike-signer', 'agent.json');
}
function defaultBaseDir() {
    const appData = toNonEmptyString(process.env.APPDATA);
    if (appData)
        return path.join(appData, 'vrplike-signer');
    return path.join((0, os_1.homedir)(), '.vrplike-signer');
}
function defaultLogsDir() {
    return path.join(defaultBaseDir(), 'logs');
}
function loadState(path) {
    var _a, _b, _c, _d;
    try {
        if (!(0, fs_1.existsSync)(path))
            return null;
        const raw = (0, fs_1.readFileSync)(path, 'utf8');
        const j = safeJsonParse(raw);
        const agentId = toNonEmptyString(j === null || j === void 0 ? void 0 : j.agentId);
        const agentSecret = toNonEmptyString(j === null || j === void 0 ? void 0 : j.agentSecret);
        if (!agentId || !agentSecret)
            return null;
        return {
            agentId,
            agentSecret,
            wssUrl: (_a = toNonEmptyString(j === null || j === void 0 ? void 0 : j.wssUrl)) !== null && _a !== void 0 ? _a : undefined,
            certificateRef: (_b = toNonEmptyString(j === null || j === void 0 ? void 0 : j.certificateRef)) !== null && _b !== void 0 ? _b : undefined,
            organizationId: (_c = toNonEmptyString(j === null || j === void 0 ? void 0 : j.organizationId)) !== null && _c !== void 0 ? _c : undefined,
            legalEntityId: (_d = toNonEmptyString(j === null || j === void 0 ? void 0 : j.legalEntityId)) !== null && _d !== void 0 ? _d : undefined,
            pinnedThumbprintsByInn: ((j === null || j === void 0 ? void 0 : j.pinnedThumbprintsByInn) && typeof j.pinnedThumbprintsByInn === 'object' && !Array.isArray(j.pinnedThumbprintsByInn)
                ? j.pinnedThumbprintsByInn
                : undefined),
        };
    }
    catch (_e) {
        return null;
    }
}
function saveState(filePath, state) {
    const json = JSON.stringify(state, null, 2);
    try {
        (0, fs_1.mkdirSync)(path.dirname(filePath), { recursive: true });
    }
    catch (_a) {
    }
    (0, fs_1.writeFileSync)(filePath, json, { mode: 0o600 });
}
function send(ws, msg) {
    ws.send(JSON.stringify(msg));
}
async function promptSelectCertificateConsole(args) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const question = (q) => new Promise((resolve) => rl.question(q, resolve));
    const withTimeout = async (p, timeoutMs) => {
        let t = null;
        try {
            return await Promise.race([
                p,
                new Promise((_, reject) => {
                    t = setTimeout(() => reject(new cryptopro_signer_1.SignerError('TIMEOUT', 'Certificate selection timed out (no input).')), timeoutMs);
                }),
            ]);
        }
        finally {
            if (t)
                clearTimeout(t);
        }
    };
    try {
        console.log(`[agent] Found ${args.candidates.length} certificates for INN=${args.expectedInn}. Please choose one:`);
        args.candidates.forEach((c, idx) => {
            const isDefault = args.defaultThumbprint && c.thumbprint === args.defaultThumbprint;
            console.log(`  ${idx + 1}) ${c.thumbprint}${isDefault ? '  [default]' : ''}\n     ${c.subject}${c.validTo ? `\n     validTo: ${c.validTo}` : ''}`);
        });
        const defaultIdx = args.defaultThumbprint ? args.candidates.findIndex((c) => c.thumbprint === args.defaultThumbprint) : -1;
        while (true) {
            const hint = defaultIdx >= 0 ? ` (Enter=${defaultIdx + 1})` : '';
            const raw = (await withTimeout(question(`Select certificate number${hint} (or 'q' to cancel): `), 5 * 60 * 1000)).trim();
            const lower = raw.toLowerCase();
            if (lower === 'q' || lower === 'quit' || lower === 'exit') {
                throw new cryptopro_signer_1.SignerError('USER_CANCELLED', 'Certificate selection cancelled by user');
            }
            const pickedRaw = raw || (defaultIdx >= 0 ? String(defaultIdx + 1) : '');
            const n = pickedRaw ? Number(pickedRaw) : NaN;
            if (Number.isFinite(n) && n >= 1 && n <= args.candidates.length) {
                const selected = args.candidates[n - 1];
                if (!args.allowRememberSelection) {
                    return { thumbprint: selected.thumbprint, remember: false };
                }
                const rememberRaw = (await withTimeout(question('Pin this selection for this INN? (y/N): '), 2 * 60 * 1000)).trim().toLowerCase();
                const remember = rememberRaw === 'y' || rememberRaw === 'yes' || rememberRaw === 'да' || rememberRaw === 'д';
                return { thumbprint: selected.thumbprint, remember: Boolean(remember) };
            }
            console.log('Invalid selection. Please enter a number from the list.');
        }
    }
    finally {
        rl.close();
    }
}
async function promptSelectCertificate(args) {
    if (process.platform === 'win32') {
        try {
            return await (0, win_hta_cert_select_1.promptSelectCertificateWinHta)({
                expectedInn: args.expectedInn,
                candidates: args.candidates,
                defaultThumbprint: args.defaultThumbprint,
                allowRememberSelection: args.allowRememberSelection,
                timeoutMs: 5 * 60 * 1000,
            });
        }
        catch (e) {
            if (isBackgroundRuntime) {
                const msg = e instanceof Error ? e.message : String(e);
                throw new cryptopro_signer_1.SignerError('IO_ERROR', `Certificate selection UI failed: ${msg}`);
            }
            return await promptSelectCertificateConsole(args);
        }
    }
    return await promptSelectCertificateConsole(args);
}
async function runLauncher(rawArgsAll) {
    const baseDir = defaultBaseDir();
    const logsDir = defaultLogsDir();
    const logger = (0, log_1.createFileLogger)({ logsDir, filename: 'signer.log' });
    try {
        await (0, register_deeplink_1.ensureVrplikeSignerDeeplinkRegisteredWindows)({ log: (l) => logger.info(l) });
    }
    catch (e) {
        logger.warn('deeplink registration failed', { error: e instanceof Error ? e.message : String(e) });
    }
    try {
        await (0, register_autostart_1.ensureVrplikeSignerAutostartRegisteredWindows)({ log: (l) => logger.info(l) });
    }
    catch (e) {
        logger.warn('autostart registration failed', { error: e instanceof Error ? e.message : String(e) });
    }
    const ping = await (0, ipc_1.trySendIpcMessage)({ message: { type: 'PING' }, timeoutMs: 250 });
    if (ping.ok) {
        const msg = (0, launcher_plan_1.computeLauncherForwardMessage)(rawArgsAll);
        await (0, ipc_1.trySendIpcMessage)({ message: msg, timeoutMs: 500 }).catch(() => void 0);
        logger.close();
        return;
    }
    const childArgs = (0, launcher_plan_1.computeBackgroundChildArgs)(rawArgsAll);
    try {
        const child = (0, child_process_1.spawn)(process.execPath, childArgs, {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
        });
        child.unref();
    }
    catch (e) {
        logger.error('failed to spawn background child', { error: e instanceof Error ? e.message : String(e) });
    }
    finally {
        logger.close();
    }
}
async function main() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    const rawArgsAll = process.argv.slice(2);
    const argvEarly = parseCliArgs(rawArgsAll);
    const isInstalledMode = Boolean(argvEarly.installed || rawArgsAll.includes('--installed') || looksLikeInstalledWindowsExecPath(process.execPath));
    if (argvEarly.doctor || rawArgsAll.includes('--doctor')) {
        const statePath = (_a = toNonEmptyString(process.env.AGENT_STATE_PATH)) !== null && _a !== void 0 ? _a : defaultAgentStatePath();
        await runDoctor({ statePath });
        process.exit(0);
    }
    if (!isInstalledMode && (0, launcher_plan_1.shouldRunLauncher)({ platform: process.platform, rawArgs: rawArgsAll })) {
        await runLauncher(rawArgsAll);
        return;
    }
    const isConsoleMode = rawArgsAll.includes('--console');
    const isAgentBackgroundMode = rawArgsAll.includes('--background') || isInstalledMode;
    const rawArgs = rawArgsAll.filter((a) => a !== '--background' && a !== '--console' && a !== '--installed');
    const argv = parseCliArgs(rawArgs);
    const statePath = (_b = toNonEmptyString(process.env.AGENT_STATE_PATH)) !== null && _b !== void 0 ? _b : defaultAgentStatePath();
    const deeplinkArg = (_c = rawArgs.find(launcher_plan_1.isDeeplinkArg)) !== null && _c !== void 0 ? _c : null;
    const baseDir = defaultBaseDir();
    const logsDir = defaultLogsDir();
    isBackgroundRuntime = process.platform === 'win32' && isAgentBackgroundMode && !isConsoleMode;
    const logger = process.platform === 'win32' ? (0, log_1.createFileLogger)({ logsDir, filename: 'signer.log' }) : null;
    if (logger)
        (isConsoleMode ? (0, log_1.hookConsoleToTeeLogger)(logger) : (0, log_1.hookConsoleToLogger)(logger));
    if (argv.help) {
        console.log([
            'vrplike-signer (Windows installed/portable exe / node dev)',
            '',
            'Usage:',
            '  vrplike-signer.exe "vrplike-signer://pair?token=...&wsUrl=wss%3A%2F%2Fapi.vrplike.io%2Fws%2Fedo-signer&le=..."',
            '  vrplike-signer.exe --wssUrl <wss://.../ws/edo-signer> --pairingToken <token>',
            '  vrplike-signer.exe --wssUrl <wss://.../ws/edo-signer>   # reconnect using saved agent.json',
            '',
            'Options:',
            '  --wssUrl <url>               WSS URL (wss://api.vrplike.io/ws/edo-signer)',
            '  --pairingToken <token>       One-time pairing token (first run)',
            '  --certificateRef <ref>       Optional default certificate ref (thumbprint/alias)',
            '  --installed                  Installed mode: no registry self-registration, no launcher',
            '  --doctor                     Diagnostics (support mode, no secrets)',
            '  --console                    Dev-only: run agent in foreground console',
            '',
            'Env fallback (dev/ops):',
            '  VRPLIKE_WSS_URL, PAIRING_TOKEN, CERTIFICATE_REF, AGENT_STATE_PATH',
            '',
        ].join('\n'));
        logger === null || logger === void 0 ? void 0 : logger.close();
        return;
    }
    let trayOnReconnect = () => void 0;
    let trayOnQuit = () => void 0;
    let tray = null;
    let shuttingDown = false;
    let ipcClose = null;
    let existingState = loadState(statePath);
    const envWssUrl = toNonEmptyString(process.env.VRPLIKE_WSS_URL);
    const envPairingToken = toNonEmptyString(process.env.PAIRING_TOKEN);
    const envCertificateRef = (_d = toNonEmptyString(process.env.CERTIFICATE_REF)) !== null && _d !== void 0 ? _d : undefined;
    let pairingToken = (_f = (_e = argv.pairingToken) !== null && _e !== void 0 ? _e : envPairingToken) !== null && _f !== void 0 ? _f : null;
    let wssUrl = (_j = (_h = (_g = argv.wssUrl) !== null && _g !== void 0 ? _g : envWssUrl) !== null && _h !== void 0 ? _h : existingState === null || existingState === void 0 ? void 0 : existingState.wssUrl) !== null && _j !== void 0 ? _j : null;
    const defaultCertificateRef = (_m = (_l = (_k = argv.certificateRef) !== null && _k !== void 0 ? _k : envCertificateRef) !== null && _l !== void 0 ? _l : existingState === null || existingState === void 0 ? void 0 : existingState.certificateRef) !== null && _m !== void 0 ? _m : undefined;
    const setTray = (state, details) => {
        if (!tray)
            return;
        tray.setState(state, details);
    };
    const gracefulShutdown = async () => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        try {
            setTray('reconnecting');
        }
        catch (_a) {
        }
        try {
            if (reconnectTimer)
                clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        catch (_b) {
        }
        try {
            closeWs();
        }
        catch (_c) {
        }
        try {
            await (ipcClose === null || ipcClose === void 0 ? void 0 : ipcClose());
        }
        catch (_d) {
        }
        try {
            tray === null || tray === void 0 ? void 0 : tray.kill();
        }
        catch (_e) {
        }
        try {
            logger === null || logger === void 0 ? void 0 : logger.close();
        }
        catch (_f) {
        }
    };
    trayOnQuit = () => void gracefulShutdown();
    process.on('SIGINT', () => void gracefulShutdown());
    process.on('SIGTERM', () => void gracefulShutdown());
    let ws = null;
    let connecting = false;
    let reconnectTimer = null;
    let reconnectAttempt = 0;
    function closeWs() {
        try {
            ws === null || ws === void 0 ? void 0 : ws.close();
        }
        catch (_a) {
        }
        ws = null;
    }
    const scheduleReconnect = (reason, immediate = false) => {
        if (shuttingDown)
            return;
        if (reconnectTimer)
            clearTimeout(reconnectTimer);
        reconnectTimer = null;
        try {
            setTray('reconnecting');
        }
        catch (_a) {
        }
        if (immediate) {
            reconnectAttempt = 0;
            void connectLoop('manual');
            return;
        }
        reconnectAttempt += 1;
        const base = Math.min(30000, 750 * Math.pow(2, Math.min(6, reconnectAttempt)));
        const jitter = Math.floor(Math.random() * 500);
        const delay = Math.max(500, base + jitter);
        console.log(`[agent] reconnect scheduled in ${delay}ms (${reason})`);
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            void connectLoop('reconnect');
        }, delay);
    };
    trayOnReconnect = () => {
        closeWs();
        scheduleReconnect('tray_reconnect', true);
    };
    const handleDeeplinkPair = async (url) => {
        var _a, _b, _c;
        try {
            setTray('reconnecting');
            const version = '0.1.0';
            const parsed = (0, deeplink_1.parseVrplikeSignerDeeplink)(url);
            const apiBaseUrl = (0, deeplink_1.apiBaseFromWsUrl)(parsed.wsUrl);
            const exchanged = await (0, deeplink_1.exchangeDeeplinkToken)({
                apiBaseUrl,
                token: parsed.token,
                legalEntityId: parsed.legalEntityId,
                version,
            });
            if ((exchanged === null || exchanged === void 0 ? void 0 : exchanged.status) === 'already_connected') {
                console.log('[agent] deeplink: already connected');
                return;
            }
            const prev = (_b = (_a = loadState(statePath)) !== null && _a !== void 0 ? _a : existingState) !== null && _b !== void 0 ? _b : null;
            saveState(statePath, Object.assign(Object.assign({}, (prev !== null && prev !== void 0 ? prev : {})), { agentId: exchanged.agentId, agentSecret: exchanged.agentSecret, wssUrl: exchanged.wsUrl, certificateRef: prev === null || prev === void 0 ? void 0 : prev.certificateRef, legalEntityId: exchanged.legalEntityId }));
            existingState = (_c = loadState(statePath)) !== null && _c !== void 0 ? _c : existingState;
            wssUrl = exchanged.wsUrl;
            pairingToken = null;
            console.log(`[agent] deeplink paired successfully agentId=${exchanged.agentId}`);
            closeWs();
            scheduleReconnect('deeplink', true);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`[agent] deeplink pair failed: ${msg}`);
            setTray('error', { errorMessage: msg });
        }
    };
    const connectLoop = async (_why) => {
        var _a, _b, _c, _d, _e;
        if (shuttingDown)
            return;
        if (connecting)
            return;
        connecting = true;
        try {
            existingState = (_a = loadState(statePath)) !== null && _a !== void 0 ? _a : existingState;
            wssUrl = (_e = (_d = (_c = (_b = argv.wssUrl) !== null && _b !== void 0 ? _b : envWssUrl) !== null && _c !== void 0 ? _c : existingState === null || existingState === void 0 ? void 0 : existingState.wssUrl) !== null && _d !== void 0 ? _d : wssUrl) !== null && _e !== void 0 ? _e : null;
            if (!wssUrl) {
                setTray('error', { errorMessage: 'Not paired yet' });
                return;
            }
            setTray('reconnecting');
            ws = new ws_1.default(wssUrl);
            ws.on('open', () => {
                var _a;
                existingState = (_a = loadState(statePath)) !== null && _a !== void 0 ? _a : existingState;
                const canAuth = Boolean((existingState === null || existingState === void 0 ? void 0 : existingState.agentId) && (existingState === null || existingState === void 0 ? void 0 : existingState.agentSecret));
                if (pairingToken && !canAuth) {
                    send(ws, {
                        type: 'HELLO_PAIR',
                        pairingToken,
                        agentInfo: {
                            version: '0.1.0',
                            hostname: (0, os_1.hostname)(),
                        },
                    });
                    return;
                }
                if (!canAuth) {
                    console.error('[agent] no stored credentials; waiting for deeplink pairing');
                    setTray('error', { errorMessage: 'Not paired yet' });
                    closeWs();
                    return;
                }
                send(ws, {
                    type: 'HELLO_AUTH',
                    agentId: existingState.agentId,
                    agentSecret: existingState.agentSecret,
                });
            });
            wireHandlers({
                ws,
                wssUrl,
                statePath,
                getExistingState: () => { var _a; return (_a = loadState(statePath)) !== null && _a !== void 0 ? _a : existingState; },
                defaultCertificateRef,
                onReady: () => {
                    reconnectAttempt = 0;
                    setTray('connected');
                },
                onConnectionLost: (reason) => {
                    setTray('reconnecting');
                    scheduleReconnect(reason);
                },
            });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`[agent] connect failed: ${msg}`);
            setTray('reconnecting');
            scheduleReconnect('connect_failed');
        }
        finally {
            connecting = false;
        }
    };
    if (process.platform === 'win32') {
        try {
            const server = await (0, ipc_1.startIpcServer)({
                onMessage: async (msg) => {
                    var _a;
                    if (msg.type === 'DEEPLINK') {
                        await handleDeeplinkPair(msg.url);
                        return;
                    }
                    if (msg.type === 'ARGS') {
                        const url = (_a = msg.argv.find(launcher_plan_1.isDeeplinkArg)) !== null && _a !== void 0 ? _a : null;
                        if (url)
                            await handleDeeplinkPair(url);
                        return;
                    }
                    if (msg.type === 'RECONNECT') {
                        closeWs();
                        scheduleReconnect('ipc_reconnect', true);
                        return;
                    }
                    if (msg.type === 'QUIT') {
                        await gracefulShutdown();
                        return;
                    }
                },
                log: (l) => console.log(l),
            });
            ipcClose = server.close;
        }
        catch (e) {
            const code = (_o = toNonEmptyString(e === null || e === void 0 ? void 0 : e.code)) !== null && _o !== void 0 ? _o : '';
            if (code === 'EADDRINUSE' || code === 'EACCES') {
                const msg = (0, launcher_plan_1.computeLauncherForwardMessage)(rawArgsAll);
                await (0, ipc_1.trySendIpcMessage)({ message: msg, timeoutMs: 500 }).catch(() => void 0);
                return;
            }
            console.error(`[agent] ipc server failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    if (process.platform === 'win32') {
        try {
            tray = await (0, tray_1.createWindowsTray)({
                baseDir,
                logsDir,
                consoleMode: isConsoleMode,
                debug: rawArgsAll.includes('--debug'),
                mode: isInstalledMode ? 'installed' : 'portable',
                onReconnect: () => trayOnReconnect(),
                onQuit: () => trayOnQuit(),
                log: (l) => console.log(l),
            });
        }
        catch (e) {
            console.error(`[agent] tray init failed: ${e instanceof Error ? e.message : String(e)}`);
            if (isBackgroundRuntime) {
                try {
                    console.error('[agent] tray is mandatory in --background mode; shutting down');
                }
                catch (_p) {
                }
                await gracefulShutdown();
                return;
            }
            if (isConsoleMode || rawArgsAll.includes('--debug')) {
                console.error('[agent] tray init failed details', e === null || e === void 0 ? void 0 : e.details);
                throw e;
            }
            tray = null;
        }
    }
    if (tray) {
        tray.setState('reconnecting');
        if (isBackgroundRuntime || isConsoleMode || rawArgsAll.includes('--debug')) {
            await tray.ready;
        }
        else {
            void tray.ready.catch(() => void 0);
        }
    }
    if (deeplinkArg) {
        await handleDeeplinkPair(deeplinkArg);
    }
    await connectLoop('startup');
}
function wireHandlers(args) {
    const { ws, wssUrl, statePath, getExistingState, defaultCertificateRef } = args;
    ws.on('message', async (data) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
        const text = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : '';
        const msg = safeJsonParse(text);
        const type = toNonEmptyString(msg === null || msg === void 0 ? void 0 : msg.type);
        if (!type)
            return;
        if (type === 'PING') {
            send(ws, { type: 'PONG' });
            return;
        }
        if (type === 'WELCOME') {
            const agentId = toNonEmptyString(msg === null || msg === void 0 ? void 0 : msg.agentId);
            const agentSecret = toNonEmptyString(msg === null || msg === void 0 ? void 0 : msg.agentSecret);
            const organizationId = (_a = toNonEmptyString(msg === null || msg === void 0 ? void 0 : msg.organizationId)) !== null && _a !== void 0 ? _a : undefined;
            const legalEntityId = (_b = toNonEmptyString(msg === null || msg === void 0 ? void 0 : msg.legalEntityId)) !== null && _b !== void 0 ? _b : undefined;
            if (agentId && agentSecret) {
                const prev = (_d = (_c = loadState(statePath)) !== null && _c !== void 0 ? _c : getExistingState()) !== null && _d !== void 0 ? _d : null;
                saveState(statePath, Object.assign(Object.assign({}, (prev !== null && prev !== void 0 ? prev : {})), { agentId,
                    agentSecret,
                    wssUrl, certificateRef: defaultCertificateRef !== null && defaultCertificateRef !== void 0 ? defaultCertificateRef : prev === null || prev === void 0 ? void 0 : prev.certificateRef, organizationId,
                    legalEntityId }));
                console.log(`[agent] paired successfully agentId=${agentId} (state saved to ${statePath})`);
            }
            return;
        }
        if (type === 'READY') {
            console.log('[agent] connected and ready');
            (_e = args.onReady) === null || _e === void 0 ? void 0 : _e.call(args);
            return;
        }
        if (type === 'SIGN_REQUEST') {
            const requestId = toNonEmptyString(msg === null || msg === void 0 ? void 0 : msg.requestId);
            const operation = toNonEmptyString(msg === null || msg === void 0 ? void 0 : msg.operation);
            if (!requestId || !operation)
                return;
            const payload = msg === null || msg === void 0 ? void 0 : msg.payload;
            if (operation === 'AUTH_CHALLENGE_ATTACHED') {
                const challenge = payload === null || payload === void 0 ? void 0 : payload.challenge;
                const expectedInn = toNonEmptyString(payload === null || payload === void 0 ? void 0 : payload.expectedInn);
                const expectedKpp = toNonEmptyString(payload === null || payload === void 0 ? void 0 : payload.expectedKpp);
                void expectedKpp;
                const allowRememberSelection = Boolean(payload === null || payload === void 0 ? void 0 : payload.allowRememberSelection);
                let certificateRef = (_f = toNonEmptyString(payload === null || payload === void 0 ? void 0 : payload.certificateRef)) !== null && _f !== void 0 ? _f : undefined;
                const state = (_h = (_g = loadState(statePath)) !== null && _g !== void 0 ? _g : getExistingState()) !== null && _h !== void 0 ? _h : null;
                if (!certificateRef && expectedInn) {
                    try {
                        const certs = await (0, cryptopro_certmgr_1.listCertificatesCertmgr)(process.env);
                        const matches = (0, certificate_selection_1.filterCertificatesByInn)(certs, expectedInn);
                        const pinned = (_k = (_j = state === null || state === void 0 ? void 0 : state.pinnedThumbprintsByInn) === null || _j === void 0 ? void 0 : _j[expectedInn]) !== null && _k !== void 0 ? _k : undefined;
                        const chosen = await (0, certificate_selection_1.chooseCertificateThumbprint)({
                            expectedInn,
                            candidates: matches,
                            pinnedThumbprint: pinned,
                            allowRememberSelection,
                            prompt: async ({ expectedInn, candidates, defaultThumbprint, allowRememberSelection }) => {
                                const r = await promptSelectCertificate({
                                    expectedInn,
                                    candidates: candidates.map((c) => ({ thumbprint: c.thumbprint, subject: c.subject, validTo: c.validTo })),
                                    defaultThumbprint,
                                    allowRememberSelection,
                                });
                                return r;
                            },
                        });
                        certificateRef = chosen.thumbprint;
                        if (chosen.remember) {
                            const current = (_l = loadState(statePath)) !== null && _l !== void 0 ? _l : state;
                            if ((current === null || current === void 0 ? void 0 : current.agentId) && (current === null || current === void 0 ? void 0 : current.agentSecret)) {
                                saveState(statePath, Object.assign(Object.assign({}, current), { pinnedThumbprintsByInn: Object.assign(Object.assign({}, ((_m = current.pinnedThumbprintsByInn) !== null && _m !== void 0 ? _m : {})), { [expectedInn]: chosen.thumbprint }) }));
                                console.log(`[agent] pinned certificate for INN=${expectedInn}: ${chosen.thumbprint}`);
                            }
                        }
                    }
                    catch (e) {
                        const code = e instanceof cryptopro_signer_1.SignerError ? e.code : 'CERT_LIST_FAILED';
                        const message = e instanceof Error ? e.message : String(e);
                        send(ws, {
                            type: 'SIGN_RESULT',
                            requestId,
                            ok: false,
                            error: { code, message },
                        });
                        return;
                    }
                }
                if (!certificateRef) {
                    certificateRef = defaultCertificateRef;
                }
                if (!isNonEmptyString(challenge)) {
                    send(ws, {
                        type: 'SIGN_RESULT',
                        requestId,
                        ok: false,
                        error: {
                            code: 'INVALID_PAYLOAD',
                            message: 'payload.challenge must be a non-empty string',
                        },
                    });
                    return;
                }
                console.log(`[agent] SIGN_REQUEST requestId=${requestId} operation=${operation} certRef=${certificateRef !== null && certificateRef !== void 0 ? certificateRef : '-'}`);
                (0, cryptopro_signer_1.signAuthChallengeAttached)(challenge, { certificateRef })
                    .then((buf) => {
                    console.log(`[agent] SIGN_RESULT ok requestId=${requestId} bytes=${buf.length}`);
                    send(ws, {
                        type: 'SIGN_RESULT',
                        requestId,
                        ok: true,
                        signatureBase64: buf.toString('base64'),
                    });
                })
                    .catch((err) => {
                    const code = err instanceof cryptopro_signer_1.SignerError ? err.code : 'SIGN_FAILED';
                    const message = err instanceof Error ? err.message : String(err);
                    console.error(`[agent] SIGN_RESULT error requestId=${requestId} code=${code}`);
                    if (err instanceof cryptopro_signer_1.SignerError && err.code === 'CRYPTOPRO_NOT_FOUND') {
                        printCryptoProNotFound(err.details);
                    }
                    send(ws, {
                        type: 'SIGN_RESULT',
                        requestId,
                        ok: false,
                        error: {
                            code,
                            message,
                        },
                    });
                });
                return;
            }
            if (operation === 'DRAFT_DETACHED') {
                send(ws, {
                    type: 'SIGN_RESULT',
                    requestId,
                    ok: false,
                    error: {
                        code: 'SIGN_NOT_IMPLEMENTED',
                        message: 'DRAFT_DETACHED signing is not implemented yet.',
                    },
                });
                return;
            }
            send(ws, {
                type: 'SIGN_RESULT',
                requestId,
                ok: false,
                error: {
                    code: 'UNKNOWN_OPERATION',
                    message: `Unknown operation: ${operation}`,
                },
            });
            return;
        }
    });
    ws.on('close', (code, reason) => {
        var _a;
        const r = reason && Buffer.isBuffer(reason) ? reason.toString('utf8') : String(reason || '');
        console.log(`[agent] disconnected code=${code} reason=${r}`);
        (_a = args.onConnectionLost) === null || _a === void 0 ? void 0 : _a.call(args, `ws_close_${code}`);
    });
    ws.on('error', (err) => {
        var _a;
        console.error('[agent] ws error', err);
        (_a = args.onConnectionLost) === null || _a === void 0 ? void 0 : _a.call(args, (err === null || err === void 0 ? void 0 : err.message) || 'ws_error');
    });
}
if (require.main === module) {
    void main().catch((err) => {
        console.error('[agent] fatal', err);
    });
}
//# sourceMappingURL=index.js.map