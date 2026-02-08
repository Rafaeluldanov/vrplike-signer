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
const events_1 = require("events");
const os = __importStar(require("os"));
const path = __importStar(require("path"));
describe('windows/tray-host', () => {
    const realFs = jest.requireActual('fs');
    const envSnapshot = Object.assign({}, process.env);
    afterEach(() => {
        jest.restoreAllMocks();
        jest.resetModules();
        jest.unmock('fs');
        for (const k of Object.keys(process.env))
            delete process.env[k];
        Object.assign(process.env, envSnapshot);
    });
    test('computeTrayHostPipeName includes user SID when available', async () => {
        const { computeTrayHostPipeName } = await Promise.resolve().then(() => __importStar(require('./tray-host')));
        const sid = 'S-1-5-21-111-222-333-1001';
        const name = computeTrayHostPipeName({ platform: 'win32', sid });
        expect(name).toContain('vrplike-signer-tray-');
        expect(name).toContain(sid);
    });
    test('getUserSidWindows parses whoami /user CSV output', async () => {
        const { getUserSidWindows } = await Promise.resolve().then(() => __importStar(require('./tray-host')));
        const sid = 'S-1-5-21-111-222-333-1001';
        const parsed = getUserSidWindows({
            platform: 'win32',
            run: () => ({
                status: 0,
                stdout: `"DOMAIN\\\\user","${sid}"\r\n`,
                stderr: '',
            }),
        });
        expect(parsed).toBe(sid);
    });
    test('ensureTrayHostBinary extracts exe from pkg asset using readFileSync + writeFileSync', async () => {
        const tmp = await fsTempDir('tray-host-asset');
        const assetPath = path.join(tmp.assetDir, 'tray-host.exe');
        realFs.writeFileSync(assetPath, 'placeholder', 'utf8');
        const buf = Buffer.from('dummy-tray-host-binary');
        jest.doMock('fs', () => {
            const actual = jest.requireActual('fs');
            return Object.assign(Object.assign({}, actual), { copyFileSync: jest.fn((...args) => actual.copyFileSync(...args)), readFileSync: jest.fn(() => buf), writeFileSync: jest.fn((...args) => actual.writeFileSync(...args)) });
        });
        const { ensureTrayHostBinary } = await Promise.resolve().then(() => __importStar(require('./tray-host')));
        const mockedFs = await Promise.resolve().then(() => __importStar(require('fs')));
        const p = await ensureTrayHostBinary({
            platform: 'win32',
            appDataDir: tmp.appData,
            execPath: path.join(tmp.exeDir, 'vrplike-signer.exe'),
            assetPath,
            log: () => void 0,
        });
        const targetPath = path.join(tmp.appData, 'vrplike-signer', 'bin', 'tray-host.exe');
        expect(p).toBe(targetPath);
        expect(mockedFs.readFileSync).toHaveBeenCalledWith(assetPath);
        expect(mockedFs.writeFileSync).toHaveBeenCalledWith(targetPath, buf);
        expect(realFs.existsSync(targetPath)).toBe(true);
        expect(realFs.statSync(targetPath).size).toBeGreaterThan(0);
    });
    test('startTrayHostAndConnect resolves ready on TRAY_READY and forwards menu clicks', async () => {
        const { startTrayHostAndConnect } = await Promise.resolve().then(() => __importStar(require('./tray-host')));
        const events = [];
        const fakeChild = { pid: 123, kill: jest.fn() };
        const socket = new FakeSocket();
        const connectImpl = jest.fn(() => {
            process.nextTick(() => {
                socket.emit('connect');
                socket.emit('data', JSON.stringify({ type: 'TRAY_READY' }) + '\n');
            });
            return socket;
        });
        const spawnImpl = jest.fn(() => fakeChild);
        const r = await startTrayHostAndConnect({
            pipeName: 'vrplike-signer-tray-S-1-5-21-test',
            appData: 'C:\\\\Users\\\\x\\\\AppData\\\\Roaming',
            trayHostExe: 'C:\\\\tmp\\\\tray-host.exe',
            onEvent: (ev) => events.push(ev),
            spawnImpl: spawnImpl,
            connectImpl: connectImpl,
            log: () => void 0,
        });
        await expect(r.conn.ready).resolves.toBeUndefined();
        socket.emit('data', JSON.stringify({ type: 'MENU_CLICK', id: 'RECONNECT' }) + '\n');
        expect(events).toContainEqual({ type: 'MENU_CLICK', id: 'RECONNECT' });
        r.conn.close();
    });
});
class FakeSocket extends events_1.EventEmitter {
    setEncoding() {
    }
    write() {
    }
    end() {
    }
    destroy() {
    }
}
async function fsTempDir(prefix) {
    const root = await (await Promise.resolve().then(() => __importStar(require('fs/promises')))).mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
    const exeDir = path.join(root, 'exe');
    const appData = path.join(root, 'appdata');
    const assetDir = path.join(root, 'assets');
    const { mkdir } = await Promise.resolve().then(() => __importStar(require('fs/promises')));
    await mkdir(exeDir, { recursive: true });
    await mkdir(appData, { recursive: true });
    await mkdir(assetDir, { recursive: true });
    return { root, exeDir, appData, assetDir };
}
//# sourceMappingURL=tray-host.spec.js.map