import { spawn, spawnSync, type ChildProcess } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

export type TrayHostStatus = 'CONNECTED' | 'RECONNECTING' | 'ERROR';

export type TrayHostCommand =
  | { type: 'SET_STATUS'; status: TrayHostStatus; tooltip?: string }
  | { type: 'PING' }
  | { type: 'EXIT' };

export type TrayHostEvent =
  | { type: 'TRAY_READY' }
  | { type: 'MENU_CLICK'; id: 'RECONNECT' | 'OPEN_LOGS' | 'QUIT' };

function toNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function safeJsonParseLine(line: string): any | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function normalizePipeNameComponent(v: string): string {
  return String(v ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 96);
}

export function getUserSidWindows(args?: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  run?: (cmd: string, argv: string[]) => { status: number | null; stdout: string; stderr: string };
}): string | null {
  const platform = args?.platform ?? process.platform;
  if (platform !== 'win32') return null;

  const env = args?.env ?? process.env;
  const fromEnv = toNonEmptyString(env.VRPLIKE_USER_SID);
  if (fromEnv) return fromEnv;

  const run =
    args?.run ??
    ((cmd: string, argv: string[]) => {
      try {
        const r = spawnSync(cmd, argv, {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf8',
          maxBuffer: 1024 * 1024,
        });
        return { status: typeof r.status === 'number' ? r.status : null, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? '') };
      } catch (e: any) {
        return { status: 1, stdout: '', stderr: e instanceof Error ? e.message : String(e) };
      }
    });

  // `whoami /user` is available on Windows 10/11 and Windows Server 2019/2022.
  // Prefer CSV output to simplify parsing across locales.
  const r = run('whoami.exe', ['/user', '/fo', 'csv', '/nh']);
  if (r.status !== 0) return null;

  // Example (csv): "DOMAIN\\user","S-1-5-21-...-1001"
  const m = r.stdout.match(/"S-\d-(?:\d+-?)+"/i) ?? r.stdout.match(/\bS-\d-(?:\d+-?)+\b/i);
  if (!m) return null;
  const sid = m[0].replace(/"/g, '').trim();
  return sid.startsWith('S-') ? sid : null;
}

export function computeTrayHostPipeName(args?: {
  platform?: NodeJS.Platform;
  sid?: string | null;
  env?: NodeJS.ProcessEnv;
  usernameFallback?: string | null;
}): string {
  const platform = args?.platform ?? process.platform;
  if (platform !== 'win32') return 'vrplike-signer-tray-nonwin';

  const sid = toNonEmptyString(args?.sid) ?? getUserSidWindows({ platform, env: args?.env }) ?? null;
  if (sid) {
    // Per requirements: include SID to avoid multi-user server collisions.
    return `vrplike-signer-tray-${normalizePipeNameComponent(sid)}`;
  }

  const env = args?.env ?? process.env;
  const userRaw =
    (toNonEmptyString(env.USERDOMAIN) && toNonEmptyString(env.USERNAME) ? `${env.USERDOMAIN}\\${env.USERNAME}` : null) ??
    toNonEmptyString(env.USERNAME) ??
    toNonEmptyString(args?.usernameFallback) ??
    (() => {
      try {
        return os.userInfo().username;
      } catch {
        return null;
      }
    })() ??
    'user';

  return `vrplike-signer-tray-${normalizePipeNameComponent(userRaw)}`;
}

export function namedPipePathWindows(pipeName: string): string {
  return `\\\\.\\pipe\\${pipeName}`;
}

export function resolveWindowsAppDataFallback(env?: NodeJS.ProcessEnv): string {
  const e = env ?? process.env;
  const appData = toNonEmptyString(e.APPDATA);
  if (appData) return appData;

  const userProfile = toNonEmptyString(e.USERPROFILE);
  if (userProfile) return path.join(userProfile, 'AppData', 'Roaming');

  return path.join(os.homedir(), 'AppData', 'Roaming');
}

