import { spawn } from 'child_process';
import { SignerError } from './signer-error';

type RunResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdoutTrunc: string;
  stderrTrunc: string;
};

function truncateUtf8(buf: Buffer, maxBytes: number): string {
  if (buf.length <= maxBytes) return buf.toString('utf8');
  return buf.subarray(0, maxBytes).toString('utf8') + '\n[...truncated...]';
}

export function spawnWithTimeout(cmd: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const onData = (arr: Buffer[], chunk: Buffer) => {
      // Cap memory usage (keep up to ~64KB per stream).
      const MAX = 64 * 1024;
      if (arr.reduce((n, b) => n + b.length, 0) >= MAX) return;
      arr.push(chunk);
    };

    child.stdout?.on('data', (c: Buffer) => onData(stdoutChunks, c));
    child.stderr?.on('data', (c: Buffer) => onData(stderrChunks, c));

    const t = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new SignerError('TIMEOUT', `CryptoPro tool timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('error', (err: any) => {
      clearTimeout(t);
      // ENOENT typically means tool not found.
      if (err?.code === 'ENOENT') {
        reject(
          new SignerError(
            'SIGNING_TOOL_NOT_FOUND',
            'Не найдены утилиты подписи CryptoPro (cryptcp/csptest). Установите CryptoPro Tools или укажите путь через CRYPTCP_PATH / CSPTEST_PATH / CRYPTOPRO_HOME.',
            {
            checkedPaths: [cmd],
            },
          ),
        );
        return;
      }
      reject(new SignerError('SIGN_FAILED', `CryptoPro tool failed to start: ${String(err?.message ?? err)}`));
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

