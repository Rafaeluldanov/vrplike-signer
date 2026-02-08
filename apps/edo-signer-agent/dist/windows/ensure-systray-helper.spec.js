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
const os = __importStar(require("os"));
const path = __importStar(require("path"));
describe('windows/ensure-systray-helper', () => {
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
    test('throws SYSTRAY_HELPER_NOT_FOUND when no helper is available', async () => {
        const tmp = await fsTempDir('systray-helper-missing');
        const { ensureSystrayHelper } = await Promise.resolve().then(() => __importStar(require('./ensure-systray-helper')));
        await expect(ensureSystrayHelper({
            appDataDir: tmp.appData,
            execPath: path.join(tmp.exeDir, 'vrplike-signer.exe'),
            assetPath: path.join(tmp.assetDir, 'systray.exe'),
        })).rejects.toThrow('SYSTRAY_HELPER_NOT_FOUND');
    });
    test('resolves APPDATA fallback via USERPROFILE when APPDATA is empty', async () => {
        const tmp = await fsTempDir('systray-helper-appdata-fallback');
        const userProfile = path.join(tmp.root, 'UserProfile');
        realFs.mkdirSync(userProfile, { recursive: true });
        process.env.APPDATA = '   ';
        process.env.USERPROFILE = userProfile;
        const exeSibling = path.join(tmp.exeDir, 'systray.exe');
        realFs.writeFileSync(exeSibling, 'dummy', 'utf8');
        const { ensureSystrayHelper } = await Promise.resolve().then(() => __importStar(require('./ensure-systray-helper')));
        const p = await ensureSystrayHelper({
            execPath: path.join(tmp.exeDir, 'vrplike-signer.exe'),
            assetPath: path.join(tmp.assetDir, 'systray.exe'),
        });
        const expected = path.join(userProfile, 'AppData', 'Roaming', 'vrplike-signer', 'bin', 'systray.exe');
        expect(p).toBe(expected);
        expect(realFs.existsSync(p)).toBe(true);
    });
    test('ensureDir failure throws with details (appData/targetDir/reason)', async () => {
        var _a, _b, _c, _d, _e;
        const tmp = await fsTempDir('systray-helper-ensure-dir-fail');
        jest.doMock('fs', () => {
            const actual = jest.requireActual('fs');
            return Object.assign(Object.assign({}, actual), { promises: Object.assign(Object.assign({}, actual.promises), { mkdir: jest.fn(async () => {
                        throw new Error('mkdir failed');
                    }) }) });
        });
        const { ensureSystrayHelper } = await Promise.resolve().then(() => __importStar(require('./ensure-systray-helper')));
        try {
            await ensureSystrayHelper({
                appDataDir: tmp.appData,
                execPath: path.join(tmp.exeDir, 'vrplike-signer.exe'),
                assetPath: path.join(tmp.assetDir, 'systray.exe'),
            });
            throw new Error('expected ensureSystrayHelper to throw');
        }
        catch (e) {
            expect(e === null || e === void 0 ? void 0 : e.message).toBe('SYSTRAY_HELPER_NOT_FOUND');
            expect((_a = e === null || e === void 0 ? void 0 : e.details) === null || _a === void 0 ? void 0 : _a.appData).toBe(tmp.appData);
            expect((_b = e === null || e === void 0 ? void 0 : e.details) === null || _b === void 0 ? void 0 : _b.targetDir).toBe(path.join(tmp.appData, 'vrplike-signer', 'bin'));
            expect((_c = e === null || e === void 0 ? void 0 : e.details) === null || _c === void 0 ? void 0 : _c.reason).toBe('ensureDir failed');
            expect(typeof ((_d = e === null || e === void 0 ? void 0 : e.details) === null || _d === void 0 ? void 0 : _d.error)).toBe('string');
            expect(Array.isArray((_e = e === null || e === void 0 ? void 0 : e.details) === null || _e === void 0 ? void 0 : _e.checkedPaths)).toBe(true);
        }
    });
    test('returns path when helper exists next to exe', async () => {
        const tmp = await fsTempDir('systray-helper-exe-sibling');
        const exeSibling = path.join(tmp.exeDir, 'systray.exe');
        realFs.writeFileSync(exeSibling, 'dummy', 'utf8');
        const { ensureSystrayHelper } = await Promise.resolve().then(() => __importStar(require('./ensure-systray-helper')));
        const p = await ensureSystrayHelper({
            appDataDir: tmp.appData,
            execPath: path.join(tmp.exeDir, 'vrplike-signer.exe'),
            assetPath: path.join(tmp.assetDir, 'systray.exe'),
        });
        expect(p).toBe(path.join(tmp.appData, 'vrplike-signer', 'bin', 'systray.exe'));
        expect(realFs.existsSync(p)).toBe(true);
    });
    test('extracts helper from pkg asset using readFileSync + writeFileSync', async () => {
        const tmp = await fsTempDir('systray-helper-pkg-asset');
        const assetPath = path.join(tmp.assetDir, 'systray.exe');
        realFs.writeFileSync(assetPath, 'placeholder', 'utf8');
        const buf = Buffer.from('dummy-systray-binary');
        jest.doMock('fs', () => {
            const actual = jest.requireActual('fs');
            return Object.assign(Object.assign({}, actual), { readFileSync: jest.fn(() => buf), writeFileSync: jest.fn((...args) => actual.writeFileSync(...args)) });
        });
        const { ensureSystrayHelper } = await Promise.resolve().then(() => __importStar(require('./ensure-systray-helper')));
        const mockedFs = await Promise.resolve().then(() => __importStar(require('fs')));
        const p = await ensureSystrayHelper({
            appDataDir: tmp.appData,
            execPath: path.join(tmp.exeDir, 'vrplike-signer.exe'),
            assetPath,
        });
        const targetPath = path.join(tmp.appData, 'vrplike-signer', 'bin', 'systray.exe');
        expect(p).toBe(targetPath);
        expect(mockedFs.readFileSync).toHaveBeenCalledWith(assetPath);
        expect(mockedFs.writeFileSync).toHaveBeenCalledWith(targetPath, buf);
        expect(realFs.existsSync(targetPath)).toBe(true);
        expect(realFs.statSync(targetPath).size).toBeGreaterThan(0);
    });
});
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
//# sourceMappingURL=ensure-systray-helper.spec.js.map