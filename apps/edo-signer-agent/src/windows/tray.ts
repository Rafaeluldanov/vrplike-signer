import { spawn } from 'child_process';
import { mkdirSync } from 'fs';
import * as path from 'path';

import {
  computeTrayHostPipeName,
  connectToTrayHost,
  ensureTrayHostBinary,
  resolveWindowsAppDataFallback,
  startTrayHostAndConnect,
  type TrayHostStatus,
} from './tray-host';

export type TrayState = 'reconnecting' | 'connected' | 'error';

export type WindowsTray = {
  ready: Promise<void>;
  setState: (state: TrayState, details?: { errorMessage?: string }) => void;
  setStatusText: (text: string) => void;
  kill: () => void;
};

function safeMkdir(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
}

function tryOpenFolderInExplorer(dir: string): void {
  try {
    const child = spawn('explorer.exe', [dir], { windowsHide: true, stdio: 'ignore', detached: true });
    child.unref();
  } catch {
    // ignore
  }
}

export async function createWindowsTray(args: {
  baseDir: string;
  logsDir: string;
  title?: string;
  consoleMode?: boolean;
  debug?: boolean;
  mode?: 'portable' | 'installed';
  onReconnect: () => void;
  onQuit: () => void;
  log?: (line: string) => void;
}): Promise<WindowsTray> {
  const log = args.log ?? (() => void 0);
  const debug = Boolean(args.debug);
  const consoleMode = Boolean(args.consoleMode);
  const mode = args.mode ?? 'portable';

  log('tray: starting');

  if (process.platform !== 'win32') {
    return {
      ready: Promise.resolve(),
      setState: () => void 0,
      setStatusText: () => void 0,
      kill: () => void 0,
    };
  }

  // Keep this call for backwards-compat (used by other parts of the agent).
  safeMkdir(path.join(args.baseDir, 'traybin'));

  const appData = resolveWindowsAppDataFallback();
  const pipeName = computeTrayHostPipeName({ platform: 'win32' });

  let lastState: TrayState = 'reconnecting';
  let lastStatusText = '';

  const toTooltip = (state: TrayState, details?: { errorMessage?: string }) => {
    const base =
      state === 'connected' ? 'vrplike Signer — подключён' : state === 'error' ? 'vrplike Signer — ошибка' : 'vrplike Signer — переподключение';
    const withError = state === 'error' && details?.errorMessage ? `${base}: ${details.errorMessage}` : base;
    return lastStatusText ? `${withError} (${lastStatusText})` : withError;
  };

  const toHostStatus = (s: TrayState): TrayHostStatus => (s === 'connected' ? 'CONNECTED' : s === 'error' ? 'ERROR' : 'RECONNECTING');

  const onEvent = (ev: any) => {
    try {
      if (ev.type === 'TRAY_READY') return;
      if (ev.type === 'MENU_CLICK') {
        if (ev.id === 'RECONNECT') {
          args.onReconnect();
          return;
        }
        if (ev.id === 'OPEN_LOGS') {
          tryOpenFolderInExplorer(args.logsDir);
          return;
        }
        if (ev.id === 'QUIT') {
          args.onQuit();
          return;
        }
      }
    } catch (e: any) {
      log(`tray: event handler failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const spawnedChild: { kill: () => void } | null = mode === 'portable' ? { kill: () => void 0 } : null;

  const conn =
    mode === 'installed'
      ? await (async () => {
          try {
            return await connectToTrayHost({
              pipeName,
              onEvent,
              log: (l) => log(l),
            });
          } catch (e: any) {
            // Best-effort fallback: tray-host may not be running (misconfigured autorun / manual start).
            // Start it WITHOUT parentPid so the tray can keep running independently.
            const exe = path.join(path.dirname(process.execPath), 'vrplike-signer-tray.exe');
            log(`tray: connect failed; trying to start installed tray-host: ${exe}`);
            try {
              const child = spawn(exe, ['--pipe', pipeName, '--appData', appData], {
                windowsHide: true,
                detached: false,
                stdio: 'ignore',
                shell: false,
              });
              void child;
            } catch {
              // ignore and retry connect
            }
            return await connectToTrayHost({
              pipeName,
              onEvent,
              log: (l) => log(l),
            });
          }
        })()
      : await (async () => {
          const trayHostExe = await ensureTrayHostBinary({ log: (l) => log(`tray: ${l}`) });
          const { child, conn } = await startTrayHostAndConnect({
            pipeName,
            appData,
            trayHostExe,
            onEvent,
            log: (l) => log(l),
          });
          if (spawnedChild) spawnedChild.kill = () => child.kill();
          return conn;
        })().catch((err: any) => {
          const msg = err instanceof Error ? err.message : String(err);
          log(`tray: error ${msg}`);
          if (consoleMode || debug) {
            // eslint-disable-next-line no-console
            console.error('tray: error details', (err as any)?.details);
          }
          throw err;
        });

  const ready = conn.ready
    .then(() => {
      log('tray: started');
      // Initial status (best effort).
      conn.send({ type: 'SET_STATUS', status: 'RECONNECTING', tooltip: 'vrplike Signer — переподключение' });
    })
    .catch((err: any) => {
      const msg = err instanceof Error ? err.message : String(err);
      log(`tray: ready failed ${msg}`);
      throw err;
    });

  const apply = (state: TrayState, details?: { errorMessage?: string }) => {
    lastState = state;
    const tooltip = toTooltip(state, details);
    try {
      conn.send({ type: 'SET_STATUS', status: toHostStatus(state), tooltip });
    } catch (e: any) {
      log(`tray update failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return {
    ready,
    setState: (state, details) => apply(state, details),
    setStatusText: (text) => {
      lastStatusText = String(text ?? '').trim();
      apply(lastState);
    },
    kill: () => {
      try {
        conn.close();
      } catch {
        // ignore
      }
      // In installed mode tray-host is not a child process; do not kill it.
      if (mode === 'portable') {
        try {
          conn.send({ type: 'EXIT' });
        } catch {
          // ignore
        }
        try {
          spawnedChild?.kill();
        } catch {
          // ignore
        }
      }
    },
  };
}

