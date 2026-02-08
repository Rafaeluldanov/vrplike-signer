import { spawn } from 'child_process';

type RegRunResult = { exitCode: number; stdout: string; stderr: string };

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

export async function ensureVrplikeSignerDeeplinkRegisteredWindows(args?: {
  platform?: NodeJS.Platform;
  protocol?: string;
  exePath?: string;
  log?: (line: string) => void;
  regExe?: string;
  runReg?: (args: string[]) => Promise<RegRunResult>;
}): Promise<void> {
  const platform = args?.platform ?? process.platform;
  if (platform !== 'win32') return;

  const protocol = (args?.protocol ?? 'vrplike-signer').trim();
  if (!protocol) return;

  const log = args?.log ?? ((line) => console.log(line)); // eslint-disable-line no-console
  const baseKey = `HKCU\\Software\\Classes\\${protocol}`;
  const commandKey = `${baseKey}\\shell\\open\\command`;
  const runReg = args?.runReg ?? ((a) => runRegExe(a, args?.regExe ?? 'reg.exe'));

  try {
    const query = await runReg(['query', commandKey]);
    if (query.exitCode === 0) return;

    const exePath = args?.exePath ?? process.execPath;
    // IMPORTANT:
    // - per-user registration (HKCU) => no admin/UAC
    // - pass deeplink URL as "%1"
    // - signer defaults to background mode, so we do NOT add flags here
    const command = `"${exePath}" "%1"`;

    // Register URL protocol handler per-user (no admin rights).
    await runReg(['add', baseKey, '/ve', '/t', 'REG_SZ', '/d', 'URL:vrplike signer', '/f']);
    await runReg(['add', baseKey, '/v', 'URL Protocol', '/t', 'REG_SZ', '/d', '', '/f']);
    await runReg(['add', commandKey, '/ve', '/t', 'REG_SZ', '/d', command, '/f']);

    log('Deep link protocol registered');
  } catch (e: any) {
    // Best-effort only: do not block agent startup.
    const msg = e instanceof Error ? e.message : String(e);
    log(`Deep link protocol registration failed: ${msg}`);
  }
}

