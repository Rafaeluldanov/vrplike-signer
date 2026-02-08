"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureVrplikeSignerDeeplinkRegisteredWindows = ensureVrplikeSignerDeeplinkRegisteredWindows;
const child_process_1 = require("child_process");
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
async function ensureVrplikeSignerDeeplinkRegisteredWindows(args) {
    var _a, _b, _c, _d, _e;
    const platform = (_a = args === null || args === void 0 ? void 0 : args.platform) !== null && _a !== void 0 ? _a : process.platform;
    if (platform !== 'win32')
        return;
    const protocol = ((_b = args === null || args === void 0 ? void 0 : args.protocol) !== null && _b !== void 0 ? _b : 'vrplike-signer').trim();
    if (!protocol)
        return;
    const log = (_c = args === null || args === void 0 ? void 0 : args.log) !== null && _c !== void 0 ? _c : ((line) => console.log(line));
    const baseKey = `HKCU\\Software\\Classes\\${protocol}`;
    const commandKey = `${baseKey}\\shell\\open\\command`;
    const runReg = (_d = args === null || args === void 0 ? void 0 : args.runReg) !== null && _d !== void 0 ? _d : ((a) => { var _a; return runRegExe(a, (_a = args === null || args === void 0 ? void 0 : args.regExe) !== null && _a !== void 0 ? _a : 'reg.exe'); });
    try {
        const query = await runReg(['query', commandKey]);
        if (query.exitCode === 0)
            return;
        const exePath = (_e = args === null || args === void 0 ? void 0 : args.exePath) !== null && _e !== void 0 ? _e : process.execPath;
        const command = `"${exePath}" "%1"`;
        await runReg(['add', baseKey, '/ve', '/t', 'REG_SZ', '/d', 'URL:vrplike signer', '/f']);
        await runReg(['add', baseKey, '/v', 'URL Protocol', '/t', 'REG_SZ', '/d', '', '/f']);
        await runReg(['add', commandKey, '/ve', '/t', 'REG_SZ', '/d', command, '/f']);
        log('Deep link protocol registered');
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`Deep link protocol registration failed: ${msg}`);
    }
}
//# sourceMappingURL=register-deeplink.js.map