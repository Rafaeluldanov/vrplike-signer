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
exports.resolveCryptoProTool = resolveCryptoProTool;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const path = __importStar(require("path"));
const signer_error_1 = require("./signer-error");
async function spawnCapture(cmd, args) {
    return await new Promise((resolve) => {
        var _a, _b;
        const child = (0, child_process_1.spawn)(cmd, args, {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        (_a = child.stdout) === null || _a === void 0 ? void 0 : _a.on('data', (d) => (stdout += String(d)));
        (_b = child.stderr) === null || _b === void 0 ? void 0 : _b.on('data', (d) => (stderr += String(d)));
        child.on('close', (code) => resolve({ exitCode: typeof code === 'number' ? code : 1, stdout, stderr }));
        child.on('error', (err) => resolve({
            exitCode: 1,
            stdout,
            stderr: `${stderr}\n${err instanceof Error ? err.message : String(err)}`.trim(),
        }));
    });
}
function otherTool(t) {
    return t === 'cryptcp' ? 'csptest' : 'cryptcp';
}
function normalizeEnvPath(v) {
    const s = typeof v === 'string' ? v.trim() : '';
    return s ? s : null;
}
function standardPathsInStrictOrder() {
    return [
        { tool: 'cryptcp', path: 'C:\\Program Files\\Crypto Pro\\CSP\\cryptcp.exe' },
        { tool: 'cryptcp', path: 'C:\\Program Files (x86)\\Crypto Pro\\CSP\\cryptcp.exe' },
        { tool: 'csptest', path: 'C:\\Program Files\\Crypto Pro\\CSP\\csptest.exe' },
        { tool: 'csptest', path: 'C:\\Program Files (x86)\\Crypto Pro\\CSP\\csptest.exe' },
    ];
}
async function resolveViaWhere(tool) {
    var _a, _b;
    const checked = [`where ${tool}`];
    const res = await spawnCapture('where', [tool]);
    const out = ((_a = res.stdout) !== null && _a !== void 0 ? _a : '').replace(/\r/g, '');
    const lines = out
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    for (const l of lines)
        checked.push(l);
    const firstExisting = (_b = lines.find((p) => (0, fs_1.existsSync)(p))) !== null && _b !== void 0 ? _b : null;
    return { foundPath: firstExisting, checked };
}
async function resolveCryptoProTool(opts) {
    var _a, _b, _c, _d;
    const preferredTool = (_a = opts === null || opts === void 0 ? void 0 : opts.preferredTool) !== null && _a !== void 0 ? _a : 'cryptcp';
    if (process.platform !== 'win32') {
        return { tool: preferredTool, path: preferredTool, source: 'PATH' };
    }
    const envCryptcpPath = normalizeEnvPath((_b = opts === null || opts === void 0 ? void 0 : opts.envCryptcpPath) !== null && _b !== void 0 ? _b : process.env.CRYPTCP_PATH);
    const envCsptestPath = normalizeEnvPath((_c = opts === null || opts === void 0 ? void 0 : opts.envCsptestPath) !== null && _c !== void 0 ? _c : process.env.CSPTEST_PATH);
    const cryptoProHome = normalizeEnvPath((_d = opts === null || opts === void 0 ? void 0 : opts.cryptoProHome) !== null && _d !== void 0 ? _d : process.env.CRYPTOPRO_HOME);
    const checkedPaths = [];
    const tools = [preferredTool, otherTool(preferredTool)];
    for (const tool of tools) {
        const envPath = tool === 'cryptcp' ? envCryptcpPath : envCsptestPath;
        if (envPath) {
            checkedPaths.push(envPath);
            if ((0, fs_1.existsSync)(envPath))
                return { tool, path: envPath, source: 'ENV' };
        }
        if (cryptoProHome) {
            const exe = tool === 'cryptcp' ? 'cryptcp.exe' : 'csptest.exe';
            const p = path.join(cryptoProHome, exe);
            checkedPaths.push(p);
            if ((0, fs_1.existsSync)(p))
                return { tool, path: p, source: 'ENV' };
        }
        const where = await resolveViaWhere(tool);
        checkedPaths.push(...where.checked);
        if (where.foundPath)
            return { tool, path: where.foundPath, source: 'PATH' };
    }
    for (const p of standardPathsInStrictOrder()) {
        checkedPaths.push(p.path);
        if ((0, fs_1.existsSync)(p.path))
            return { tool: p.tool, path: p.path, source: 'STANDARD_PATH' };
    }
    throw new signer_error_1.SignerError('CRYPTOPRO_NOT_FOUND', 'CryptoPro CSP не найден. Установите CryptoPro CSP.', {
        checkedPaths,
    });
}
//# sourceMappingURL=cryptopro-tool-resolver.js.map