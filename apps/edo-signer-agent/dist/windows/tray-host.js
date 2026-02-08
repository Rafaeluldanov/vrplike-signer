"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserSidWindows = getUserSidWindows;
exports.computeTrayHostPipeName = computeTrayHostPipeName;
exports.namedPipePathWindows = namedPipePathWindows;
exports.resolveWindowsAppDataFallback = resolveWindowsAppDataFallback;
exports.resolveTrayHostPaths = resolveTrayHostPaths;
exports.ensureTrayHostBinary = ensureTrayHostBinary;
exports.connectToTrayHost = connectToTrayHost;
exports.startTrayHostAndConnect = startTrayHostAndConnect;
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const net_1 = __importDefault(require("net"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
function toNonEmptyString(v) {
    return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function safeJsonParseLine(line) {
    try {
        return JSON.parse(line);
    }
    catch (_a) {
        return null;
    }
}
function normalizePipeNameComponent(v) {
    return String(v !== null && v !== void 0 ? v : '')
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .slice(0, 96);
}
function getUserSidWindows(args) {
    var _a, _b, _c, _d;
    const platform = (_a = args === null || args === void 0 ? void 0 : args.platform) !== null && _a !== void 0 ? _a : process.platform;
    if (platform !== 'win32')
        return null;
    const env = (_b = args === null || args === void 0 ? void 0 : args.env) !== null && _b !== void 0 ? _b : process.env;
    const fromEnv = toNonEmptyString(env.VRPLIKE_USER_SID);
    if (fromEnv)
        return fromEnv;
    const run = (_c = args === null || args === void 0 ? void 0 : args.run) !== null && _c !== void 0 ? _c : ((cmd, argv) => {
        var _a, _b;
        try {
            const r = (0, child_process_1.spawnSync)(cmd, argv, {
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
                encoding: 'utf8',
                maxBuffer: 1024 * 1024,
            });
            return { status: typeof r.status === 'number' ? r.status : null, stdout: String((_a = r.stdout) !== null && _a !== void 0 ? _a : ''), stderr: String((_b = r.stderr) !== null && _b !== void 0 ? _b : '') };
        }
        catch (e) {
            return { status: 1, stdout: '', stderr: e instanceof Error ? e.message : String(e) };
        }
    });
    const r = run('whoami.exe', ['/user', '/fo', 'csv', '/nh']);
    if (r.status !== 0)
        return null;
    const m = (_d = r.stdout.match(/"S-\d-(?:\d+-?)+"/i)) !== null && _d !== void 0 ? _d : r.stdout.match(/\bS-\d-(?:\d+-?)+\b/i);
    if (!m)
        return null;
    const sid = m[0].replace(/"/g, '').trim();
    return sid.startsWith('S-') ? sid : null;
}
function computeTrayHostPipeName(args) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const platform = (_a = args === null || args === void 0 ? void 0 : args.platform) !== null && _a !== void 0 ? _a : process.platform;
    if (platform !== 'win32')
        return 'vrplike-signer-tray-nonwin';
    const sid = (_c = (_b = toNonEmptyString(args === null || args === void 0 ? void 0 : args.sid)) !== null && _b !== void 0 ? _b : getUserSidWindows({ platform, env: args === null || args === void 0 ? void 0 : args.env })) !== null && _c !== void 0 ? _c : null;
    if (sid) {
        return `vrplike-signer-tray-${normalizePipeNameComponent(sid)}`;
    }
    const env = (_d = args === null || args === void 0 ? void 0 : args.env) !== null && _d !== void 0 ? _d : process.env;
    const userRaw = (_h = (_g = (_f = (_e = (toNonEmptyString(env.USERDOMAIN) && toNonEmptyString(env.USERNAME) ? `${env.USERDOMAIN}\\${env.USERNAME}` : null)) !== null && _e !== void 0 ? _e : toNonEmptyString(env.USERNAME)) !== null && _f !== void 0 ? _f : toNonEmptyString(args === null || args === void 0 ? void 0 : args.usernameFallback)) !== null && _g !== void 0 ? _g : (() => {
        try {
            return os_1.default.userInfo().username;
        }
        catch (_a) {
            return null;
        }
    })()) !== null && _h !== void 0 ? _h : 'user';
    return `vrplike-signer-tray-${normalizePipeNameComponent(userRaw)}`;
}
function namedPipePathWindows(pipeName) {
    return `\\\\.\\pipe\\${pipeName}`;
}
function resolveWindowsAppDataFallback(env) {
    const e = env !== null && env !== void 0 ? env : process.env;
    const appData = toNonEmptyString(e.APPDATA);
    if (appData)
        return appData;
    const userProfile = toNonEmptyString(e.USERPROFILE);
    if (userProfile)
        return path_1.default.join(userProfile, 'AppData', 'Roaming');
    return path_1.default.join(os_1.default.homedir(), 'AppData', 'Roaming');
}
function resolveTrayHostPaths(args) {
    var _a, _b, _c;
    const appData = (_a = toNonEmptyString(args === null || args === void 0 ? void 0 : args.appDataDir)) !== null && _a !== void 0 ? _a : resolveWindowsAppDataFallback();
    const targetDir = path_1.default.join(appData, 'vrplike-signer', 'bin');
    const targetPath = path_1.default.join(targetDir, 'tray-host.exe');
    const execPath = (_b = args === null || args === void 0 ? void 0 : args.execPath) !== null && _b !== void 0 ? _b : process.execPath;
    const exeSibling = path_1.default.join(path_1.default.dirname(execPath), 'tray-host.exe');
    const snapshotAsset = (_c = args === null || args === void 0 ? void 0 : args.assetPath) !== null && _c !== void 0 ? _c : path_1.default.resolve(__dirname, '../../assets/tray-host/win-x64/tray-host.exe');
    return { appData, targetDir, targetPath, exeSibling, snapshotAsset };
}
function fileSize(p) {
    try {
        const st = fs_1.default.statSync(p);
        if (!st.isFile())
            return null;
        return st.size;
    }
    catch (_a) {
        return null;
    }
}
function pathExists(p) {
    try {
        fs_1.default.accessSync(p);
        return true;
    }
    catch (_a) {
        return false;
    }
}
function trayHostError(details) {
    const err = new Error('TRAY_HOST_NOT_FOUND');
    err.code = 'TRAY_HOST_NOT_FOUND';
    if (details)
        err.details = details;
    return err;
}
async function ensureTrayHostBinary(opts) {
    var _a, _b, _c, _d;
    const platform = (_a = opts === null || opts === void 0 ? void 0 : opts.platform) !== null && _a !== void 0 ? _a : process.platform;
    if (platform !== 'win32') {
        throw trayHostError({ reason: 'non-windows' });
    }
    const log = (_b = opts === null || opts === void 0 ? void 0 : opts.log) !== null && _b !== void 0 ? _b : (() => void 0);
    const checkedPaths = [];
    const paths = resolveTrayHostPaths({ appDataDir: opts === null || opts === void 0 ? void 0 : opts.appDataDir, execPath: opts === null || opts === void 0 ? void 0 : opts.execPath, assetPath: opts === null || opts === void 0 ? void 0 : opts.assetPath });
    checkedPaths.push(path_1.default.normalize(paths.exeSibling));
    checkedPaths.push(path_1.default.normalize(paths.snapshotAsset));
    checkedPaths.push(path_1.default.normalize(paths.targetPath));
    const existingSize = fileSize(paths.targetPath);
    if (existingSize != null && existingSize > 0) {
        const source = pathExists(paths.exeSibling) ? 'EXE_DIR' : 'PKG_ASSET';
        log(`tray-host ready: ${paths.targetPath} size=${existingSize} source=${source}`);
        return paths.targetPath;
    }
    try {
        fs_1.default.mkdirSync(paths.targetDir, { recursive: true });
    }
    catch (e) {
        throw trayHostError({
            checkedPaths,
            appData: paths.appData,
            targetDir: paths.targetDir,
            reason: 'ensureDir failed',
            error: e instanceof Error ? e.message : String(e),
        });
    }
    if (pathExists(paths.exeSibling)) {
        try {
            fs_1.default.copyFileSync(paths.exeSibling, paths.targetPath);
            const size = (_c = fileSize(paths.targetPath)) !== null && _c !== void 0 ? _c : 0;
            if (size > 0) {
                log(`tray-host ready: ${paths.targetPath} size=${size} source=EXE_DIR`);
                return paths.targetPath;
            }
            throw new Error(`copied EXE_DIR but size=${size}`);
        }
        catch (e) {
            throw trayHostError({
                checkedPaths,
                appData: paths.appData,
                targetDir: paths.targetDir,
                reason: 'copy EXE_DIR failed',
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }
    let buf;
    try {
        buf = fs_1.default.readFileSync(paths.snapshotAsset);
    }
    catch (e) {
        throw trayHostError({
            checkedPaths,
            appData: paths.appData,
            targetDir: paths.targetDir,
            reason: 'read asset failed',
            error: e instanceof Error ? e.message : String(e),
        });
    }
    try {
        fs_1.default.writeFileSync(paths.targetPath, buf);
    }
    catch (e) {
        throw trayHostError({
            checkedPaths,
            appData: paths.appData,
            targetDir: paths.targetDir,
            reason: 'write extracted exe failed',
            error: e instanceof Error ? e.message : String(e),
        });
    }
    const size = (_d = fileSize(paths.targetPath)) !== null && _d !== void 0 ? _d : 0;
    if (size > 0) {
        log(`tray-host ready: ${paths.targetPath} size=${size} source=PKG_ASSET`);
        return paths.targetPath;
    }
    throw trayHostError({
        checkedPaths,
        appData: paths.appData,
        targetDir: paths.targetDir,
        reason: 'asset extracted but tray-host is empty',
        error: `size=${size}`,
    });
}
async function connectToTrayHost(args) {
    var _a;
    const log = (_a = args.log) !== null && _a !== void 0 ? _a : (() => void 0);
    const pipePath = namedPipePathWindows(args.pipeName);
    log(`tray-host: connect pipe=${pipePath}`);
    let socket = null;
    let buf = '';
    let closed = false;
    let resolveReady;
    let rejectReady;
    const ready = new Promise((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
    });
    const connectOnce = () => new Promise((resolve, reject) => {
        var _a;
        if (closed)
            return reject(new Error('TRAY_CONN_CLOSED'));
        const s = ((_a = args.connectImpl) !== null && _a !== void 0 ? _a : net_1.default.connect)(pipePath);
        socket = s;
        s.setEncoding('utf8');
        const t = setTimeout(() => {
            try {
                s.destroy();
            }
            catch (_a) {
            }
            reject(new Error('TRAY_PIPE_TIMEOUT'));
        }, 1500);
        s.on('connect', () => {
            clearTimeout(t);
            resolve();
        });
        s.on('error', (e) => {
            clearTimeout(t);
            reject(e);
        });
        s.on('data', (chunk) => {
            buf += String(chunk !== null && chunk !== void 0 ? chunk : '');
            while (buf.includes('\n')) {
                const idx = buf.indexOf('\n');
                const line = buf.slice(0, idx).trim();
                buf = buf.slice(idx + 1);
                if (!line)
                    continue;
                const msg = safeJsonParseLine(line);
                const type = toNonEmptyString(msg === null || msg === void 0 ? void 0 : msg.type);
                if (!type)
                    continue;
                if (type === 'TRAY_READY') {
                    if (resolveReady)
                        resolveReady();
                    continue;
                }
                if (type === 'MENU_CLICK') {
                    const id = toNonEmptyString(msg === null || msg === void 0 ? void 0 : msg.id);
                    if (id === 'RECONNECT' || id === 'OPEN_LOGS' || id === 'QUIT')
                        args.onEvent({ type: 'MENU_CLICK', id });
                    continue;
                }
            }
        });
        s.on('close', () => {
            socket = null;
            if (!closed) {
                if (rejectReady)
                    rejectReady(new Error('TRAY_PIPE_CLOSED'));
            }
        });
    });
    const startedAt = Date.now();
    while (true) {
        try {
            await connectOnce();
            break;
        }
        catch (e) {
            if (Date.now() - startedAt > 10000) {
                if (rejectReady)
                    rejectReady(e);
                throw e;
            }
            await new Promise((r) => setTimeout(r, 150));
        }
    }
    const send = (cmd) => {
        if (!socket || closed)
            return;
        try {
            socket.write(JSON.stringify(cmd) + '\n');
        }
        catch (_a) {
        }
    };
    const close = () => {
        if (closed)
            return;
        closed = true;
        try {
            socket === null || socket === void 0 ? void 0 : socket.end();
        }
        catch (_a) {
        }
        try {
            socket === null || socket === void 0 ? void 0 : socket.destroy();
        }
        catch (_b) {
        }
        socket = null;
    };
    return { ready, send, close };
}
async function startTrayHostAndConnect(args) {
    var _a, _b, _c;
    const log = (_a = args.log) !== null && _a !== void 0 ? _a : (() => void 0);
    const child = ((_b = args.spawnImpl) !== null && _b !== void 0 ? _b : child_process_1.spawn)(args.trayHostExe, ['--pipe', args.pipeName, '--appData', args.appData, '--parentPid', String(process.pid)], {
        windowsHide: true,
        detached: false,
        stdio: 'ignore',
        shell: false,
    });
    const pipePath = namedPipePathWindows(args.pipeName);
    log(`tray-host: spawned pid=${(_c = child.pid) !== null && _c !== void 0 ? _c : 'n/a'} pipe=${pipePath}`);
    const conn = await connectToTrayHost({
        pipeName: args.pipeName,
        onEvent: args.onEvent,
        log: args.log,
        connectImpl: args.connectImpl,
    });
    return { child, conn };
}
//# sourceMappingURL=tray-host.js.map