import WebSocket from 'ws';
import { spawn, spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { hostname, homedir } from 'os';
import net from 'net';
import * as path from 'path';
import * as readline from 'readline';

import { signAuthChallengeAttached, SignerError } from './cryptopro/cryptopro-signer';
import { listCertificatesCertmgr } from './cryptopro/cryptopro-certmgr';
import { resolveCryptoProTool } from './cryptopro/cryptopro-tool-resolver';
import { chooseCertificateThumbprint, filterCertificatesByInn } from './certificate-selection';
import { apiBaseFromWsUrl, exchangeDeeplinkToken, parseVrplikeSignerDeeplink } from './deeplink';
import { promptSelectCertificateWinHta } from './ui/win-hta-cert-select';
import { ensureVrplikeSignerDeeplinkRegisteredWindows } from './windows/register-deeplink';
import { ensureVrplikeSignerAutostartRegisteredWindows } from './windows/register-autostart';
import { createWindowsTray, type TrayState, type WindowsTray } from './windows/tray';
import { startIpcServer, trySendIpcMessage, type IpcMessage } from './windows/ipc';
import { computeTrayHostPipeName, namedPipePathWindows, resolveTrayHostPaths } from './windows/tray-host';
import { createFileLogger, hookConsoleToLogger, hookConsoleToTeeLogger, type Logger } from './log';
import { computeBackgroundChildArgs, computeLauncherForwardMessage, isDeeplinkArg, shouldRunLauncher } from './launcher-plan';
import { checkWindowsSigningReadiness } from './crypto/windows-cert-store';

// Runtime invariant (Windows portable exe):
// - default mode (double click / deeplink / autorun) is LAUNCHER:
//   it spawns a hidden detached --background child and exits immediately.
// - --background mode hosts tray + IPC + WSS loop (no installer, no PE patching).
// - logging is file-only by default (console is redirected to file logger).
let isBackgroundRuntime = false;

type AgentState = {
  agentId: string;
  agentSecret: string;
  wssUrl?: string;
  certificateRef?: string;
  organizationId?: string;
  legalEntityId?: string;
  pinnedThumbprintsByInn?: Record<string, string>;
};

type ClientMessage =
  | { type: 'HELLO_PAIR'; pairingToken: string; agentInfo?: { version?: string; hostname?: string } }
  | { type: 'HELLO_AUTH'; agentId: string; agentSecret: string }
  | { type: 'PONG' }
  | {
      type: 'SIGN_RESULT';
      requestId: string;
      ok: true;
      signatureBase64: string;
    }
  | {
      type: 'SIGN_RESULT';
      requestId: string;
      ok: false;
      error: { code: string; message: string };
    };

function toNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

type CliArgs = {
  wssUrl?: string;
  pairingToken?: string;
  certificateRef?: string;
  installed: boolean;
  doctor: boolean;
  help: boolean;
};

function normalizeCliKey(k: string): string {
  return String(k ?? '')
    .replace(/^-+/, '')
    .trim()
    .replace(/_/g, '-')
    .toLowerCase();
}

function parseCliArgs(argv: string[]): CliArgs {
  const out: CliArgs = { help: false, doctor: false, installed: false };
  const set = (key: string, value: string | boolean) => {
    if (key === 'help') out.help = Boolean(value);
    if (key === 'doctor') out.doctor = Boolean(value);
    if (key === 'installed') out.installed = Boolean(value);
    if (typeof value !== 'string') return;
    if (key === 'wssurl') out.wssUrl = value;
    if (key === 'pairingtoken') out.pairingToken = value;
    if (key === 'certificateref') out.certificateRef = value;
  };

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (raw === '-h' || raw === '--help') {
      out.help = true;
      continue;
    }
    if (raw === '--doctor') {
      out.doctor = true;
      continue;
    }
    if (raw === '--installed') {
      out.installed = true;
      continue;
    }
    if (!raw.startsWith('--')) continue;

    const eqIdx = raw.indexOf('=');
    const keyRaw = eqIdx >= 0 ? raw.slice(0, eqIdx) : raw;
    const keyNorm = normalizeCliKey(keyRaw).replace(/-/g, '');
    const value = eqIdx >= 0 ? raw.slice(eqIdx + 1) : argv[i + 1];

    if (keyNorm === 'help') {
      out.help = true;
      continue;
    }
    if (keyNorm === 'doctor') {
      out.doctor = true;
      continue;
    }
    if (keyNorm === 'installed') {
      out.installed = true;
      continue;
    }

    // Flags we care about always require a value.
    if (keyNorm === 'wssurl' || keyNorm === 'pairingtoken' || keyNorm === 'certificateref') {
      if (eqIdx < 0) i++; // consume the next arg as value
      const v = toNonEmptyString(value);
      if (v) set(keyNorm, v);
    }
  }

  return out;
}

function truncateUtf8(buf: Buffer, maxBytes: number): string {
  if (buf.length <= maxBytes) return buf.toString('utf8');
  return buf.subarray(0, maxBytes).toString('utf8') + '\n[...truncated...]';
}

function resolveWindowsAppDataFallback(): string {
  let appData = String(process.env.APPDATA ?? '').trim();
  if (appData) return appData;

  const userProfile = String(process.env.USERPROFILE ?? '').trim();
  if (userProfile) return path.join(userProfile, 'AppData', 'Roaming');

  return path.join(homedir(), 'AppData', 'Roaming');
}

