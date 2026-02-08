"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const ipc_1 = require("./ipc");
function tmpSockPath() {
    const id = crypto_1.default.randomBytes(8).toString('hex');
    return path_1.default.join(os_1.default.tmpdir(), `vrplike-signer-ipc-test-${process.pid}-${id}.sock`);
}
describe('windows/ipc', () => {
    test('server receives DEEPLINK message', async () => {
        const pipePath = tmpSockPath();
        const received = [];
        const server = await (0, ipc_1.startIpcServer)({
            pipePath,
            onMessage: async (m) => {
                received.push(m);
            },
        });
        const r = await (0, ipc_1.trySendIpcMessage)({
            pipePath,
            message: { type: 'DEEPLINK', url: 'vrplike-signer://pair?token=t&wsUrl=wss%3A%2F%2Fx&le=1' },
            timeoutMs: 500,
        });
        expect(r).toEqual({ ok: true });
        await server.close();
        try {
            if (fs_1.default.existsSync(pipePath))
                fs_1.default.unlinkSync(pipePath);
        }
        catch (_a) {
        }
        expect(received).toEqual([{ type: 'DEEPLINK', url: 'vrplike-signer://pair?token=t&wsUrl=wss%3A%2F%2Fx&le=1' }]);
    });
    test('server receives ARGS message', async () => {
        const pipePath = tmpSockPath();
        const received = [];
        const server = await (0, ipc_1.startIpcServer)({
            pipePath,
            onMessage: async (m) => {
                received.push(m);
            },
        });
        const r = await (0, ipc_1.trySendIpcMessage)({
            pipePath,
            message: { type: 'ARGS', argv: ['--wssUrl', 'wss://x'] },
            timeoutMs: 500,
        });
        expect(r).toEqual({ ok: true });
        await server.close();
        try {
            if (fs_1.default.existsSync(pipePath))
                fs_1.default.unlinkSync(pipePath);
        }
        catch (_a) {
        }
        expect(received).toEqual([{ type: 'ARGS', argv: ['--wssUrl', 'wss://x'] }]);
    });
});
//# sourceMappingURL=ipc.spec.js.map