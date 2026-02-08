"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureVrplikeSignerAutostartRegisteredWindows = ensureVrplikeSignerAutostartRegisteredWindows;
const child_process_1 = require("child_process");
function toNonEmptyString(v) {
    return typeof v === 'string' && v.trim() ? v.trim() : null;
}
async function runRegExe(args, regExe = 'reg.exe') {
    return await new Promise((resolve) => {
        var _a, _b;
        const child = (0, child_process_1.spawn)(regExe, args, { windowsHide: true });
        let stdout = '';
        let stderr = '';
        (_a = child.stdout) === null || _a === void 0 ? void 0 : _a.on('data', (d) => (stdout += String(d)));
        (_b = child.stderr) === null || _b === void 0 ? void 0 : _b.on('data', (d) => (stderr += String(d)));
        child.on('close', (code) => resolve({ exitCode: typeof code === 'number' ? code : 1, stdout, stderr }));
        child.on('error', (err) => resolve({ exitCode: 1, stdout, stderr: `${stderr}\n${err instanceof Error ? err.message : String(err)}`.trim() }));
    });
}
async function ensureVrplikeSignerAutostartRegisteredWindows(args) {
    var _a, _b, _c, _d, _e;
    const platform = (_a = args === null || args === void 0 ? void 0 : args.platform) !== null && _a !== void 0 ? _a : process.platform;
    if (platform !== 'win32')
        return;
    const exePath = (_b = args === null || args === void 0 ? void 0 : args.exePath) !== null && _b !== void 0 ? _b : process.execPath;
    const log = (_c = args === null || args === void 0 ? void 0 : args.log) !== null && _c !== void 0 ? _c : (() => void 0);
    const runReg = (_d = args === null || args === void 0 ? void 0 : args.runReg) !== null && _d !== void 0 ? _d : ((a) => { var _a; return runRegExe(a, (_a = args === null || args === void 0 ? void 0 : args.regExe) !== null && _a !== void 0 ? _a : 'reg.exe'); });
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
    const name = 'vrplike-signer';
    const desired = `"${exePath}"`;
    try {
        const q = await runReg(['query', key, '/v', name]);
        if (q.exitCode === 0) {
            const current = (_e = toNonEmptyString(q.stdout)) !== null && _e !== void 0 ? _e : '';
            if (current.includes(desired))
                return;
        }
    }
    catch (_f) {
    }
    try {
        await runReg(['add', key, '/v', name, '/t', 'REG_SZ', '/d', desired, '/f']);
        log('Autostart registered');
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`Autostart registration failed: ${msg}`);
    }
}
//# sourceMappingURL=register-autostart.js.map