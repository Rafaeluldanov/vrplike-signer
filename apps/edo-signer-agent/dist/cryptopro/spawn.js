"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.spawnWithTimeout = spawnWithTimeout;
const child_process_1 = require("child_process");
const signer_error_1 = require("./signer-error");
function truncateUtf8(buf, maxBytes) {
    if (buf.length <= maxBytes)
        return buf.toString('utf8');
    return buf.subarray(0, maxBytes).toString('utf8') + '\n[...truncated...]';
}
function spawnWithTimeout(cmd, args, timeoutMs) {
    return new Promise((resolve, reject) => {
        var _a, _b;
        const child = (0, child_process_1.spawn)(cmd, args, {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const stdoutChunks = [];
        const stderrChunks = [];
        const onData = (arr, chunk) => {
            const MAX = 64 * 1024;
            if (arr.reduce((n, b) => n + b.length, 0) >= MAX)
                return;
            arr.push(chunk);
        };
        (_a = child.stdout) === null || _a === void 0 ? void 0 : _a.on('data', (c) => onData(stdoutChunks, c));
        (_b = child.stderr) === null || _b === void 0 ? void 0 : _b.on('data', (c) => onData(stderrChunks, c));
        const t = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new signer_error_1.SignerError('TIMEOUT', `CryptoPro tool timeout after ${timeoutMs}ms`));
        }, timeoutMs);
        child.on('error', (err) => {
            var _a;
            clearTimeout(t);
            if ((err === null || err === void 0 ? void 0 : err.code) === 'ENOENT') {
                reject(new signer_error_1.SignerError('CRYPTOPRO_NOT_FOUND', 'CryptoPro CSP не найден. Установите CryptoPro CSP.', {
                    checkedPaths: [cmd],
                }));
                return;
            }
            reject(new signer_error_1.SignerError('SIGN_FAILED', `CryptoPro tool failed to start: ${String((_a = err === null || err === void 0 ? void 0 : err.message) !== null && _a !== void 0 ? _a : err)}`));
        });
        child.on('close', (code, signal) => {
            clearTimeout(t);
            resolve({
                exitCode: code,
                signal,
                stdoutTrunc: truncateUtf8(Buffer.concat(stdoutChunks), 32 * 1024),
                stderrTrunc: truncateUtf8(Buffer.concat(stderrChunks), 32 * 1024),
            });
        });
    });
}
//# sourceMappingURL=spawn.js.map