export function resolveTrayHostPaths(args?: {
  appDataDir?: string | null;
  execPath?: string;
  assetPath?: string;
}): {
  appData: string;
  targetDir: string;
  targetPath: string;
  exeSibling: string;
  snapshotAsset: string;
} {
  const appData = toNonEmptyString(args?.appDataDir) ?? resolveWindowsAppDataFallback();
  const targetDir = path.join(appData, 'vrplike-signer', 'bin');
  const targetPath = path.join(targetDir, 'tray-host.exe');

  const execPath = args?.execPath ?? process.execPath;
  const exeSibling = path.join(path.dirname(execPath), 'tray-host.exe');

  const snapshotAsset =
    args?.assetPath ??
    // Runtime __dirname is dist/windows, so ../../assets resolves to packageRoot/assets.
    path.resolve(__dirname, '../../assets/tray-host/win-x64/tray-host.exe');

  return { appData, targetDir, targetPath, exeSibling, snapshotAsset };
}

function fileSize(p: string): number | null {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return null;
    return st.size;
  } catch {
    return null;
  }
}

function pathExists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export type EnsureTrayHostBinaryErrorCode = 'TRAY_HOST_NOT_FOUND';

function trayHostError(details?: Record<string, unknown>): Error {
  const err = new Error('TRAY_HOST_NOT_FOUND');
  (err as any).code = 'TRAY_HOST_NOT_FOUND' satisfies EnsureTrayHostBinaryErrorCode;
  if (details) (err as any).details = details;
  return err;
}

/**
 * Ensure tray-host.exe exists in a writable location and return its path.
 *
 * Windows (portable pkg):
 * - tray-host.exe is shipped inside pkg assets (snapshot).
 * - On startup we extract it to `%APPDATA%\\vrplike-signer\\bin\\tray-host.exe` and spawn from there.
 */
