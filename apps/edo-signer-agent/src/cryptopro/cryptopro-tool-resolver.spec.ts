import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

import { SignerError } from './signer-error';
import { resolveCryptoProTool } from './cryptopro-tool-resolver';

jest.mock('fs', () => ({
  existsSync: jest.fn(),
}));

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

import { existsSync } from 'fs';
import { spawn } from 'child_process';

function mockSpawnResult(args: { stdout?: string; stderr?: string; exitCode?: number; error?: { code?: string; message?: string } }) {
  const proc = new EventEmitter() as any;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();

  process.nextTick(() => {
    if (args.error) {
      const err: any = new Error(args.error.message ?? 'spawn error');
      if (args.error.code) err.code = args.error.code;
      proc.emit('error', err);
      return;
    }
    if (args.stdout) proc.stdout.write(args.stdout);
    if (args.stderr) proc.stderr.write(args.stderr);
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
    (existsSync as any as jest.Mock).mockReset();
    (spawn as any as jest.Mock).mockReset();
  });

  test('ENV → ENV', async () => {
    (existsSync as any as jest.Mock).mockImplementation((p: string) => p === 'C:\\Tools\\cryptcp.exe');

    const res = await resolveCryptoProTool({
      preferredTool: 'cryptcp',
      envCryptcpPath: 'C:\\Tools\\cryptcp.exe',
      envCsptestPath: null,
      cryptoProHome: null,
    });

    expect(res).toEqual({ tool: 'cryptcp', path: 'C:\\Tools\\cryptcp.exe', source: 'ENV' });
    expect(spawn).not.toHaveBeenCalled();
  });

  test('PATH (where) → PATH', async () => {
    (existsSync as any as jest.Mock).mockImplementation((p: string) => p === 'C:\\Crypto Pro\\CSP\\cryptcp.exe');
    (spawn as any as jest.Mock).mockImplementation((_cmd: string, args: string[]) => {
      expect(args).toEqual(['cryptcp']);
      return mockSpawnResult({ stdout: 'C:\\Crypto Pro\\CSP\\cryptcp.exe\r\n', exitCode: 0 });
    });

    const res = await resolveCryptoProTool({
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
    (existsSync as any as jest.Mock).mockImplementation((p: string) => p === standard);
    (spawn as any as jest.Mock).mockImplementation((_cmd: string, args: string[]) => {
      expect(args).toEqual([expect.stringMatching(/^(cryptcp|csptest)$/)]);
      return mockSpawnResult({ stdout: '', exitCode: 1 });
    });

    const res = await resolveCryptoProTool({
      preferredTool: 'cryptcp',
      envCryptcpPath: null,
      envCsptestPath: null,
      cryptoProHome: null,
    });

    expect(res).toEqual({ tool: 'cryptcp', path: standard, source: 'STANDARD_PATH' });
  });

  test('nothing found → SIGNING_TOOL_NOT_FOUND', async () => {
    (existsSync as any as jest.Mock).mockReturnValue(false);
    (spawn as any as jest.Mock).mockImplementation((_cmd: string, _args: string[]) => mockSpawnResult({ stdout: '', exitCode: 1 }));

    try {
      await resolveCryptoProTool({
        preferredTool: 'cryptcp',
        envCryptcpPath: null,
        envCsptestPath: null,
        cryptoProHome: null,
      });
      throw new Error('expected to throw');
    } catch (e: any) {
      expect(e).toBeInstanceOf(SignerError);
      expect(e.code).toBe('SIGNING_TOOL_NOT_FOUND');
      expect(e.message).toContain('Не найдены утилиты подписи CryptoPro');
      expect(e.details).toBeTruthy();
      const checked = (e.details as any).checkedPaths as string[];
      expect(Array.isArray(checked)).toBe(true);
      expect(checked).toEqual(expect.arrayContaining(['where cryptcp', 'where csptest']));
      expect(checked).toEqual(
        expect.arrayContaining([
          'C:\\Program Files\\Crypto Pro\\CSP\\cryptcp.exe',
          'C:\\Program Files (x86)\\Crypto Pro\\CSP\\cryptcp.exe',
          'C:\\Program Files\\Crypto Pro\\CSP\\csptest.exe',
          'C:\\Program Files (x86)\\Crypto Pro\\CSP\\csptest.exe',
        ]),
      );
    }
  });
});

