import { spawn } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';

import { SignerError } from './signer-error';

export type CryptoProTool = 'cryptcp' | 'csptest';

export type ResolvedTool = {
  tool: CryptoProTool;
  path: string;
  source: 'ENV' | 'PATH' | 'STANDARD_PATH';
};

type SpawnCaptureResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

async function spawnCapture(cmd: string, args: string[]): Promise<SpawnCaptureResult> {
  return await new Promise<SpawnCaptureResult>((resolve) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (d) => (stdout += String(d)));
    child.stderr?.on('data', (d) => (stderr += String(d)));

    child.on('close', (code) => resolve({ exitCode: typeof code === 'number' ? code : 1, stdout, stderr }));
    child.on('error', (err: any) =>
      resolve({
        exitCode: 1,
        stdout,
        stderr: `${stderr}\n${err instanceof Error ? err.message : String(err)}`.trim(),
      }),
    );
  });
}

function otherTool(t: CryptoProTool): CryptoProTool {
  return t === 'cryptcp' ? 'csptest' : 'cryptcp';
}

function normalizeEnvPath(v: string | null | undefined): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : null;
}

function standardPathsInStrictOrder(): Array<{ tool: CryptoProTool; path: string }> {
  return [
    { tool: 'cryptcp', path: 'C:\\Program Files\\Crypto Pro\\CSP\\cryptcp.exe' },
    { tool: 'cryptcp', path: 'C:\\Program Files (x86)\\Crypto Pro\\CSP\\cryptcp.exe' },
    { tool: 'csptest', path: 'C:\\Program Files\\Crypto Pro\\CSP\\csptest.exe' },
    { tool: 'csptest', path: 'C:\\Program Files (x86)\\Crypto Pro\\CSP\\csptest.exe' },
  ];
}

async function resolveViaWhere(tool: CryptoProTool): Promise<{ foundPath: string | null; checked: string[] }> {
  // NOTE: use `where` (cmd.exe built-in) via spawn; no PowerShell.
  const checked: string[] = [`where ${tool}`];
  const res = await spawnCapture('where', [tool]);
  const out = (res.stdout ?? '').replace(/\r/g, '');
  const lines = out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  for (const l of lines) checked.push(l);
  const firstExisting = lines.find((p) => existsSync(p)) ?? null;
  return { foundPath: firstExisting, checked };
}

export async function resolveCryptoProTool(opts?: {
  preferredTool?: CryptoProTool; // default "cryptcp"
  envCryptcpPath?: string | null;
  envCsptestPath?: string | null;
  cryptoProHome?: string | null;
}): Promise<ResolvedTool> {
  const preferredTool: CryptoProTool = opts?.preferredTool ?? 'cryptcp';

  // Non-Windows: keep current behavior (PATH-based).
  if (process.platform !== 'win32') {
    return { tool: preferredTool, path: preferredTool, source: 'PATH' };
  }

  const envCryptcpPath = normalizeEnvPath(opts?.envCryptcpPath ?? process.env.CRYPTCP_PATH);
  const envCsptestPath = normalizeEnvPath(opts?.envCsptestPath ?? process.env.CSPTEST_PATH);
  const cryptoProHome = normalizeEnvPath(opts?.cryptoProHome ?? process.env.CRYPTOPRO_HOME);

  const checkedPaths: string[] = [];
  const tools: CryptoProTool[] = [preferredTool, otherTool(preferredTool)];

  for (const tool of tools) {
    // 1) ENV override (direct tool path)
    const envPath = tool === 'cryptcp' ? envCryptcpPath : envCsptestPath;
    if (envPath) {
      checkedPaths.push(envPath);
      if (existsSync(envPath)) return { tool, path: envPath, source: 'ENV' };
    }

    // 2) CRYPTOPRO_HOME
    if (cryptoProHome) {
      const exe = tool === 'cryptcp' ? 'cryptcp.exe' : 'csptest.exe';
      const p = path.join(cryptoProHome, exe);
      checkedPaths.push(p);
      if (existsSync(p)) return { tool, path: p, source: 'ENV' };
    }

    // 3) PATH (where)
    const where = await resolveViaWhere(tool);
    checkedPaths.push(...where.checked);
    if (where.foundPath) return { tool, path: where.foundPath, source: 'PATH' };
  }

  // 4) Standard paths (strict order)
  for (const p of standardPathsInStrictOrder()) {
    checkedPaths.push(p.path);
    if (existsSync(p.path)) return { tool: p.tool, path: p.path, source: 'STANDARD_PATH' };
  }

  throw new SignerError('CRYPTOPRO_NOT_FOUND', 'CryptoPro CSP не найден. Установите CryptoPro CSP.', {
    checkedPaths,
  });
}

