/* eslint-disable @typescript-eslint/no-var-requires */
import { EventEmitter } from 'events';

import { SignerError } from '../cryptopro/signer-error';

// Mock child_process.spawn used by module under test.
jest.mock('child_process', () => {
  return { spawn: jest.fn() };
});

type SpawnCall = { cmd: string; args: string[]; opts: any };

function makeFakeChild(opts: { exitCode: number; stdout?: string; stderr?: string }) {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();

  // Emit output asynchronously to mimic real spawn streams.
  process.nextTick(() => {
    if (opts.stdout) child.stdout.emit('data', Buffer.from(opts.stdout, 'utf8'));
    if (opts.stderr) child.stderr.emit('data', Buffer.from(opts.stderr, 'utf8'));
    child.emit('close', opts.exitCode);
  });
  return child;
}

describe('cadescom-signing', () => {
  const originalPlatform = process.platform;

  beforeAll(() => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  beforeEach(() => {
    const { spawn } = require('child_process');
    spawn.mockReset();
  });

  test('runs PowerShell with required flags and normalizes thumbprint', async () => {
    const calls: SpawnCall[] = [];
    const { spawn } = require('child_process');
    spawn.mockImplementation((cmd: string, args: string[], opts: any) => {
      calls.push({ cmd, args, opts });
      return makeFakeChild({
        exitCode: 0,
        stdout: '-----BEGIN CMS-----\nAA BB\n-----END CMS-----\n',
      });
    });

    const { signBase64ViaCadesCom } = require('./cadescom-signing');
    const r = await signBase64ViaCadesCom({ dataBase64: 'cGluZw==', thumbprint: ' aa bb-cc ' });

    expect(r).toMatchObject({ signatureBase64: 'AABB' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd).toBe('powershell.exe');
    expect(calls[0]!.args).toEqual(
      expect.arrayContaining(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']),
    );
    expect(calls[0]!.opts?.env?.VRPLIKE_SIGN_THUMBPRINT).toBe('AABBCC');
    expect(calls[0]!.opts?.env?.VRPLIKE_SIGN_DATA_BASE64).toBe('cGluZw==');
  });

  test('maps "Cannot create ActiveX object" to CADESCOM_NOT_AVAILABLE', async () => {
    const { spawn } = require('child_process');
    spawn.mockImplementation((_cmd: string, _args: string[], _opts: any) => {
      return makeFakeChild({
        exitCode: 1,
        stderr: 'Cannot create ActiveX object\n',
      });
    });

    const { signBase64ViaCadesCom } = require('./cadescom-signing');
    await expect(signBase64ViaCadesCom({ dataBase64: 'cGluZw==', thumbprint: 'A'.repeat(40) })).rejects.toMatchObject({
      code: 'CADESCOM_NOT_AVAILABLE',
    });
  });

  test('lists certs with private key via PowerShell and normalizes thumbprints', async () => {
    const calls: SpawnCall[] = [];
    const { spawn } = require('child_process');
    spawn.mockImplementation((cmd: string, args: string[], opts: any) => {
      calls.push({ cmd, args, opts });
      return makeFakeChild({
        exitCode: 0,
        stdout: JSON.stringify([
          { thumbprint: 'aa bb', store: 'CurrentUser\\My', hasPrivateKey: true },
          { thumbprint: 'cc dd', store: 'LocalMachine\\My', hasPrivateKey: true },
        ]),
      });
    });

    const { listCertsWithPrivateKeyViaPowerShell } = require('./cadescom-signing');
    const list = await listCertsWithPrivateKeyViaPowerShell();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd).toBe('powershell.exe');
    expect(calls[0]!.args).toEqual(
      expect.arrayContaining(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']),
    );
    expect(list).toEqual([
      { thumbprint: 'AABB', store: 'CurrentUser\\My', hasPrivateKey: true },
      { thumbprint: 'CCDD', store: 'LocalMachine\\My', hasPrivateKey: true },
    ]);
  });
});

