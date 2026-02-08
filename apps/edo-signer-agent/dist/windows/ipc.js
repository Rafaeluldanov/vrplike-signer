"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.vrplikeSignerPipePath = vrplikeSignerPipePath;
exports.trySendIpcMessage = trySendIpcMessage;
exports.startIpcServer = startIpcServer;
const net_1 = __importDefault(require("net"));
const os_1 = __importDefault(require("os"));
function toNonEmptyString(v) {
    return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function vrplikeSignerPipePath() {
    var _a, _b;
    const userRaw = toNonEmptyString(process.env.USERDOMAIN) && toNonEmptyString(process.env.USERNAME)
        ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
        : (_b = (_a = toNonEmptyString(process.env.USERNAME)) !== null && _a !== void 0 ? _a : (() => {
            try {
                return os_1.default.userInfo().username;
            }
            catch (_a) {
                return null;
            }
        })()) !== null && _b !== void 0 ? _b : 'user';
    const safe = String(userRaw)
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '_')
        .slice(0, 48);
    return `\\\\.\\pipe\\vrplike-signer-${safe || 'user'}`;
}
function vrplikeSignerLegacyPipePath() {
    return '\\\\.\\pipe\\vrplike-signer';
}
async function trySendIpcMessage(args) {
    const pipePaths = args.pipePath ? [args.pipePath] : [vrplikeSignerPipePath(), vrplikeSignerLegacyPipePath()];
    const timeoutMs = Number.isFinite(args.timeoutMs) ? Number(args.timeoutMs) : 750;
    const tryOnce = async (pipePath) => await new Promise((resolve) => {
        let done = false;
        const finish = (v) => {
            if (done)
                return;
            done = true;
            resolve(v);
        };
        const socket = net_1.default.connect(pipePath);
        let sawOk = false;
        const t = setTimeout(() => {
            try {
                socket.destroy();
            }
            catch (_a) {
            }
            finish({ ok: false, reason: 'TIMEOUT' });
        }, Math.max(50, timeoutMs));
        socket.on('connect', () => {
            try {
                socket.write(JSON.stringify(args.message) + '\n');
                socket.end();
            }
            catch (_a) {
                clearTimeout(t);
                finish({ ok: false, reason: 'SEND_FAILED' });
            }
        });
        socket.on('data', (buf) => {
            var _a;
            const s = toNonEmptyString((_a = buf === null || buf === void 0 ? void 0 : buf.toString) === null || _a === void 0 ? void 0 : _a.call(buf, 'utf8'));
            if (s && s.toUpperCase().includes('OK')) {
                sawOk = true;
                clearTimeout(t);
                finish({ ok: true });
            }
        });
        socket.on('error', (e) => {
            clearTimeout(t);
            const code = toNonEmptyString(e === null || e === void 0 ? void 0 : e.code);
            if (code === 'ENOENT' || code === 'ECONNREFUSED') {
                finish({ ok: false, reason: 'NO_SERVER' });
                return;
            }
            finish({ ok: false, reason: 'SEND_FAILED' });
        });
        socket.on('close', () => {
            clearTimeout(t);
            if (!done)
                finish(sawOk ? { ok: true } : { ok: false, reason: 'SEND_FAILED' });
        });
    });
    for (const p of pipePaths) {
        const r = await tryOnce(p);
        if (r.ok)
            return r;
        if (r.reason !== 'NO_SERVER')
            return r;
    }
    return { ok: false, reason: 'NO_SERVER' };
}
async function startIpcServer(args) {
    var _a, _b;
    const pipePath = (_a = args.pipePath) !== null && _a !== void 0 ? _a : vrplikeSignerPipePath();
    const log = (_b = args.log) !== null && _b !== void 0 ? _b : (() => void 0);
    const server = net_1.default.createServer((socket) => {
        let buf = '';
        socket.setEncoding('utf8');
        socket.on('data', (chunk) => {
            buf += String(chunk !== null && chunk !== void 0 ? chunk : '');
            if (!buf.includes('\n'))
                return;
            const [line] = buf.split('\n');
            buf = '';
            try {
                const parsed = JSON.parse(line);
                const type = toNonEmptyString(parsed === null || parsed === void 0 ? void 0 : parsed.type);
                if (type === 'DEEPLINK' || type === 'DEEPLINK_PAIR') {
                    const url = toNonEmptyString(parsed === null || parsed === void 0 ? void 0 : parsed.url);
                    if (url)
                        void args.onMessage({ type: 'DEEPLINK', url });
                }
                else if (type === 'ARGS') {
                    const argv = Array.isArray(parsed === null || parsed === void 0 ? void 0 : parsed.argv) ? parsed.argv.filter((x) => typeof x === 'string') : null;
                    if (argv)
                        void args.onMessage({ type: 'ARGS', argv });
                }
                else if (type === 'RECONNECT') {
                    void args.onMessage({ type: 'RECONNECT' });
                }
                else if (type === 'PING') {
                    void args.onMessage({ type: 'PING' });
                }
                else if (type === 'QUIT') {
                    void args.onMessage({ type: 'QUIT' });
                }
            }
            catch (e) {
                log(`ipc: invalid message: ${e instanceof Error ? e.message : String(e)}`);
            }
            finally {
                try {
                    socket.write('OK\n');
                }
                catch (_a) {
                }
                try {
                    socket.end();
                }
                catch (_b) {
                }
            }
        });
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(pipePath, () => resolve());
    });
    return {
        pipePath,
        close: async () => {
            await new Promise((resolve) => server.close(() => resolve()));
        },
    };
}
//# sourceMappingURL=ipc.js.map