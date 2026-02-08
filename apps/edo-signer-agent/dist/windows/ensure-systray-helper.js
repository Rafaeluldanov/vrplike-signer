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
exports.ensureSystrayHelper = ensureSystrayHelper;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
function helperError(code, details) {
    const err = new Error(code);
    err.code = code;
    if (details)
        err.details = details;
    return err;
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
async function fileSize(p) {
    try {
        const st = await fs.promises.stat(p);
        if (!st.isFile())
            return null;
        return st.size;
    }
    catch (_a) {
        return null;
    }
}
async function ensureDir(p) {
    await fs.promises.mkdir(p, { recursive: true });
}
async function ensureSystrayHelper(opts) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const checkedPaths = [];
    const userProfile = String((_a = process.env.USERPROFILE) !== null && _a !== void 0 ? _a : '').trim() || null;
    const homeDrive = String((_b = process.env.HOMEDRIVE) !== null && _b !== void 0 ? _b : '').trim() || null;
    const homePath = String((_c = process.env.HOMEPATH) !== null && _c !== void 0 ? _c : '').trim() || null;
    let appData = String((_e = (_d = opts === null || opts === void 0 ? void 0 : opts.appDataDir) !== null && _d !== void 0 ? _d : process.env.APPDATA) !== null && _e !== void 0 ? _e : '').trim() || '';
    if (!appData) {
        if (userProfile)
            appData = path.join(userProfile, 'AppData', 'Roaming');
        else
            appData = path.join(os.homedir(), 'AppData', 'Roaming');
    }
    const targetDir = path.join(appData, 'vrplike-signer', 'bin');
    const targetPath = path.join(targetDir, 'systray.exe');
    const execPath = (_f = opts === null || opts === void 0 ? void 0 : opts.execPath) !== null && _f !== void 0 ? _f : process.execPath;
    const exeSibling = path.join(path.dirname(execPath), 'systray.exe');
    checkedPaths.push(path.normalize(exeSibling));
    const log = (_g = opts === null || opts === void 0 ? void 0 : opts.log) !== null && _g !== void 0 ? _g : console.log;
    const existingSize = await fileSize(targetPath);
    if (existingSize != null && existingSize > 0) {
        const source = (await pathExists(exeSibling)) ? 'EXE_DIR' : 'PKG_ASSET';
        log(`systray helper ready: ${targetPath} size=${existingSize} source=${source}`);
        return targetPath;
    }
    const snapshotAsset = (_h = opts === null || opts === void 0 ? void 0 : opts.assetPath) !== null && _h !== void 0 ? _h : path.resolve(__dirname, '../../assets/systray/windows/systray.exe');
    checkedPaths.push(path.normalize(snapshotAsset));
    checkedPaths.push(path.normalize(targetPath));
    try {
        await ensureDir(targetDir);
    }
    catch (e) {
        throw helperError('SYSTRAY_HELPER_NOT_FOUND', {
            checkedPaths,
            appData,
            userProfile,
            homeDrive,
            homePath,
            targetDir,
            reason: 'ensureDir failed',
            error: e instanceof Error ? e.message : String(e),
        });
    }
    if (await pathExists(exeSibling)) {
        try {
            fs.copyFileSync(exeSibling, targetPath);
        }
        catch (e) {
            throw helperError('SYSTRAY_HELPER_NOT_FOUND', {
                checkedPaths,
                appData,
                userProfile,
                homeDrive,
                homePath,
                targetDir,
                reason: 'copy EXE_DIR failed',
                error: e instanceof Error ? e.message : String(e),
            });
        }
        let size;
        try {
            size = fs.statSync(targetPath).size;
        }
        catch (e) {
            throw helperError('SYSTRAY_HELPER_NOT_FOUND', {
                checkedPaths,
                appData,
                userProfile,
                homeDrive,
                homePath,
                targetDir,
                reason: 'stat copied helper failed',
                error: e instanceof Error ? e.message : String(e),
            });
        }
        if (size > 0) {
            log(`systray helper ready: ${targetPath} size=${size} source=EXE_DIR`);
            return targetPath;
        }
        throw helperError('SYSTRAY_HELPER_NOT_FOUND', {
            checkedPaths,
            appData,
            userProfile,
            homeDrive,
            homePath,
            targetDir,
            reason: 'copied EXE_DIR but helper is empty',
            error: `size=${size}`,
        });
    }
    let wroteAsset = false;
    try {
        const buf = fs.readFileSync(snapshotAsset);
        fs.writeFileSync(targetPath, buf);
        wroteAsset = true;
    }
    catch (e) {
        throw helperError('SYSTRAY_HELPER_NOT_FOUND', {
            checkedPaths,
            appData,
            userProfile,
            homeDrive,
            homePath,
            targetDir,
            reason: 'read/write asset failed',
            error: e instanceof Error ? e.message : String(e),
        });
    }
    if (!wroteAsset) {
        throw helperError('SYSTRAY_HELPER_NOT_FOUND', {
            checkedPaths,
            appData,
            userProfile,
            homeDrive,
            homePath,
            targetDir,
            reason: 'read/write asset failed',
            error: 'unknown',
        });
    }
    let size;
    try {
        size = fs.statSync(targetPath).size;
    }
    catch (e) {
        throw helperError('SYSTRAY_HELPER_NOT_FOUND', {
            checkedPaths,
            appData,
            userProfile,
            homeDrive,
            homePath,
            targetDir,
            reason: 'stat extracted helper failed',
            error: e instanceof Error ? e.message : String(e),
        });
    }
    if (size > 0) {
        log(`systray helper ready: ${targetPath} size=${size} source=PKG_ASSET`);
        return targetPath;
    }
    throw helperError('SYSTRAY_HELPER_NOT_FOUND', {
        checkedPaths,
        appData,
        userProfile,
        homeDrive,
        homePath,
        targetDir,
        reason: 'asset extracted but helper is empty',
        error: `size=${size}`,
    });
}
//# sourceMappingURL=ensure-systray-helper.js.map