function resolveWindowsLocalAppDataFallback(): string {
  const local = String(process.env.LOCALAPPDATA ?? '').trim();
  if (local) return local;

  const userProfile = String(process.env.USERPROFILE ?? '').trim();
  if (userProfile) return path.join(userProfile, 'AppData', 'Local');

  return path.join(homedir(), 'AppData', 'Local');
}

function looksLikeInstalledWindowsExecPath(execPath: string): boolean {
  if (process.platform !== 'win32') return false;
  const exe = path.normalize(String(execPath ?? ''));
  if (!exe) return false;

  // Default installer path (no admin).
  const localApp = path.normalize(path.join(resolveWindowsLocalAppDataFallback(), 'vrplike-signer'));
  const exeLower = exe.toLowerCase();
  const localLower = localApp.toLowerCase();
  if (exeLower.startsWith(localLower + path.sep)) return true;

  // Admin install fallback: any path containing "\vrplike-signer\".
  return exeLower.includes(`${path.sep}vrplike-signer${path.sep}`);
}

type RegistryCheck = { ok: boolean; exitCode: number | null; command: string; stdout: string; stderr: string };
function checkVrplikeSignerProtocolRegistryWindows(): RegistryCheck | null {
  if (process.platform !== 'win32') return null;

  const key = 'HKCU\\Software\\Classes\\vrplike-signer\\shell\\open\\command';
  const command = `reg.exe query "${key}"`;
  try {
    const r = spawnSync('reg.exe', ['query', key], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    return {
      ok: r.status === 0,
      exitCode: typeof r.status === 'number' ? r.status : null,
      command,
      stdout: String(r.stdout ?? ''),
      stderr: String(r.stderr ?? ''),
    };
  } catch (e: any) {
    return {
      ok: false,
      exitCode: null,
      command,
      stdout: '',
      stderr: e instanceof Error ? e.message : String(e),
    };
  }
}

export type DoctorInfo = {
  platform: string;
  execPath: string;
  cwd: string;
  env: {
    APPDATA?: string;
    USERPROFILE?: string;
    HOMEDRIVE?: string;
    HOMEPATH?: string;
  };
  osHomedir: string;
  appDataFallback: string;
  agentJsonPath: string;
  registryCheck: RegistryCheck | null;
  signing?: {
    readiness:
      | { ok: true; totalCertCount: number; privateKeyCertCount: number; sampleThumbprint?: string }
      | { ok: false; code: string; message: string };
    tools:
      | { ok: true; tool: string; path: string; source: string }
      | { ok: false; code: string; message: string; checkedPaths?: string[] };
  };
  tray?: {
    pipeName: string;
    pipePath: string;
    expectedExePath: string;
    expectedExeExists: boolean;
    expectedExeSize: number | null;
    pipeServerRunning: boolean;
  };
};

export function formatDoctorReport(info: DoctorInfo): string {
  const homeDrive = String(info.env.HOMEDRIVE ?? '').trim();
  const homePath = String(info.env.HOMEPATH ?? '').trim();
  const homeDrivePath = (homeDrive || homePath) && `${homeDrive}${homePath}`;

  const lines: string[] = [];
  lines.push('vrplike-signer --doctor');
  lines.push(`platform: ${info.platform}`);
  lines.push(`process.execPath: ${info.execPath}`);
  lines.push(`process.cwd(): ${info.cwd}`);
  lines.push(`env.APPDATA: ${String(info.env.APPDATA ?? '')}`);
  lines.push(`env.USERPROFILE: ${String(info.env.USERPROFILE ?? '')}`);
  lines.push(`env.HOMEDRIVE+env.HOMEPATH: ${homeDrivePath || ''}`);
  lines.push(`os.homedir(): ${info.osHomedir}`);
  lines.push(`calculated appDataFallback: ${info.appDataFallback}`);
  lines.push(`agent.json: ${info.agentJsonPath}`);
  if (info.signing) {
    const r = info.signing.readiness as any;
    if (r?.ok) {
      lines.push(
        `windows cert-store readiness: OK privateKeyCerts=${r.privateKeyCertCount} totalCerts=${r.totalCertCount}${r.sampleThumbprint ? ` sampleThumbprint=${r.sampleThumbprint}` : ''}`,
      );
    } else {
      lines.push(`windows cert-store readiness: NOT READY code=${String(r?.code ?? '')}`);
      const msg = String(r?.message ?? '').trim();
      if (msg) lines.push(`windows cert-store message: ${msg}`);
    }

    const t = info.signing.tools as any;
    if (t?.ok) {
      lines.push(`signing tools (cryptcp/csptest): FOUND tool=${t.tool} source=${t.source} path=${t.path}`);
    } else {
      lines.push(`signing tools (cryptcp/csptest): NOT FOUND code=${String(t?.code ?? '')}`);
      const msg = String(t?.message ?? '').trim();
      if (msg) lines.push(`signing tools message: ${msg}`);
      const checked = Array.isArray(t?.checkedPaths) ? (t.checkedPaths as any[]).filter((x) => typeof x === 'string') : [];
      if (checked.length) {
        lines.push('signing tools checked paths:');
        for (const p of checked as string[]) lines.push(`— ${p}`);
      }
    }
  }

  if (info.registryCheck) {
    lines.push(`registry vrplike-signer://: ${info.registryCheck.ok ? 'YES' : 'NO'}`);
    lines.push(`registry command: ${info.registryCheck.command}`);
    lines.push(`registry exitCode: ${info.registryCheck.exitCode ?? 'n/a'}`);

    if (!info.registryCheck.ok) {
      const tail = (info.registryCheck.stderr || info.registryCheck.stdout || '').trim();
      if (tail) lines.push(`registry output:\n${truncateUtf8(Buffer.from(tail, 'utf8'), 2048)}`);
    }
  } else {
    lines.push('registry vrplike-signer://: n/a (non-windows)');
  }

  if (info.tray) {
    lines.push(`tray-host exe (expected): ${info.tray.expectedExePath}`);
    lines.push(
      `tray-host exe exists: ${info.tray.expectedExeExists ? 'YES' : 'NO'}${info.tray.expectedExeExists ? ` size=${info.tray.expectedExeSize ?? 'n/a'}` : ''}`,
    );
    lines.push(`tray pipe name: ${info.tray.pipeName}`);
    lines.push(`tray pipe path: ${info.tray.pipePath}`);
    lines.push(`tray pipe server running: ${info.tray.pipeServerRunning ? 'YES' : 'NO'}`);
  } else {
    lines.push('tray-host: n/a');
  }

  return lines.join('\n');
}

function printCryptoProNotFound(details: unknown): void {
  // eslint-disable-next-line no-console
  console.error('CryptoPro CSP не найден.');
  // eslint-disable-next-line no-console
  console.error('Установите CryptoPro CSP и повторите.');
  // eslint-disable-next-line no-console
  console.error('');

  const checkedPaths = (details && typeof details === 'object' && 'checkedPaths' in (details as any) ? (details as any).checkedPaths : null) as
    | unknown
    | null;
  const list = Array.isArray(checkedPaths) ? checkedPaths.filter((x) => typeof x === 'string' && String(x).trim()) : [];
  if (!list.length) return;

  // eslint-disable-next-line no-console
  console.error('Проверенные пути:');
  for (const p of list as string[]) {
    // eslint-disable-next-line no-console
    console.error(`— ${p}`);
  }
}

async function runDoctor(args: { statePath: string }): Promise<void> {
  const trayInfo =
    process.platform !== 'win32'
      ? null
      : await (async () => {
          const pipeName = computeTrayHostPipeName({ platform: 'win32' });
          const pipePath = namedPipePathWindows(pipeName);
          const expectedExePath = looksLikeInstalledWindowsExecPath(process.execPath)
            ? path.join(path.dirname(process.execPath), 'vrplike-signer-tray.exe')
            : resolveTrayHostPaths({}).targetPath;

          let expectedExeExists = false;
          let expectedExeSize: number | null = null;
          try {
            if (existsSync(expectedExePath)) {
              expectedExeExists = true;
              const st = statSync(expectedExePath);
              expectedExeSize = st.isFile() ? st.size : null;
            }
          } catch {
            // ignore
          }

          const pipeServerRunning = await new Promise<boolean>((resolve) => {
            let done = false;
            const finish = (v: boolean) => {
              if (done) return;
              done = true;
              resolve(v);
            };
            const sock = net.connect(pipePath);
            const t = setTimeout(() => {
              try {
                sock.destroy();
              } catch {
                // ignore
              }
              finish(false);
            }, 200);
            sock.on('connect', () => {
              clearTimeout(t);
              try {
                sock.end();
              } catch {
                // ignore
              }
              finish(true);
            });
            sock.on('error', () => {
              clearTimeout(t);
              finish(false);
            });
          });

          return { pipeName, pipePath, expectedExePath, expectedExeExists, expectedExeSize, pipeServerRunning };
        })();

  const readiness =
    process.platform === 'win32'
      ? await checkWindowsSigningReadiness().then((r) =>
          r.ok ? r : { ok: false as const, code: r.code, message: r.message },
        )
      : ({ ok: false as const, code: 'N/A', message: 'n/a (non-windows)' } as const);

  const tools =
    process.platform === 'win32'
      ? await resolveCryptoProTool({
          preferredTool: 'cryptcp',
          envCryptcpPath: process.env.CRYPTCP_PATH ?? null,
          envCsptestPath: process.env.CSPTEST_PATH ?? null,
          cryptoProHome: process.env.CRYPTOPRO_HOME ?? null,
        })
          .then((res) => ({ ok: true as const, tool: res.tool, path: res.path, source: res.source }))
          .catch((e: any) => {
            if (e instanceof SignerError) {
              const checkedPaths =
                e.details && typeof e.details === 'object' && 'checkedPaths' in (e.details as any)
                  ? ((e.details as any).checkedPaths as unknown)
                  : null;
              return {
                ok: false as const,
                code: e.code,
                message: e.message,
                checkedPaths: Array.isArray(checkedPaths) ? checkedPaths : undefined,
              };
            }
            return { ok: false as const, code: 'ERROR', message: e instanceof Error ? e.message : String(e) };
          })
      : ({ ok: false as const, code: 'N/A', message: 'n/a (non-windows)' } as const);

  const report = formatDoctorReport({
    platform: process.platform,
    execPath: process.execPath,
    cwd: process.cwd(),
    env: {
      APPDATA: process.env.APPDATA,
      USERPROFILE: process.env.USERPROFILE,
      HOMEDRIVE: process.env.HOMEDRIVE,
      HOMEPATH: process.env.HOMEPATH,
    },
    osHomedir: homedir(),
    appDataFallback: resolveWindowsAppDataFallback(),
    agentJsonPath: args.statePath,
    signing: { readiness, tools },
    registryCheck: checkVrplikeSignerProtocolRegistryWindows(),
    tray: trayInfo ?? undefined,
  });

  // eslint-disable-next-line no-console
  console.log(report);
}

function defaultAgentStatePath(): string {
  const appData = toNonEmptyString(process.env.APPDATA);
  if (appData) {
    return path.join(appData, 'vrplike-signer', 'agent.json');
  }
  return path.join(homedir(), '.vrplike-signer', 'agent.json');
}

function defaultBaseDir(): string {
  const appData = toNonEmptyString(process.env.APPDATA);
  if (appData) return path.join(appData, 'vrplike-signer');
  return path.join(homedir(), '.vrplike-signer');
}

function defaultLogsDir(): string {
  return path.join(defaultBaseDir(), 'logs');
}

function loadState(path: string): AgentState | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf8');
    const j = safeJsonParse(raw) as any;
    const agentId = toNonEmptyString(j?.agentId);
    const agentSecret = toNonEmptyString(j?.agentSecret);
    if (!agentId || !agentSecret) return null;
    return {
      agentId,
      agentSecret,
      wssUrl: toNonEmptyString(j?.wssUrl) ?? undefined,
      certificateRef: toNonEmptyString(j?.certificateRef) ?? undefined,
      organizationId: toNonEmptyString(j?.organizationId) ?? undefined,
      legalEntityId: toNonEmptyString(j?.legalEntityId) ?? undefined,
      pinnedThumbprintsByInn: (j?.pinnedThumbprintsByInn && typeof j.pinnedThumbprintsByInn === 'object' && !Array.isArray(j.pinnedThumbprintsByInn)
        ? (j.pinnedThumbprintsByInn as any)
        : undefined) as any,
    };
  } catch {
    return null;
  }
}

