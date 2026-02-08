"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = require("events");
const stream_1 = require("stream");
const signer_error_1 = require("./signer-error");
const cryptopro_tool_resolver_1 = require("./cryptopro-tool-resolver");
jest.mock('fs', () => ({
    existsSync: jest.fn(),
}));
jest.mock('child_process', () => ({
    spawn: jest.fn(),
}));
const fs_1 = require("fs");
const child_process_1 = require("child_process");
function mockSpawnResult(args) {
    const proc = new events_1.EventEmitter();
    proc.stdout = new stream_1.PassThrough();
    proc.stderr = new stream_1.PassThrough();
    process.nextTick(() => {
        var _a;
        if (args.error) {
            const err = new Error((_a = args.error.message) !== null && _a !== void 0 ? _a : 'spawn error');
            if (args.error.code)
                err.code = args.error.code;
            proc.emit('error', err);
            return;
        }
        if (args.stdout)
            proc.stdout.write(args.stdout);
        if (args.stderr)
            proc.stderr.write(args.stderr);
        proc.stdout.end();
        proc.stderr.end();
        proc.emit('close', typeof args.exitCode === 'number' ? args.exitCode : 0);
    });
    return proc;
}
describe('cryptopro-tool-resolver (Windows)', () => {
    const origPlatform = process.platform;
    beforeAll(() => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
    });
    afterAll(() => {
        Object.defineProperty(process, 'platform', { value: origPlatform });
    });
    beforeEach(() => {
        fs_1.existsSync.mockReset();
        child_process_1.spawn.mockReset();
    });
    test('ENV → ENV', async () => {
        fs_1.existsSync.mockImplementation((p) => p === 'C:\\Tools\\cryptcp.exe');
        const res = await (0, cryptopro_tool_resolver_1.resolveCryptoProTool)({
            preferredTool: 'cryptcp',
            envCryptcpPath: 'C:\\Tools\\cryptcp.exe',
            envCsptestPath: null,
            cryptoProHome: null,
        });
        expect(res).toEqual({ tool: 'cryptcp', path: 'C:\\Tools\\cryptcp.exe', source: 'ENV' });
        expect(child_process_1.spawn).not.toHaveBeenCalled();
    });
    test('PATH (where) → PATH', async () => {
        fs_1.existsSync.mockImplementation((p) => p === 'C:\\Crypto Pro\\CSP\\cryptcp.exe');
        child_process_1.spawn.mockImplementation((_cmd, args) => {
            expect(args).toEqual(['cryptcp']);
            return mockSpawnResult({ stdout: 'C:\\Crypto Pro\\CSP\\cryptcp.exe\r\n', exitCode: 0 });
        });
        const res = await (0, cryptopro_tool_resolver_1.resolveCryptoProTool)({
            preferredTool: 'cryptcp',
            envCryptcpPath: null,
            envCsptestPath: null,
            cryptoProHome: null,
        });
        expect(res.tool).toBe('cryptcp');
        expect(res.path).toBe('C:\\Crypto Pro\\CSP\\cryptcp.exe');
        expect(res.source).toBe('PATH');
    });
    test('standard path → STANDARD_PATH', async () => {
        const standard = 'C:\\Program Files\\Crypto Pro\\CSP\\cryptcp.exe';
        fs_1.existsSync.mockImplementation((p) => p === standard);
        child_process_1.spawn.mockImplementation((_cmd, args) => {
            expect(args).toEqual([expect.stringMatching(/^(cryptcp|csptest)$/)]);
            return mockSpawnResult({ stdout: '', exitCode: 1 });
        });
        const res = await (0, cryptopro_tool_resolver_1.resolveCryptoProTool)({
            preferredTool: 'cryptcp',
            envCryptcpPath: null,
            envCsptestPath: null,
            cryptoProHome: null,
        });
        expect(res).toEqual({ tool: 'cryptcp', path: standard, source: 'STANDARD_PATH' });
    });
    test('nothing found → CRYPTOPRO_NOT_FOUND', async () => {
        fs_1.existsSync.mockReturnValue(false);
        child_process_1.spawn.mockImplementation((_cmd, _args) => mockSpawnResult({ stdout: '', exitCode: 1 }));
        try {
            await (0, cryptopro_tool_resolver_1.resolveCryptoProTool)({
                preferredTool: 'cryptcp',
                envCryptcpPath: null,
                envCsptestPath: null,
                cryptoProHome: null,
            });
            throw new Error('expected to throw');
        }
        catch (e) {
            expect(e).toBeInstanceOf(signer_error_1.SignerError);
            expect(e.code).toBe('CRYPTOPRO_NOT_FOUND');
            expect(e.message).toBe('CryptoPro CSP не найден. Установите CryptoPro CSP.');
            expect(e.details).toBeTruthy();
            const checked = e.details.checkedPaths;
            expect(Array.isArray(checked)).toBe(true);
            expect(checked).toEqual(expect.arrayContaining(['where cryptcp', 'where csptest']));
            expect(checked).toEqual(expect.arrayContaining([
                'C:\\Program Files\\Crypto Pro\\CSP\\cryptcp.exe',
                'C:\\Program Files (x86)\\Crypto Pro\\CSP\\cryptcp.exe',
                'C:\\Program Files\\Crypto Pro\\CSP\\csptest.exe',
                'C:\\Program Files (x86)\\Crypto Pro\\CSP\\csptest.exe',
            ]));
        }
    });
});
//# sourceMappingURL=cryptopro-tool-resolver.spec.js.map