export async function ensureTrayHostBinary(opts?: {
  platform?: NodeJS.Platform;
  appDataDir?: string | null;
  execPath?: string;
  assetPath?: string;
  log?: (line: string) => void;
}): Promise<string> {
  const platform = opts?.platform ?? process.platform;
  if (platform !== 'win32') {
    throw trayHostError({ reason: 'non-windows' });
  }

  const log = opts?.log ?? (() => void 0);
  const checkedPaths: string[] = [];

  const paths = resolveTrayHostPaths({ appDataDir: opts?.appDataDir, execPath: opts?.execPath, assetPath: opts?.assetPath });
  checkedPaths.push(path.normalize(paths.exeSibling));
  checkedPaths.push(path.normalize(paths.snapshotAsset));
  checkedPaths.push(path.normalize(paths.targetPath));

  const existingSize = fileSize(paths.targetPath);
  if (existingSize != null && existingSize > 0) {
    const source = pathExists(paths.exeSibling) ? 'EXE_DIR' : 'PKG_ASSET';
    log(`tray-host ready: ${paths.targetPath} size=${existingSize} source=${source}`);
    return paths.targetPath;
  }

  try {
    fs.mkdirSync(paths.targetDir, { recursive: true });
  } catch (e: any) {
    throw trayHostError({
      checkedPaths,
      appData: paths.appData,
      targetDir: paths.targetDir,
      reason: 'ensureDir failed',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // A) Prefer a real file next to the main exe (dev / special distributions).
  if (pathExists(paths.exeSibling)) {
    try {
      fs.copyFileSync(paths.exeSibling, paths.targetPath);
      const size = fileSize(paths.targetPath) ?? 0;
      if (size > 0) {
        log(`tray-host ready: ${paths.targetPath} size=${size} source=EXE_DIR`);
        return paths.targetPath;
      }
      throw new Error(`copied EXE_DIR but size=${size}`);
    } catch (e: any) {
      throw trayHostError({
        checkedPaths,
        appData: paths.appData,
        targetDir: paths.targetDir,
        reason: 'copy EXE_DIR failed',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // B) Extract from pkg asset (snapshot). IMPORTANT: copyFileSync does NOT work from snapshot.
  let buf: Buffer;
  try {
    buf = fs.readFileSync(paths.snapshotAsset);
  } catch (e: any) {
    throw trayHostError({
      checkedPaths,
      appData: paths.appData,
      targetDir: paths.targetDir,
      reason: 'read asset failed',
      error: e instanceof Error ? e.message : String(e),
    });
  }
  try {
    fs.writeFileSync(paths.targetPath, buf);
  } catch (e: any) {
    throw trayHostError({
      checkedPaths,
      appData: paths.appData,
      targetDir: paths.targetDir,
      reason: 'write extracted exe failed',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  const size = fileSize(paths.targetPath) ?? 0;
  if (size > 0) {
    log(`tray-host ready: ${paths.targetPath} size=${size} source=PKG_ASSET`);
    return paths.targetPath;
  }

  throw trayHostError({
    checkedPaths,
    appData: paths.appData,
    targetDir: paths.targetDir,
    reason: 'asset extracted but tray-host is empty',
    error: `size=${size}`,
  });
}

export type TrayHostConnection = {
  ready: Promise<void>;
  send: (cmd: TrayHostCommand) => void;
  close: () => void;
};

export async function connectToTrayHost(args: {
  pipeName: string;
  onEvent: (ev: TrayHostEvent) => void;
  log?: (line: string) => void;
  connectImpl?: typeof net.connect;
}): Promise<TrayHostConnection> {
  const log = args.log ?? (() => void 0);

  const pipePath = namedPipePathWindows(args.pipeName);
  log(`tray-host: connect pipe=${pipePath}`);

  let socket: net.Socket | null = null;
  let buf = '';
  let closed = false;

  let resolveReady: (() => void) | undefined;
  let rejectReady: ((e: any) => void) | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const connectOnce = () =>
    new Promise<void>((resolve, reject) => {
      if (closed) return reject(new Error('TRAY_CONN_CLOSED'));

      const s = (args.connectImpl ?? net.connect)(pipePath);
      socket = s;
      s.setEncoding('utf8');

      const t = setTimeout(() => {
        try {
          s.destroy();
        } catch {
          // ignore
        }
        reject(new Error('TRAY_PIPE_TIMEOUT'));
      }, 1500);

      s.on('connect', () => {
        clearTimeout(t);
        resolve();
      });
      s.on('error', (e) => {
        clearTimeout(t);
        reject(e);
      });

      s.on('data', (chunk) => {
        buf += String(chunk ?? '');
        while (buf.includes('\n')) {
          const idx = buf.indexOf('\n');
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          const msg = safeJsonParseLine(line);
          const type = toNonEmptyString(msg?.type);
          if (!type) continue;
          if (type === 'TRAY_READY') {
            if (resolveReady) resolveReady();
            continue;
          }
          if (type === 'MENU_CLICK') {
            const id = toNonEmptyString(msg?.id);
            if (id === 'RECONNECT' || id === 'OPEN_LOGS' || id === 'QUIT') args.onEvent({ type: 'MENU_CLICK', id });
            continue;
          }
        }
      });

      s.on('close', () => {
        socket = null;
        if (!closed) {
          // If tray connection dies before READY, fail fast.
          if (rejectReady) rejectReady(new Error('TRAY_PIPE_CLOSED'));
        }
      });
    });

  // Retry connect for a short window: tray-host may need a moment to start (autorun / installer race).
  const startedAt = Date.now();
  while (true) {
    try {
      await connectOnce();
      break;
    } catch (e: any) {
      if (Date.now() - startedAt > 10_000) {
        if (rejectReady) rejectReady(e);
        throw e;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  const send = (cmd: TrayHostCommand) => {
    if (!socket || closed) return;
    try {
      socket.write(JSON.stringify(cmd) + '\n');
    } catch {
      // ignore
    }
  };

  const close = () => {
    if (closed) return;
    closed = true;
    try {
      socket?.end();
    } catch {
      // ignore
    }
    try {
      socket?.destroy();
    } catch {
      // ignore
    }
    socket = null;
  };

  return { ready, send, close };
}

export async function startTrayHostAndConnect(args: {
  pipeName: string;
  appData: string;
  trayHostExe: string;
  onEvent: (ev: TrayHostEvent) => void;
  log?: (line: string) => void;
  spawnImpl?: typeof spawn;
  connectImpl?: typeof net.connect;
}): Promise<{ child: ChildProcess; conn: TrayHostConnection }> {
  const log = args.log ?? (() => void 0);

  const child = (args.spawnImpl ?? spawn)(args.trayHostExe, ['--pipe', args.pipeName, '--appData', args.appData, '--parentPid', String(process.pid)], {
    windowsHide: true,
    detached: false,
    stdio: 'ignore',
    shell: false,
  });

  const pipePath = namedPipePathWindows(args.pipeName);
  log(`tray-host: spawned pid=${child.pid ?? 'n/a'} pipe=${pipePath}`);

  const conn = await connectToTrayHost({
    pipeName: args.pipeName,
    onEvent: args.onEvent,
    log: args.log,
    connectImpl: args.connectImpl,
  });

  return { child, conn };
}

