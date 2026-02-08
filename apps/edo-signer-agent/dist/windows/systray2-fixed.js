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
const child = __importStar(require("child_process"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const readline = __importStar(require("readline"));
const ensure_systray_helper_1 = require("./ensure-systray-helper");
function systrayError(code, details) {
    const err = new Error(code);
    err.code = code;
    if (details)
        err.details = details;
    return err;
}
function debugLog(msgType, ...msg) {
    console.log(`${msgType}:${msg
        .map((m) => {
        let t = typeof m === 'string' ? m : JSON.stringify(m);
        const p = t.indexOf('"icon":');
        if (p >= 0) {
            const e = t.indexOf('"', p + 8);
            t = t.substring(0, p + 8) + '<ICON>' + t.substring(e);
        }
        const limit = 500;
        if (t.length > limit)
            t = t.substring(0, limit / 2) + '...' + t.substring(t.length - limit / 2);
        return t;
    })
        .join(' ')}`);
}
async function pathExists(p) {
    try {
        await fs.promises.access(p);
        return true;
    }
    catch (_a) {
        return false;
    }
}
async function ensureDir(p) {
    await fs.promises.mkdir(p, { recursive: true });
}
async function copyFile(src, dest) {
    await fs.promises.copyFile(src, dest);
}
function tryGetSystray2Version() {
    try {
        const pkg = require('systray2/package.json');
        return typeof (pkg === null || pkg === void 0 ? void 0 : pkg.version) === 'string' && pkg.version.trim() ? pkg.version.trim() : null;
    }
    catch (_a) {
        return null;
    }
}
function resolveSystrayModuleDir(pkgName) {
    try {
        const main = require.resolve(pkgName);
        return path.dirname(main);
    }
    catch (_a) {
        return null;
    }
}
async function getTrayBinPath(debug = false, copyDir = false) {
    var _a, _b;
    let binName;
    switch (process.platform) {
        case 'win32':
            binName = `tray_windows${debug ? '' : '_release'}.exe`;
            break;
        case 'darwin':
            binName = `tray_darwin${debug ? '' : '_release'}`;
            break;
        case 'linux':
            binName = `tray_linux${debug ? '' : '_release'}`;
            break;
        default:
            throw new Error(`SYSTRAY_UNSUPPORTED_PLATFORM (${process.platform})`);
    }
    let binPath = path.join('.', 'traybin', binName);
    if (!(await pathExists(binPath))) {
        const systray2Dir = (_a = resolveSystrayModuleDir('systray2')) !== null && _a !== void 0 ? _a : resolveSystrayModuleDir('systray-portable');
        if (!systray2Dir) {
            throw new Error(`SYSTRAY2_TRAYBIN_NOT_FOUND (${binName})`);
        }
        binPath = path.join(systray2Dir, 'traybin', binName);
    }
    if (!copyDir)
        return binPath;
    const version = (_b = tryGetSystray2Version()) !== null && _b !== void 0 ? _b : 'unknown';
    const targetDir = typeof copyDir === 'string' && copyDir.trim()
        ? copyDir.trim()
        : path.join(os.homedir(), '.cache', 'node-systray', version);
    const copyDistPath = path.join(targetDir, binName);
    try {
        await fs.promises.stat(copyDistPath);
        return copyDistPath;
    }
    catch (_c) {
        await ensureDir(targetDir);
        await copyFile(binPath, copyDistPath);
        return copyDistPath;
    }
}
const CHECK_STR = ' (√)';
function updateCheckedInLinux(item) {
    if (process.platform !== 'linux')
        return;
    if (item.checked)
        item.title += CHECK_STR;
    else
        item.title = (item.title || '').replace(RegExp(CHECK_STR + '$'), '');
    if (item.items != null)
        item.items.forEach(updateCheckedInLinux);
}
async function loadIcon(fileName) {
    const buffer = await fs.promises.readFile(fileName);
    return buffer.toString('base64');
}
async function resolveIconForItem(item) {
    const icon = item.icon;
    if (icon != null && (await pathExists(icon))) {
        item.icon = await loadIcon(icon);
    }
    if (item.items != null) {
        await Promise.all(item.items.map((_) => resolveIconForItem(_)));
    }
    return item;
}
async function resolveIconForMenu(menu) {
    const icon = menu.icon;
    if (icon != null && (await pathExists(icon))) {
        menu.icon = await loadIcon(icon);
    }
    await Promise.all(menu.items.map((_) => resolveIconForItem(_)));
    return menu;
}
function addInternalId(internalIdMap, item, counter = { id: 1 }) {
    const id = counter.id++;
    internalIdMap.set(id, item);
    if (item.items != null)
        item.items.forEach((_) => addInternalId(internalIdMap, _, counter));
    item.__id = id;
}
function itemTrimmer(item) {
    return {
        title: item.title,
        tooltip: item.tooltip,
        checked: item.checked,
        enabled: item.enabled === undefined ? true : item.enabled,
        hidden: item.hidden,
        items: item.items,
        icon: item.icon,
        isTemplateIcon: item.isTemplateIcon,
        __id: item.__id,
    };
}
function menuTrimmer(menu) {
    return {
        icon: menu.icon,
        title: menu.title,
        tooltip: menu.tooltip,
        items: menu.items.map(itemTrimmer),
        isTemplateIcon: menu.isTemplateIcon,
    };
}
function actionTrimmer(action) {
    if (action.type === 'update-item') {
        return { type: action.type, item: itemTrimmer(action.item), seq_id: action.seq_id };
    }
    if (action.type === 'update-menu') {
        return { type: action.type, menu: menuTrimmer(action.menu) };
    }
    if (action.type === 'update-menu-and-item') {
        return { type: action.type, item: itemTrimmer(action.item), menu: menuTrimmer(action.menu), seq_id: action.seq_id };
    }
    return { type: action.type };
}
class SysTray {
    constructor(conf) {
        this.internalIdMap = new Map();
        this._process = null;
        this._rl = null;
        this._binPath = null;
        this._binPathReadyResolve = null;
        this._binPathReadyReject = null;
        this._conf = conf;
        this._binPathReady = new Promise((resolve, reject) => {
            this._binPathReadyResolve = resolve;
            this._binPathReadyReject = reject;
        });
        this._ready = this.init();
    }
    get process() {
        return this._process;
    }
    get killed() {
        var _a;
        return Boolean((_a = this._process) === null || _a === void 0 ? void 0 : _a.killed);
    }
    get binPath() {
        return this._binPath;
    }
    binPathReady() {
        return this._binPathReady;
    }
    async init() {
        var _a, _b, _c, _d, _e;
        const conf = this._conf;
        let binPath;
        if (process.platform === 'win32') {
            try {
                binPath = await (0, ensure_systray_helper_1.ensureSystrayHelper)();
            }
            catch (err) {
                (_a = this._binPathReadyReject) === null || _a === void 0 ? void 0 : _a.call(this, err);
                this._binPathReadyResolve = null;
                this._binPathReadyReject = null;
                const details = err && typeof err === 'object' && 'details' in err && err.details && typeof err.details === 'object'
                    ? err.details
                    : {};
                const originalCode = err && typeof err === 'object' && 'code' in err ? String((_b = err.code) !== null && _b !== void 0 ? _b : '') : '';
                const originalMessage = err instanceof Error ? err.message : String(err);
                throw systrayError('SYSTRAY_HELPER_NOT_FOUND', Object.assign(Object.assign({}, details), { binPathAttempted: true, originalCode,
                    originalMessage }));
            }
            this._binPath = binPath;
            (_c = this._binPathReadyResolve) === null || _c === void 0 ? void 0 : _c.call(this, binPath);
            this._binPathReadyResolve = null;
            this._binPathReadyReject = null;
            if (!(await pathExists(binPath))) {
                throw systrayError('SYSTRAY_HELPER_NOT_FOUND', { binPath, reason: 'binPath does not exist after ensureSystrayHelper()' });
            }
        }
        else {
            try {
                binPath = await getTrayBinPath(Boolean(conf.debug), conf.copyDir);
            }
            catch (err) {
                (_d = this._binPathReadyReject) === null || _d === void 0 ? void 0 : _d.call(this, err);
                this._binPathReadyResolve = null;
                this._binPathReadyReject = null;
                throw err;
            }
            this._binPath = binPath;
            (_e = this._binPathReadyResolve) === null || _e === void 0 ? void 0 : _e.call(this, binPath);
            this._binPathReadyResolve = null;
            this._binPathReadyReject = null;
        }
        return await new Promise(async (resolve, reject) => {
            try {
                const spawnStrict = (stdio) => child.spawn(binPath, [], {
                    windowsHide: true,
                    shell: false,
                    detached: false,
                    stdio,
                    windowsVerbatimArguments: true,
                });
                const mkDebug = (proc) => ({
                    binPath,
                    pid: proc.pid,
                    hasStdin: !!proc.stdin,
                    hasStdout: !!proc.stdout,
                    hasStderr: !!proc.stderr,
                    keys: Object.keys(proc),
                });
                let proc = spawnStrict(['pipe', 'pipe', 'pipe']);
                console.error('SYSTRAY_SPAWN_DEBUG', mkDebug(proc));
                if (!proc.stdin) {
                    const debug1 = mkDebug(proc);
                    try {
                        proc.kill();
                    }
                    catch (_a) {
                    }
                    proc = spawnStrict('pipe');
                    console.error('SYSTRAY_SPAWN_DEBUG', mkDebug(proc));
                    if (!proc.stdin) {
                        const debug2 = mkDebug(proc);
                        console.error('SYSTRAY_SPAWN_NO_STDIN', { binPath, debug1, debug2 });
                        reject(systrayError('SYSTRAY_SPAWN_NO_STDIN', {
                            binPath,
                            tried: ['spawnFile pipes', 'spawnFile pipe-string'],
                            debug: { debug1, debug2 },
                        }));
                        return;
                    }
                }
                this._process = proc;
                this._process.on('error', reject);
                if (!this._process.stdout) {
                    reject(new Error('SYSTRAY_SPAWN_NO_STDOUT'));
                    return;
                }
                this._rl = readline.createInterface({ input: this._process.stdout });
                conf.menu.items.forEach(updateCheckedInLinux);
                const counter = { id: 1 };
                conf.menu.items.forEach((_) => addInternalId(this.internalIdMap, _, counter));
                await resolveIconForMenu(conf.menu);
                if (conf.debug) {
                    this._rl.on('line', (data) => debugLog('onLine', data));
                }
                this.onReady(() => {
                    this.writeLine(JSON.stringify(menuTrimmer(conf.menu)));
                    resolve();
                });
            }
            catch (e) {
                reject(e);
            }
        });
    }
    ready() {
        return this._ready;
    }
    onReady(listener) {
        if (!this._rl)
            return this;
        this._rl.on('line', (line) => {
            const action = JSON.parse(line);
            if (action.type === 'ready') {
                listener();
                if (this._conf.debug)
                    debugLog('onReady', action);
            }
        });
        return this;
    }
    async onClick(listener) {
        await this.ready();
        if (!this._rl)
            return this;
        this._rl.on('line', (line) => {
            const action = JSON.parse(line);
            if (action.type === 'clicked') {
                const item = this.internalIdMap.get(action.__id);
                if (item) {
                    action.item = Object.assign(item, action.item);
                }
                if (this._conf.debug)
                    debugLog('onClick', action);
                listener(action);
            }
        });
        return this;
    }
    writeLine(line) {
        var _a, _b;
        if (line) {
            if (this._conf.debug)
                debugLog('writeLine', line + '\n', '=====');
            if (!((_a = this._process) === null || _a === void 0 ? void 0 : _a.stdin)) {
                throw systrayError('SYSTRAY_SPAWN_NO_STDIN', { binPath: (_b = this._binPath) !== null && _b !== void 0 ? _b : '<unknown>' });
            }
            this._process.stdin.write(line.trim() + '\n');
        }
        return this;
    }
    async sendAction(action) {
        if (action.type === 'update-item') {
            updateCheckedInLinux(action.item);
            if (action.seq_id == null)
                action.seq_id = -1;
        }
        else if (action.type === 'update-menu' || action.type === 'update-menu-and-item') {
            await resolveIconForMenu(action.menu);
            action.menu.items.forEach(updateCheckedInLinux);
            if (action.type === 'update-menu-and-item') {
                updateCheckedInLinux(action.item);
                if (action.seq_id == null)
                    action.seq_id = -1;
            }
        }
        if (this._conf.debug)
            debugLog('sendAction', action);
        this.writeLine(JSON.stringify(actionTrimmer(action)));
        return this;
    }
    onExit(listener) {
        var _a;
        (_a = this._process) === null || _a === void 0 ? void 0 : _a.on('exit', listener);
    }
    onError(listener) {
        var _a;
        (_a = this._process) === null || _a === void 0 ? void 0 : _a.on('error', (err) => {
            if (this._conf.debug)
                debugLog('onError', err, 'binPath', this.binPath);
            listener(err);
        });
    }
    async kill(exitNode = true) {
        await new Promise(async (resolve, reject) => {
            try {
                this.onExit(() => {
                    resolve();
                    if (exitNode)
                        process.exit(0);
                });
                await this.sendAction({ type: 'exit' });
            }
            catch (e) {
                reject(e);
            }
        });
    }
}
SysTray.separator = {
    title: '<SEPARATOR>',
    tooltip: '',
    enabled: true,
    checked: false,
};
exports.default = SysTray;
//# sourceMappingURL=systray2-fixed.js.map