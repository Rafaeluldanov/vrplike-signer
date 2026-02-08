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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWindowsTray = createWindowsTray;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const path = __importStar(require("path"));
const tray_host_1 = require("./tray-host");
function safeMkdir(dir) {
    try {
        (0, fs_1.mkdirSync)(dir, { recursive: true });
    }
    catch (_a) {
    }
}
function tryOpenFolderInExplorer(dir) {
    try {
        const child = (0, child_process_1.spawn)('explorer.exe', [dir], { windowsHide: true, stdio: 'ignore', detached: true });
        child.unref();
    }
    catch (_a) {
    }
}
async function createWindowsTray(args) {
    var _a, _b;
    const log = (_a = args.log) !== null && _a !== void 0 ? _a : (() => void 0);
    const debug = Boolean(args.debug);
    const consoleMode = Boolean(args.consoleMode);
    const mode = (_b = args.mode) !== null && _b !== void 0 ? _b : 'portable';
    log('tray: starting');
    if (process.platform !== 'win32') {
        return {
            ready: Promise.resolve(),
            setState: () => void 0,
            setStatusText: () => void 0,
            kill: () => void 0,
        };
    }
    safeMkdir(path.join(args.baseDir, 'traybin'));
    const appData = (0, tray_host_1.resolveWindowsAppDataFallback)();
    const pipeName = (0, tray_host_1.computeTrayHostPipeName)({ platform: 'win32' });
    let lastState = 'reconnecting';
    let lastStatusText = '';
    const toTooltip = (state, details) => {
        const base = state === 'connected' ? 'vrplike Signer — подключён' : state === 'error' ? 'vrplike Signer — ошибка' : 'vrplike Signer — переподключение';
        const withError = state === 'error' && (details === null || details === void 0 ? void 0 : details.errorMessage) ? `${base}: ${details.errorMessage}` : base;
        return lastStatusText ? `${withError} (${lastStatusText})` : withError;
    };
    const toHostStatus = (s) => (s === 'connected' ? 'CONNECTED' : s === 'error' ? 'ERROR' : 'RECONNECTING');
    const onEvent = (ev) => {
        try {
            if (ev.type === 'TRAY_READY')
                return;
            if (ev.type === 'MENU_CLICK') {
                if (ev.id === 'RECONNECT') {
                    args.onReconnect();
                    return;
                }
                if (ev.id === 'OPEN_LOGS') {
                    tryOpenFolderInExplorer(args.logsDir);
                    return;
                }
                if (ev.id === 'QUIT') {
                    args.onQuit();
                    return;
                }
            }
        }
        catch (e) {
            log(`tray: event handler failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    };
    const spawnedChild = mode === 'portable' ? { kill: () => void 0 } : null;
    const conn = mode === 'installed'
        ? await (async () => {
            try {
                return await (0, tray_host_1.connectToTrayHost)({
                    pipeName,
                    onEvent,
                    log: (l) => log(l),
                });
            }
            catch (e) {
                const exe = path.join(path.dirname(process.execPath), 'vrplike-signer-tray.exe');
                log(`tray: connect failed; trying to start installed tray-host: ${exe}`);
                try {
                    const child = (0, child_process_1.spawn)(exe, ['--pipe', pipeName, '--appData', appData], {
                        windowsHide: true,
                        detached: false,
                        stdio: 'ignore',
                        shell: false,
                    });
                    void child;
                }
                catch (_a) {
                }
                return await (0, tray_host_1.connectToTrayHost)({
                    pipeName,
                    onEvent,
                    log: (l) => log(l),
                });
            }
        })()
        : await (async () => {
            const trayHostExe = await (0, tray_host_1.ensureTrayHostBinary)({ log: (l) => log(`tray: ${l}`) });
            const { child, conn } = await (0, tray_host_1.startTrayHostAndConnect)({
                pipeName,
                appData,
                trayHostExe,
                onEvent,
                log: (l) => log(l),
            });
            if (spawnedChild)
                spawnedChild.kill = () => child.kill();
            return conn;
        })().catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            log(`tray: error ${msg}`);
            if (consoleMode || debug) {
                console.error('tray: error details', err === null || err === void 0 ? void 0 : err.details);
            }
            throw err;
        });
    const ready = conn.ready
        .then(() => {
        log('tray: started');
        conn.send({ type: 'SET_STATUS', status: 'RECONNECTING', tooltip: 'vrplike Signer — переподключение' });
    })
        .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log(`tray: ready failed ${msg}`);
        throw err;
    });
    const apply = (state, details) => {
        lastState = state;
        const tooltip = toTooltip(state, details);
        try {
            conn.send({ type: 'SET_STATUS', status: toHostStatus(state), tooltip });
        }
        catch (e) {
            log(`tray update failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    };
    return {
        ready,
        setState: (state, details) => apply(state, details),
        setStatusText: (text) => {
            lastStatusText = String(text !== null && text !== void 0 ? text : '').trim();
            apply(lastState);
        },
        kill: () => {
            try {
                conn.close();
            }
            catch (_a) {
            }
            if (mode === 'portable') {
                try {
                    conn.send({ type: 'EXIT' });
                }
                catch (_b) {
                }
                try {
                    spawnedChild === null || spawnedChild === void 0 ? void 0 : spawnedChild.kill();
                }
                catch (_c) {
                }
            }
        },
    };
}
//# sourceMappingURL=tray.js.map