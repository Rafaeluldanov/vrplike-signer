import net from 'net';
import os from 'os';

export type IpcMessage =
  | { type: 'DEEPLINK'; url: string }
  | { type: 'ARGS'; argv: string[] }
  | { type: 'RECONNECT' }
  | { type: 'PING' }
  | { type: 'QUIT' };

export type IpcServer = {
  pipePath: string;
  close: () => Promise<void>;
};

function toNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function vrplikeSignerPipePath(): string {
  // IMPORTANT:
  // - Named pipe on Windows
  // - "one user = one instance": include user identity in pipe name
  // - On non-Windows we still return a valid path-like string; caller should gate usage by platform.
  const userRaw =
    toNonEmptyString(process.env.USERDOMAIN) && toNonEmptyString(process.env.USERNAME)
      ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
      : toNonEmptyString(process.env.USERNAME) ??
        (() => {
          try {
            return os.userInfo().username;
          } catch {
            return null;
          }
        })() ??
        'user';
  const safe = String(userRaw)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .slice(0, 48);
  return `\\\\.\\pipe\\vrplike-signer-${safe || 'user'}`;
}

function vrplikeSignerLegacyPipePath(): string {
  return '\\\\.\\pipe\\vrplike-signer';
}

export async function trySendIpcMessage(args: {
  pipePath?: string;
  message: IpcMessage;
  timeoutMs?: number;
}): Promise<{ ok: true } | { ok: false; reason: 'NO_SERVER' | 'TIMEOUT' | 'SEND_FAILED' }> {
  // Backward compatibility: during rollout, older agents may still listen on the legacy pipe name.
  const pipePaths = args.pipePath ? [args.pipePath] : [vrplikeSignerPipePath(), vrplikeSignerLegacyPipePath()];
  const timeoutMs = Number.isFinite(args.timeoutMs) ? Number(args.timeoutMs) : 750;

  const tryOnce = async (pipePath: string) =>
    await new Promise<{ ok: true } | { ok: false; reason: 'NO_SERVER' | 'TIMEOUT' | 'SEND_FAILED' }>((resolve) => {
    let done = false;
    const finish = (v: { ok: true } | { ok: false; reason: 'NO_SERVER' | 'TIMEOUT' | 'SEND_FAILED' }) => {
      if (done) return;
      done = true;
      resolve(v);
    };

    const socket = net.connect(pipePath);
    let sawOk = false;

    const t = setTimeout(() => {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      finish({ ok: false, reason: 'TIMEOUT' });
    }, Math.max(50, timeoutMs));

    socket.on('connect', () => {
      try {
        socket.write(JSON.stringify(args.message) + '\n');
        socket.end();
      } catch {
        clearTimeout(t);
        finish({ ok: false, reason: 'SEND_FAILED' });
      }
    });

    socket.on('data', (buf) => {
      const s = toNonEmptyString(buf?.toString?.('utf8'));
      if (s && s.toUpperCase().includes('OK')) {
        sawOk = true;
        clearTimeout(t);
        finish({ ok: true });
      }
    });

    socket.on('error', (e: any) => {
      clearTimeout(t);
      const code = toNonEmptyString(e?.code);
      if (code === 'ENOENT' || code === 'ECONNREFUSED') {
        finish({ ok: false, reason: 'NO_SERVER' });
        return;
      }
      finish({ ok: false, reason: 'SEND_FAILED' });
    });

    socket.on('close', () => {
      clearTimeout(t);
      if (!done) finish(sawOk ? { ok: true } : { ok: false, reason: 'SEND_FAILED' });
    });
  });

  for (const p of pipePaths) {
    const r = await tryOnce(p);
    if (r.ok) return r;
    if (r.reason !== 'NO_SERVER') return r;
  }
  return { ok: false, reason: 'NO_SERVER' };
}

export async function startIpcServer(args: {
  pipePath?: string;
  onMessage: (msg: IpcMessage) => void | Promise<void>;
  log?: (line: string) => void;
}): Promise<IpcServer> {
  const pipePath = args.pipePath ?? vrplikeSignerPipePath();
  const log = args.log ?? (() => void 0);

  const server = net.createServer((socket) => {
    let buf = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buf += String(chunk ?? '');
      if (!buf.includes('\n')) return;
      const [line] = buf.split('\n');
      buf = '';
      try {
        const parsed = JSON.parse(line) as any;
        const type = toNonEmptyString(parsed?.type);
        if (type === 'DEEPLINK' || type === 'DEEPLINK_PAIR') {
          // Backward compatibility: accept legacy DEEPLINK_PAIR from older launchers/agents.
          const url = toNonEmptyString(parsed?.url);
          if (url) void args.onMessage({ type: 'DEEPLINK', url });
        } else if (type === 'ARGS') {
          const argv = Array.isArray(parsed?.argv) ? parsed.argv.filter((x: unknown) => typeof x === 'string') : null;
          if (argv) void args.onMessage({ type: 'ARGS', argv });
        } else if (type === 'RECONNECT') {
          void args.onMessage({ type: 'RECONNECT' });
        } else if (type === 'PING') {
          void args.onMessage({ type: 'PING' });
        } else if (type === 'QUIT') {
          void args.onMessage({ type: 'QUIT' });
        }
      } catch (e: any) {
        log(`ipc: invalid message: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        try {
          socket.write('OK\n');
        } catch {
          // ignore
        }
        try {
          socket.end();
        } catch {
          // ignore
        }
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipePath, () => resolve());
  });

  return {
    pipePath,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