function saveState(filePath: string, state: AgentState): void {
  // IMPORTANT: this file contains agentSecret. Keep it local and protected by OS permissions.
  const json = JSON.stringify(state, null, 2);
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
  } catch {
    // ignore (best effort)
  }
  writeFileSync(filePath, json, { mode: 0o600 });
}

function send(ws: WebSocket, msg: ClientMessage): void {
  ws.send(JSON.stringify(msg));
}

async function promptSelectCertificateConsole(args: {
  expectedInn: string;
  candidates: Array<{ thumbprint: string; subject: string; validTo: string | null }>;
  defaultThumbprint?: string;
  allowRememberSelection: boolean;
}): Promise<{ thumbprint: string; remember: boolean }> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));

  const withTimeout = async (p: Promise<string>, timeoutMs: number): Promise<string> => {
    let t: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        p,
        new Promise<string>((_, reject) => {
          t = setTimeout(() => reject(new SignerError('TIMEOUT', 'Certificate selection timed out (no input).')), timeoutMs);
        }),
      ]);
    } finally {
      if (t) clearTimeout(t);
    }
  };

  try {
    // eslint-disable-next-line no-console
    console.log(`[agent] Found ${args.candidates.length} certificates for INN=${args.expectedInn}. Please choose one:`);
    args.candidates.forEach((c, idx) => {
      const isDefault = args.defaultThumbprint && c.thumbprint === args.defaultThumbprint;
      // eslint-disable-next-line no-console
      console.log(
        `  ${idx + 1}) ${c.thumbprint}${isDefault ? '  [default]' : ''}\n     ${c.subject}${c.validTo ? `\n     validTo: ${c.validTo}` : ''}`,
      );
    });

    // Default selection: pinned thumbprint if present.
    const defaultIdx =
      args.defaultThumbprint ? args.candidates.findIndex((c) => c.thumbprint === args.defaultThumbprint) : -1;

    while (true) {
      const hint = defaultIdx >= 0 ? ` (Enter=${defaultIdx + 1})` : '';
      const raw = (await withTimeout(question(`Select certificate number${hint} (or 'q' to cancel): `), 5 * 60 * 1000)).trim();
      const lower = raw.toLowerCase();
      if (lower === 'q' || lower === 'quit' || lower === 'exit') {
        throw new SignerError('USER_CANCELLED', 'Certificate selection cancelled by user');
      }
      const pickedRaw = raw || (defaultIdx >= 0 ? String(defaultIdx + 1) : '');
      const n = pickedRaw ? Number(pickedRaw) : NaN;
      if (Number.isFinite(n) && n >= 1 && n <= args.candidates.length) {
        const selected = args.candidates[n - 1];
        if (!args.allowRememberSelection) {
          return { thumbprint: selected.thumbprint, remember: false };
        }

        const rememberRaw = (await withTimeout(question('Pin this selection for this INN? (y/N): '), 2 * 60 * 1000)).trim().toLowerCase();
        const remember = rememberRaw === 'y' || rememberRaw === 'yes' || rememberRaw === 'да' || rememberRaw === 'д';
        return { thumbprint: selected.thumbprint, remember: Boolean(remember) };
      }
      // eslint-disable-next-line no-console
      console.log('Invalid selection. Please enter a number from the list.');
    }
  } finally {
    rl.close();
  }
}

