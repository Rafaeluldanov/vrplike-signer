import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { startIpcServer, trySendIpcMessage, type IpcMessage } from './ipc';

function tmpSockPath(): string {
  const id = crypto.randomBytes(8).toString('hex');
  return path.join(os.tmpdir(), `vrplike-signer-ipc-test-${process.pid}-${id}.sock`);
}

describe('windows/ipc', () => {
  test('server receives DEEPLINK message', async () => {
    const pipePath = tmpSockPath();
    const received: IpcMessage[] = [];

    const server = await startIpcServer({
      pipePath,
      onMessage: async (m) => {
        received.push(m);
      },
    });

    const r = await trySendIpcMessage({
      pipePath,
      message: { type: 'DEEPLINK', url: 'vrplike-signer://pair?token=t&wsUrl=wss%3A%2F%2Fx&le=1' },
      timeoutMs: 500,
    });
    expect(r).toEqual({ ok: true });

    await server.close();
    try {
      if (fs.existsSync(pipePath)) fs.unlinkSync(pipePath);
    } catch {
      // ignore
    }

    expect(received).toEqual([{ type: 'DEEPLINK', url: 'vrplike-signer://pair?token=t&wsUrl=wss%3A%2F%2Fx&le=1' }]);
  });

  test('server receives ARGS message', async () => {
    const pipePath = tmpSockPath();
    const received: IpcMessage[] = [];

    const server = await startIpcServer({
      pipePath,
      onMessage: async (m) => {
        received.push(m);
      },
    });

    const r = await trySendIpcMessage({
      pipePath,
      message: { type: 'ARGS', argv: ['--wssUrl', 'wss://x'] },
      timeoutMs: 500,
    });
    expect(r).toEqual({ ok: true });

    await server.close();
    try {
      if (fs.existsSync(pipePath)) fs.unlinkSync(pipePath);
    } catch {
      // ignore
    }

    expect(received).toEqual([{ type: 'ARGS', argv: ['--wssUrl', 'wss://x'] }]);
  });
});

