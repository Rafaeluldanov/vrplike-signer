import { spawn } from 'child_process';

type RegRunResult = { exitCode: number; stdout: string; stderr: string };

function toNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

async function runRegExe(args: string[], regExe = 'reg.exe'): Promise<RegRunResult> {
  return await new Promise<RegRunResult>((resolve) => {
    const child = spawn(regExe, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += String(d)));
    child.stderr?.on('data', (d) => (stderr += String(d)));
    child.on('close', (code) => resolve({ exitCode: typeof code === 'number' ? code : 1, stdout, stderr }));
    child.on('error', (err) =>
      resolve({ exitCode: 1, stdout, stderr: `${stderr}\n${err instanceof Error ? err.message : String(err)}`.trim() }),
    );
  });
}

export async function ensureVrplikeSignerAutostartRegisteredWindows(args?: {
  platform?: NodeJS.Platform;
  exePath?: string;
  log?: (line: string) => void;
  regExe?: string;
  runReg?: (args: string[]) => Promise<RegRunResult>;
}): Promise<void> {
  const platform = args?.platform ?? process.platform;
  if (platform !== 'win32') return;

  const exePath = args?.exePath ?? process.execPath;
  const log = args?.log ?? (() => void 0);
  const runReg = args?.runReg ?? ((a) => runRegExe(a, args?.regExe ?? 'reg.exe'));

  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  const name = 'vrplike-signer';
  // IMPORTANT:
  // - HKCU Run => no admin/UAC
  // - signer defaults to background mode, so we do NOT add flags here
  const desired = `"${exePath}"`;

  try {
    const q = await runReg(['query', key, '/v', name]);
    if (q.exitCode === 0) {
      const current = toNonEmptyString(q.stdout) ?? '';
      // If the value exists but uses another path/value, overwrite.
      if (current.includes(desired)) return;
    }
  } catch {
    // ignore and attempt to set value anyway
  }

  try {
    await runReg(['add', key, '/v', name, '/t', 'REG_SZ', '/d', desired, '/f']);
    log('Autostart registered');
  } catch (e: any) {
    // Best-effort only: do not block agent startup.
    const msg = e instanceof Error ? e.message : String(e);
    log(`Autostart registration failed: ${msg}`);
  }
}