async function promptSelectCertificate(args: {
  expectedInn: string;
  candidates: Array<{ thumbprint: string; subject: string; validTo: string | null }>;
  defaultThumbprint?: string;
  allowRememberSelection: boolean;
}): Promise<{ thumbprint: string; remember: boolean }> {
  // Windows-first UX invariant:
  // If multiple certs match expected INN, we MUST prompt via GUI (no console).
  if (process.platform === 'win32') {
    try {
      return await promptSelectCertificateWinHta({
        expectedInn: args.expectedInn,
        candidates: args.candidates,
        defaultThumbprint: args.defaultThumbprint,
        allowRememberSelection: args.allowRememberSelection,
        timeoutMs: 5 * 60 * 1000,
      });
    } catch (e) {
      // In background mode there is no console fallback.
      if (isBackgroundRuntime) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new SignerError('IO_ERROR', `Certificate selection UI failed: ${msg}`);
      }
      // Fallback to console prompt (dev environments / missing mshta).
      return await promptSelectCertificateConsole(args);
    }
  }
  return await promptSelectCertificateConsole(args);
}

async function runLauncher(rawArgsAll: string[]): Promise<void> {
  const baseDir = defaultBaseDir();
  const logsDir = defaultLogsDir();
  const logger: Logger | null = createFileLogger({ logsDir, filename: 'signer.log' });

  // Best-effort integrations (no crash on failure).
  try {
    await ensureVrplikeSignerDeeplinkRegisteredWindows({ log: (l) => logger.info(l) });
  } catch (e: any) {
    logger.warn('deeplink registration failed', { error: e instanceof Error ? e.message : String(e) });
  }
  try {
    await ensureVrplikeSignerAutostartRegisteredWindows({ log: (l) => logger.info(l) });
  } catch (e: any) {
    logger.warn('autostart registration failed', { error: e instanceof Error ? e.message : String(e) });
  }

  // Single-instance (strict): if already running, forward argv/deeplink and exit(0).
  const ping = await trySendIpcMessage({ message: { type: 'PING' }, timeoutMs: 250 });
  if (ping.ok) {
    const msg = computeLauncherForwardMessage(rawArgsAll);
    // Forward best-effort (do not block UX).
    await trySendIpcMessage({ message: msg, timeoutMs: 500 }).catch(() => void 0);
    logger.close();
    return;
  }

  // Spawn hidden detached background child and exit immediately.
  const childArgs = computeBackgroundChildArgs(rawArgsAll);
  try {
    const child = spawn(process.execPath, childArgs, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  } catch (e: any) {
    logger.error('failed to spawn background child', { error: e instanceof Error ? e.message : String(e) });
  } finally {
    logger.close();
  }
}

async function main(): Promise<void> {
  const rawArgsAll = process.argv.slice(2);

  // MUST run before any launcher/background branches.
  const argvEarly = parseCliArgs(rawArgsAll);
  const isInstalledMode = Boolean(argvEarly.installed || rawArgsAll.includes('--installed') || looksLikeInstalledWindowsExecPath(process.execPath));
  if (argvEarly.doctor || rawArgsAll.includes('--doctor')) {
    const statePath = toNonEmptyString(process.env.AGENT_STATE_PATH) ?? defaultAgentStatePath();
    await runDoctor({ statePath });
    process.exit(0);
  }

  if (!isInstalledMode && shouldRunLauncher({ platform: process.platform, rawArgs: rawArgsAll })) {
    await runLauncher(rawArgsAll);
    return;
  }

  const isConsoleMode = rawArgsAll.includes('--console');
  const isAgentBackgroundMode = rawArgsAll.includes('--background') || isInstalledMode;

  const rawArgs = rawArgsAll.filter((a) => a !== '--background' && a !== '--console' && a !== '--installed');
  const argv = parseCliArgs(rawArgs);

  const statePath = toNonEmptyString(process.env.AGENT_STATE_PATH) ?? defaultAgentStatePath();

  const deeplinkArg = rawArgs.find(isDeeplinkArg) ?? null;
  const baseDir = defaultBaseDir();
  const logsDir = defaultLogsDir();
  // Runtime mode:
  // - win32 + --installed/--background: background (tray + IPC + WSS, no console fallback)
  // - win32 + --console: dev foreground (still logs to file, but allows console output)
  // - non-win32: dev-only (no tray/IPC)
  isBackgroundRuntime = process.platform === 'win32' && isAgentBackgroundMode && !isConsoleMode;
  const logger: Logger | null = process.platform === 'win32' ? createFileLogger({ logsDir, filename: 'signer.log' }) : null;
  if (logger) (isConsoleMode ? hookConsoleToTeeLogger(logger) : hookConsoleToLogger(logger));

  if (argv.help) {
    // eslint-disable-next-line no-console
    console.log(
      [
        'vrplike-signer (Windows installed/portable exe / node dev)',
        '',
        'Usage:',
        '  vrplike-signer.exe "vrplike-signer://pair?token=...&wsUrl=wss%3A%2F%2Fapi.vrplike.io%2Fws%2Fedo-signer&le=..."',
        '  vrplike-signer.exe --wssUrl <wss://.../ws/edo-signer> --pairingToken <token>',
        '  vrplike-signer.exe --wssUrl <wss://.../ws/edo-signer>   # reconnect using saved agent.json',
        '',
        'Options:',
        '  --wssUrl <url>               WSS URL (wss://api.vrplike.io/ws/edo-signer)',
        '  --pairingToken <token>       One-time pairing token (first run)',
        '  --certificateRef <ref>       Optional default certificate ref (thumbprint/alias)',
        '  --installed                  Installed mode: no registry self-registration, no launcher',
        '  --doctor                     Diagnostics (support mode, no secrets)',
        '  --console                    Dev-only: run agent in foreground console',
        '',
        'Env fallback (dev/ops):',
        '  VRPLIKE_WSS_URL, PAIRING_TOKEN, CERTIFICATE_REF, AGENT_STATE_PATH',
        '',
      ].join('\n'),
    );
    logger?.close();
    return;
  }

  // NOTE:
  // - Portable mode uses LAUNCHER to own deeplink/autostart registration and single-instance forward.
  // - Installed mode is explicit (`--installed`) and must NOT touch registry (installer owns it).

  let trayOnReconnect = () => void 0;
  let trayOnQuit = () => void 0;
  let tray: WindowsTray | null = null;

  let shuttingDown = false;
  let ipcClose: (() => Promise<void>) | null = null;

  let existingState: AgentState | null = loadState(statePath);
  const envWssUrl = toNonEmptyString(process.env.VRPLIKE_WSS_URL);
  const envPairingToken = toNonEmptyString(process.env.PAIRING_TOKEN);
  const envCertificateRef = toNonEmptyString(process.env.CERTIFICATE_REF) ?? undefined;

  let pairingToken: string | null = argv.pairingToken ?? envPairingToken ?? null;
  let wssUrl: string | null = argv.wssUrl ?? envWssUrl ?? existingState?.wssUrl ?? null;
  const defaultCertificateRef = argv.certificateRef ?? envCertificateRef ?? existingState?.certificateRef ?? undefined;

  const setTray = (state: TrayState, details?: { errorMessage?: string }) => {
    if (!tray) return;
    tray.setState(state, details);
  };

  const gracefulShutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      setTray('reconnecting');
    } catch {
      // ignore
    }
    try {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
    } catch {
      // ignore
    }
    try {
      closeWs();
    } catch {
      // ignore
    }
    try {
      await ipcClose?.();
    } catch {
      // ignore
    }
    try {
      tray?.kill();
    } catch {
      // ignore
    }
    try {
      logger?.close();
    } catch {
      // ignore
    }
  };

  trayOnQuit = () => void gracefulShutdown();

  process.on('SIGINT', () => void gracefulShutdown());
  process.on('SIGTERM', () => void gracefulShutdown());

  let ws: WebSocket | null = null;
  let connecting = false;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let reconnectAttempt = 0;

  function closeWs() {
    try {
      ws?.close();
    } catch {
      // ignore
    }
    ws = null;
  }

  const scheduleReconnect = (reason: string, immediate = false) => {
    if (shuttingDown) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    try {
      setTray('reconnecting');
    } catch {
      // ignore
    }
    if (immediate) {
      reconnectAttempt = 0;
      void connectLoop('manual');
      return;
    }
    reconnectAttempt += 1;
    const base = Math.min(30_000, 750 * Math.pow(2, Math.min(6, reconnectAttempt)));
    const jitter = Math.floor(Math.random() * 500);
    const delay = Math.max(500, base + jitter);
    console.log(`[agent] reconnect scheduled in ${delay}ms (${reason})`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connectLoop('reconnect');
    }, delay);
  };

  trayOnReconnect = () => {
    closeWs();
    scheduleReconnect('tray_reconnect', true);
  };

  const handleDeeplinkPair = async (url: string): Promise<void> => {
    try {
      setTray('reconnecting');
      const version = '0.1.0';
      const parsed = parseVrplikeSignerDeeplink(url);
      const apiBaseUrl = apiBaseFromWsUrl(parsed.wsUrl);
      const exchanged = await exchangeDeeplinkToken({
        apiBaseUrl,
        token: parsed.token,
        legalEntityId: parsed.legalEntityId,
        version,
      });

      if ((exchanged as any)?.status === 'already_connected') {
        console.log('[agent] deeplink: already connected');
        return;
      }

      const prev = loadState(statePath) ?? existingState ?? null;
      saveState(statePath, {
        ...(prev ?? ({} as any)),
        agentId: (exchanged as any).agentId,
        agentSecret: (exchanged as any).agentSecret,
        wssUrl: (exchanged as any).wsUrl,
        certificateRef: prev?.certificateRef,
        legalEntityId: (exchanged as any).legalEntityId,
      });
      existingState = loadState(statePath) ?? existingState;
      wssUrl = (exchanged as any).wsUrl;
      pairingToken = null;

      console.log(`[agent] deeplink paired successfully agentId=${(exchanged as any).agentId}`);
      closeWs();
      scheduleReconnect('deeplink', true);
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[agent] deeplink pair failed: ${msg}`);
      setTray('error', { errorMessage: msg });
    }
  };

  const connectLoop = async (_why: string): Promise<void> => {
    if (shuttingDown) return;
    if (connecting) return;
    connecting = true;
    try {
      existingState = loadState(statePath) ?? existingState;
      wssUrl = argv.wssUrl ?? envWssUrl ?? existingState?.wssUrl ?? wssUrl ?? null;

      if (!wssUrl) {
        setTray('error', { errorMessage: 'Not paired yet' });
        return;
      }

      setTray('reconnecting');
      ws = new WebSocket(wssUrl);

      ws.on('open', () => {
        existingState = loadState(statePath) ?? existingState;
        const canAuth = Boolean(existingState?.agentId && existingState?.agentSecret);

        if (pairingToken && !canAuth) {
          send(ws!, {
            type: 'HELLO_PAIR',
            pairingToken,
            agentInfo: {
              version: '0.1.0',
              hostname: hostname(),
            },
          });
          return;
        }

        if (!canAuth) {
          console.error('[agent] no stored credentials; waiting for deeplink pairing');
          setTray('error', { errorMessage: 'Not paired yet' });
          closeWs();
          return;
        }

        send(ws!, {
          type: 'HELLO_AUTH',
          agentId: existingState!.agentId,
          agentSecret: existingState!.agentSecret,
        });
      });

      wireHandlers({
        ws,
        wssUrl,
        statePath,
        getExistingState: () => loadState(statePath) ?? existingState,
        defaultCertificateRef,
        onReady: () => {
          reconnectAttempt = 0;
          setTray('connected');
        },
        onConnectionLost: (reason) => {
          setTray('reconnecting');
          scheduleReconnect(reason);
        },
      });
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[agent] connect failed: ${msg}`);
      setTray('reconnecting');
      scheduleReconnect('connect_failed');
    } finally {
      connecting = false;
    }
  };

  if (process.platform === 'win32') {
    try {
      const server = await startIpcServer({
        onMessage: async (msg: IpcMessage) => {
          if (msg.type === 'DEEPLINK') {
            await handleDeeplinkPair(msg.url);
            return;
          }
          if (msg.type === 'ARGS') {
            const url = msg.argv.find(isDeeplinkArg) ?? null;
            if (url) await handleDeeplinkPair(url);
            return;
          }
          if (msg.type === 'RECONNECT') {
            closeWs();
            scheduleReconnect('ipc_reconnect', true);
            return;
          }
          if (msg.type === 'QUIT') {
            await gracefulShutdown();
            return;
          }
        },
        log: (l) => console.log(l),
      });
      ipcClose = server.close;
    } catch (e: any) {
      const code = toNonEmptyString(e?.code) ?? '';
      // Another instance won the race (or pipe is in-use): forward deeplink (if any) and exit(0).
      if (code === 'EADDRINUSE' || code === 'EACCES') {
        const msg = computeLauncherForwardMessage(rawArgsAll);
        await trySendIpcMessage({ message: msg, timeoutMs: 500 }).catch(() => void 0);
        return;
      }
      console.error(`[agent] ipc server failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Tray is created ONLY in agent process (never in launcher).
  if (process.platform === 'win32') {
    try {
      tray = await createWindowsTray({
        baseDir,
        logsDir,
        consoleMode: isConsoleMode,
        debug: rawArgsAll.includes('--debug'),
        mode: isInstalledMode ? 'installed' : 'portable',
        onReconnect: () => trayOnReconnect(),
        onQuit: () => trayOnQuit(),
        log: (l) => console.log(l),
      });
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error(`[agent] tray init failed: ${e instanceof Error ? e.message : String(e)}`);
      // Background runtime invariant: tray is mandatory. If we can't start it, do not keep a headless process.
      if (isBackgroundRuntime) {
        try {
          // eslint-disable-next-line no-console
          console.error('[agent] tray is mandatory in --background mode; shutting down');
        } catch {
          // ignore
        }
        await gracefulShutdown();
        return;
      }
      if (isConsoleMode || rawArgsAll.includes('--debug')) {
        // eslint-disable-next-line no-console
        console.error('[agent] tray init failed details', (e as any)?.details);
        throw e;
      }
      tray = null;
    }
  }
  if (tray) {
    tray.setState('reconnecting');
    if (isBackgroundRuntime || isConsoleMode || rawArgsAll.includes('--debug')) {
      await tray.ready;
    } else {
      void tray.ready.catch(() => void 0);
    }
  }

  if (deeplinkArg) {
    await handleDeeplinkPair(deeplinkArg);
  }

  await connectLoop('startup');
}

function wireHandlers(args: {
  ws: WebSocket;
  wssUrl: string;
  statePath: string;
  getExistingState: () => AgentState | null;
  defaultCertificateRef?: string;
  onReady?: () => void;
  onConnectionLost?: (reason: string) => void;
}) {
  const { ws, wssUrl, statePath, getExistingState, defaultCertificateRef } = args;

  ws.on('message', async (data: WebSocket.RawData) => {
    const text = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : '';
    const msg = safeJsonParse(text) as any;
    const type = toNonEmptyString(msg?.type);
    if (!type) return;

    if (type === 'PING') {
      send(ws, { type: 'PONG' });
      return;
    }

    if (type === 'WELCOME') {
      const agentId = toNonEmptyString(msg?.agentId);
      const agentSecret = toNonEmptyString(msg?.agentSecret);
      const organizationId = toNonEmptyString(msg?.organizationId) ?? undefined;
      const legalEntityId = toNonEmptyString(msg?.legalEntityId) ?? undefined;

      if (agentId && agentSecret) {
        const prev = loadState(statePath) ?? getExistingState() ?? null;
        saveState(statePath, {
          ...(prev ?? {}),
          agentId,
          agentSecret,
          wssUrl,
          certificateRef: defaultCertificateRef ?? prev?.certificateRef,
          organizationId,
          legalEntityId,
        });
        console.log(`[agent] paired successfully agentId=${agentId} (state saved to ${statePath})`);
      }
      return;
    }

    if (type === 'READY') {
      console.log('[agent] connected and ready');
      args.onReady?.();
      return;
    }

    if (type === 'SIGN_REQUEST') {
      const requestId = toNonEmptyString(msg?.requestId);
      const operation = toNonEmptyString(msg?.operation);
      if (!requestId || !operation) return;

      const payload = msg?.payload as any;

      if (operation === 'AUTH_CHALLENGE_ATTACHED') {
        const challenge = payload?.challenge;
        const expectedInn = toNonEmptyString(payload?.expectedInn);
        const expectedKpp = toNonEmptyString(payload?.expectedKpp);
        void expectedKpp; // reserved for next phases (KPP-aware filtering)
        const allowRememberSelection = Boolean(payload?.allowRememberSelection);

        // Priority:
        // 1) payload.certificateRef (explicit override),
        // 2) choose from local certs by expectedInn (Windows-first UX),
        // 3) CERTIFICATE_REF env fallback (legacy/dev),
        // 4) no selection => error.
        let certificateRef = toNonEmptyString(payload?.certificateRef) ?? undefined;
        const state = loadState(statePath) ?? getExistingState() ?? null;

        if (!certificateRef && expectedInn) {
          try {
            const certs = await listCertificatesCertmgr(process.env);
            const matches = filterCertificatesByInn(certs, expectedInn);
            const pinned = state?.pinnedThumbprintsByInn?.[expectedInn] ?? undefined;

            const chosen = await chooseCertificateThumbprint({
              expectedInn,
              candidates: matches,
              pinnedThumbprint: pinned,
              allowRememberSelection,
              prompt: async ({ expectedInn, candidates, defaultThumbprint, allowRememberSelection }) => {
                const r = await promptSelectCertificate({
                  expectedInn,
                  candidates: candidates.map((c) => ({ thumbprint: c.thumbprint, subject: c.subject, validTo: c.validTo })),
                  defaultThumbprint,
                  allowRememberSelection,
                });
                return r;
              },
            });

            certificateRef = chosen.thumbprint;
            if (chosen.remember) {
              const current = loadState(statePath) ?? state;
              if (current?.agentId && current?.agentSecret) {
                saveState(statePath, {
                  ...current,
                  pinnedThumbprintsByInn: {
                    ...(current.pinnedThumbprintsByInn ?? {}),
                    [expectedInn]: chosen.thumbprint,
                  },
                });
                // eslint-disable-next-line no-console
                console.log(`[agent] pinned certificate for INN=${expectedInn}: ${chosen.thumbprint}`);
              }
            }
          } catch (e: any) {
            const code = e instanceof SignerError ? e.code : 'CERT_LIST_FAILED';
            const message = e instanceof Error ? e.message : String(e);
            send(ws, {
              type: 'SIGN_RESULT',
              requestId,
              ok: false,
              error: { code, message },
            });
            return;
          }
        }

        if (!certificateRef) {
          certificateRef = defaultCertificateRef;
        }

        if (!isNonEmptyString(challenge)) {
          send(ws, {
            type: 'SIGN_RESULT',
            requestId,
            ok: false,
            error: {
              code: 'INVALID_PAYLOAD',
              message: 'payload.challenge must be a non-empty string',
            },
          });
          return;
        }

        // eslint-disable-next-line no-console
        console.log(`[agent] SIGN_REQUEST requestId=${requestId} operation=${operation} certRef=${certificateRef ?? '-'}`);

        signAuthChallengeAttached(challenge, { certificateRef })
          .then((buf) => {
            // Do not log signature bytes/base64.
            // eslint-disable-next-line no-console
            console.log(`[agent] SIGN_RESULT ok requestId=${requestId} bytes=${buf.length}`);

            send(ws, {
              type: 'SIGN_RESULT',
              requestId,
              ok: true,
              signatureBase64: buf.toString('base64'),
            });
          })
          .catch(async (err: any) => {
            let code: string = err instanceof SignerError ? err.code : 'SIGN_FAILED';
            let message = err instanceof Error ? err.message : String(err);

            if (process.platform === 'win32' && err instanceof SignerError && err.code === 'SIGNING_TOOL_NOT_FOUND') {
              const readiness = await checkWindowsSigningReadiness();
              if (readiness.ok) {
                code = 'SIGNING_TOOL_NOT_FOUND';
                message =
                  'CryptoPro CSP/сертификаты обнаружены, но не найдены утилиты подписи (cryptcp/csptest). Установите CryptoPro Tools. Подпись через CAdESCOM будет добавлена в следующей версии.';
              } else {
                code = readiness.code;
                message = readiness.message;
              }
            }

            // eslint-disable-next-line no-console
            console.error(`[agent] SIGN_RESULT error requestId=${requestId} code=${code}`);
            if (err instanceof SignerError && err.code === 'CRYPTOPRO_NOT_FOUND') {
              printCryptoProNotFound(err.details);
            }

            send(ws, {
              type: 'SIGN_RESULT',
              requestId,
              ok: false,
              error: {
                code,
                message,
              },
            });
          });

        return;
      }

      if (operation === 'DRAFT_DETACHED') {
        // TODO: implemented in next phase (document signing + Astral drafts flow)
        send(ws, {
          type: 'SIGN_RESULT',
          requestId,
          ok: false,
          error: {
            code: 'SIGN_NOT_IMPLEMENTED',
            message: 'DRAFT_DETACHED signing is not implemented yet.',
          },
        });
        return;
      }

      send(ws, {
        type: 'SIGN_RESULT',
        requestId,
        ok: false,
        error: {
          code: 'UNKNOWN_OPERATION',
          message: `Unknown operation: ${operation}`,
        },
      });
      return;
    }
  });

  ws.on('close', (code: number, reason: Buffer) => {
    const r = reason && Buffer.isBuffer(reason) ? reason.toString('utf8') : String(reason || '');
    console.log(`[agent] disconnected code=${code} reason=${r}`);
    args.onConnectionLost?.(`ws_close_${code}`);
  });

  ws.on('error', (err: Error) => {
    console.error('[agent] ws error', err);
    args.onConnectionLost?.(err?.message || 'ws_error');
  });
}

// IMPORTANT:
// - no explicit hard-exit calls (no self-exit after startup)
// - keep agent in foreground of user session (Task Manager, tray)
if (require.main === module) {
  void main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[agent] fatal', err);
  });
}

