/* eslint-disable no-underscore-dangle */
/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Local fixed adapter for `systray2` for Windows pkg.
 *
 * Motivation:
 * - In `pkg`-packaged exe on Windows, `systray2` may spawn its helper process without stdio pipes,
 *   causing `this._process.stdin` to be null and crash with:
 *   `TypeError: Cannot read properties of null (reading 'stdin') at SysTray.writeLine`.
 *
 * Fix:
 * - Always spawn tray helper with `stdio: ["pipe", "pipe", "pipe"]`.
 * - If stdin is still missing, throw `SYSTRAY_SPAWN_NO_STDIN`.
 *
 * Notes:
 * - On Windows we spawn a vendored `systray.exe` helper (shipped as a pkg asset),
 *   extracted into `%APPDATA%\\vrplike-signer\\bin` by `ensureSystrayHelper()`.
 * - This file is intentionally a minimal TS port of `systray2/index.js` (2.1.x) with the spawn fix.
 */
import * as child from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';

import { ensureSystrayHelper } from './ensure-systray-helper';

export type Systray2FixedErrorCode = 'SYSTRAY_SPAWN_NO_STDIN' | 'SYSTRAY_HELPER_NOT_FOUND';

function systrayError(code: Systray2FixedErrorCode, details?: Record<string, unknown>): Error {
  const err = new Error(code);
  (err as any).code = code;
  if (details) (err as any).details = details;
  return err;
}

function debugLog(msgType: string, ...msg: unknown[]): void {
  // Keep behavior similar to upstream systray2.
  // eslint-disable-next-line no-console
  console.log(
    `${msgType}:${msg
      .map((m) => {
        let t = typeof m === 'string' ? m : JSON.stringify(m);
        const p = t.indexOf('"icon":');
        if (p >= 0) {
          const e = t.indexOf('"', p + 8);
          t = t.substring(0, p + 8) + '<ICON>' + t.substring(e);
        }
        const limit = 500;
        if (t.length > limit) t = t.substring(0, limit / 2) + '...' + t.substring(t.length - limit / 2);
        return t;
      })
      .join(' ')}`
  );
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(p: string): Promise<void> {
  await fs.promises.mkdir(p, { recursive: true });
}

async function copyFile(src: string, dest: string): Promise<void> {
  await fs.promises.copyFile(src, dest);
}

function tryGetSystray2Version(): string | null {
  try {
    // Using require() to avoid tsconfig `resolveJsonModule` requirement.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require('systray2/package.json') as any;
    return typeof pkg?.version === 'string' && pkg.version.trim() ? pkg.version.trim() : null;
  } catch {
    return null;
  }
}

function resolveSystrayModuleDir(pkgName: 'systray2' | 'systray-portable'): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const main = require.resolve(pkgName) as string;
    return path.dirname(main);
  } catch {
    return null;
  }
}

async function getTrayBinPath(debug = false, copyDir: SysTrayConfig['copyDir'] = false): Promise<string> {
  let binName: string;
  switch (process.platform) {
    case 'win32':
      binName = `tray_windows${debug ? '' : '_release'}.exe`;
      break;
    case 'darwin':
      binName = `tray_darwin${debug ? '' : '_release'}`;
      break;
    case 'linux':
      binName = `tray_linux${debug ? '' : '_release'}`;
      break;
    default:
      throw new Error(`SYSTRAY_UNSUPPORTED_PLATFORM (${process.platform})`);
  }

  // Upstream systray2 also supports "./traybin/*" (relative to cwd). Keep as a best-effort fallback.
  let binPath = path.join('.', 'traybin', binName);
  if (!(await pathExists(binPath))) {
    const systray2Dir = resolveSystrayModuleDir('systray2') ?? resolveSystrayModuleDir('systray-portable');
    if (!systray2Dir) {
      throw new Error(`SYSTRAY2_TRAYBIN_NOT_FOUND (${binName})`);
    }
    binPath = path.join(systray2Dir, 'traybin', binName);
  }

  if (!copyDir) return binPath;

  const version = tryGetSystray2Version() ?? 'unknown';
  const targetDir =
    typeof copyDir === 'string' && copyDir.trim()
      ? copyDir.trim()
      : path.join(os.homedir(), '.cache', 'node-systray', version);
  const copyDistPath = path.join(targetDir, binName);

  try {
    // If file exists - keep it.
    await fs.promises.stat(copyDistPath);
    return copyDistPath;
  } catch {
    // Need to copy.
    await ensureDir(targetDir);
    await copyFile(binPath, copyDistPath);
    return copyDistPath;
  }
}

const CHECK_STR = ' (√)';
function updateCheckedInLinux(item: MenuItem): void {
  if (process.platform !== 'linux') return;
  if (item.checked) item.title += CHECK_STR;
  else item.title = (item.title || '').replace(RegExp(CHECK_STR + '$'), '');
  if (item.items != null) item.items.forEach(updateCheckedInLinux);
}

export type MenuItem = {
  title: string;
  tooltip?: string;
  checked: boolean;
  enabled?: boolean;
  hidden?: boolean;
  items?: MenuItem[];
  icon?: string;
  isTemplateIcon?: boolean;
  __id?: number;
};

export type Menu = {
  icon?: string;
  title: string;
  tooltip?: string;
  items: MenuItem[];
  isTemplateIcon?: boolean;
};

export type SysTrayConfig = {
  menu: Menu;
  debug?: boolean;
  copyDir?: boolean | string;
};

type ActionClicked = { type: 'clicked'; __id: number; item?: Partial<MenuItem> };
type ActionReady = { type: 'ready' };
type ActionExit = { type: 'exit' };
type ActionUpdateItem = { type: 'update-item'; item: MenuItem; seq_id?: number };
type ActionUpdateMenu = { type: 'update-menu'; menu: Menu };
type ActionUpdateMenuAndItem = { type: 'update-menu-and-item'; menu: Menu; item: MenuItem; seq_id?: number };
export type Action = ActionClicked | ActionReady | ActionExit | ActionUpdateItem | ActionUpdateMenu | ActionUpdateMenuAndItem;

async function loadIcon(fileName: string): Promise<string> {
  const buffer = await fs.promises.readFile(fileName);
  return buffer.toString('base64');
}

async function resolveIconForItem(item: MenuItem): Promise<MenuItem> {
  const icon = item.icon;
  if (icon != null && (await pathExists(icon))) {
    item.icon = await loadIcon(icon);
  }
  if (item.items != null) {
    await Promise.all(item.items.map((_) => resolveIconForItem(_)));
  }
  return item;
}

async function resolveIconForMenu(menu: Menu): Promise<Menu> {
  const icon = menu.icon;
  if (icon != null && (await pathExists(icon))) {
    menu.icon = await loadIcon(icon);
  }
  await Promise.all(menu.items.map((_) => resolveIconForItem(_)));
  return menu;
}

function addInternalId(internalIdMap: Map<number, MenuItem>, item: MenuItem, counter: { id: number } = { id: 1 }): void {
  const id = counter.id++;
  internalIdMap.set(id, item);
  if (item.items != null) item.items.forEach((_) => addInternalId(internalIdMap, _, counter));
  item.__id = id;
}

function itemTrimmer(item: MenuItem): MenuItem {
  return {
    title: item.title,
    tooltip: item.tooltip,
    checked: item.checked,
    enabled: item.enabled === undefined ? true : item.enabled,
    hidden: item.hidden,
    items: item.items,
    icon: item.icon,
    isTemplateIcon: item.isTemplateIcon,
    __id: item.__id,
  };
}

function menuTrimmer(menu: Menu): Menu {
  return {
    icon: menu.icon,
    title: menu.title,
    tooltip: menu.tooltip,
    items: menu.items.map(itemTrimmer),
    isTemplateIcon: menu.isTemplateIcon,
  };
}

function actionTrimmer(action: Action): unknown {
  if (action.type === 'update-item') {
    return { type: action.type, item: itemTrimmer(action.item), seq_id: action.seq_id };
  }
  if (action.type === 'update-menu') {
    return { type: action.type, menu: menuTrimmer(action.menu) };
  }
  if (action.type === 'update-menu-and-item') {
    return { type: action.type, item: itemTrimmer(action.item), menu: menuTrimmer(action.menu), seq_id: action.seq_id };
  }
  return { type: action.type };
}

export default class SysTray {
  static separator: MenuItem = {
    title: '<SEPARATOR>',
    tooltip: '',
    enabled: true,
    checked: false,
  };

  internalIdMap = new Map<number, MenuItem>();
  private _conf: SysTrayConfig;
  private _process: child.ChildProcess | null = null;
  private _rl: readline.Interface | null = null;
  private _binPath: string | null = null;
  private _binPathReady: Promise<string>;
  private _binPathReadyResolve: ((p: string) => void) | null = null;
  private _binPathReadyReject: ((err: unknown) => void) | null = null;
  private _ready: Promise<void>;

  constructor(conf: SysTrayConfig) {
    this._conf = conf;
    this._binPathReady = new Promise<string>((resolve, reject) => {
      this._binPathReadyResolve = resolve;
      this._binPathReadyReject = reject;
    });
    this._ready = this.init();
  }

  get process(): child.ChildProcess | null {
    return this._process;
  }

  get killed(): boolean {
    return Boolean(this._process?.killed);
  }

  get binPath(): string | null {
    return this._binPath;
  }

  binPathReady(): Promise<string> {
    return this._binPathReady;
  }

  private async init(): Promise<void> {
    const conf = this._conf;
    let binPath: string;
    if (process.platform === 'win32') {
      // Windows pkg: always spawn the extracted helper from disk (no node_modules/snapshot spawn).
      try {
        binPath = await ensureSystrayHelper();
      } catch (err: any) {
        this._binPathReadyReject?.(err);
        this._binPathReadyResolve = null;
        this._binPathReadyReject = null;

        const details =
          err && typeof err === 'object' && 'details' in err && (err as any).details && typeof (err as any).details === 'object'
            ? ((err as any).details as Record<string, unknown>)
            : {};
        const originalCode = err && typeof err === 'object' && 'code' in err ? String((err as any).code ?? '') : '';
        const originalMessage = err instanceof Error ? err.message : String(err);

        throw systrayError('SYSTRAY_HELPER_NOT_FOUND', {
          ...details,
          binPathAttempted: true,
          originalCode,
          originalMessage,
        });
      }

      this._binPath = binPath;
      this._binPathReadyResolve?.(binPath);
      this._binPathReadyResolve = null;
      this._binPathReadyReject = null;

      if (!(await pathExists(binPath))) {
        throw systrayError('SYSTRAY_HELPER_NOT_FOUND', { binPath, reason: 'binPath does not exist after ensureSystrayHelper()' });
      }
    } else {
      try {
        binPath = await getTrayBinPath(Boolean(conf.debug), conf.copyDir);
      } catch (err) {
        this._binPathReadyReject?.(err);
        this._binPathReadyResolve = null;
        this._binPathReadyReject = null;
        throw err;
      }
      this._binPath = binPath;
      this._binPathReadyResolve?.(binPath);
      this._binPathReadyResolve = null;
      this._binPathReadyReject = null;
    }

    return await new Promise<void>(async (resolve, reject) => {
      try {
        // Node doesn't have `spawnFile`, so we use `spawn()` with explicit options.
        const spawnStrict = (stdio: child.StdioOptions) =>
          child.spawn(binPath, [], {
            windowsHide: true,
            shell: false,
            detached: false,
            stdio,
            windowsVerbatimArguments: true,
          });

        const mkDebug = (proc: child.ChildProcess) => ({
          binPath,
          pid: proc.pid,
          hasStdin: !!proc.stdin,
          hasStdout: !!proc.stdout,
          hasStderr: !!proc.stderr,
          keys: Object.keys(proc as any),
        });

        // Attempt #1: explicit pipes array (strict).
        let proc = spawnStrict(['pipe', 'pipe', 'pipe']);

        // eslint-disable-next-line no-console
        console.error('SYSTRAY_SPAWN_DEBUG', mkDebug(proc));

        if (!proc.stdin) {
          const debug1 = mkDebug(proc);
          try {
            proc.kill();
          } catch {
            // ignore
          }

          // Fallback #1: stdio as a single "pipe" string.
          proc = spawnStrict('pipe');

          // eslint-disable-next-line no-console
          console.error('SYSTRAY_SPAWN_DEBUG', mkDebug(proc));

          if (!proc.stdin) {
            const debug2 = mkDebug(proc);
            // eslint-disable-next-line no-console
            console.error('SYSTRAY_SPAWN_NO_STDIN', { binPath, debug1, debug2 });
            reject(
              systrayError('SYSTRAY_SPAWN_NO_STDIN', {
                binPath,
                tried: ['spawnFile pipes', 'spawnFile pipe-string'],
                debug: { debug1, debug2 },
              })
            );
            return;
          }
        }

        this._process = proc;
        this._process.on('error', reject);

        // With forced stdio=pipe, stdout should be present. But keep a clear error if it's not.
        if (!this._process.stdout) {
          reject(new Error('SYSTRAY_SPAWN_NO_STDOUT'));
          return;
        }

        this._rl = readline.createInterface({ input: this._process.stdout });

        conf.menu.items.forEach(updateCheckedInLinux);
        const counter = { id: 1 };
        conf.menu.items.forEach((_) => addInternalId(this.internalIdMap, _, counter));
        await resolveIconForMenu(conf.menu);

        if (conf.debug) {
          this._rl.on('line', (data) => debugLog('onLine', data));
        }

        this.onReady(() => {
          this.writeLine(JSON.stringify(menuTrimmer(conf.menu)));
          resolve();
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  ready(): Promise<void> {
    return this._ready;
  }

  onReady(listener: () => void): this {
    if (!this._rl) return this;
    this._rl.on('line', (line) => {
      const action = JSON.parse(line) as Action;
      if (action.type === 'ready') {
        listener();
        if (this._conf.debug) debugLog('onReady', action);
      }
    });
    return this;
  }

  async onClick(listener: (action: any) => void): Promise<this> {
    await this.ready();
    if (!this._rl) return this;
    this._rl.on('line', (line) => {
      const action = JSON.parse(line) as Action;
      if (action.type === 'clicked') {
        const item = this.internalIdMap.get(action.__id);
        if (item) {
          (action as any).item = Object.assign(item, (action as any).item);
        }
        if (this._conf.debug) debugLog('onClick', action);
        listener(action);
      }
    });
    return this;
  }

  writeLine(line: string): this {
    if (line) {
      if (this._conf.debug) debugLog('writeLine', line + '\n', '=====');
      if (!this._process?.stdin) {
        throw systrayError('SYSTRAY_SPAWN_NO_STDIN', { binPath: this._binPath ?? '<unknown>' });
      }
      this._process.stdin.write(line.trim() + '\n');
    }
    return this;
  }

  async sendAction(action: Action): Promise<this> {
    if (action.type === 'update-item') {
      updateCheckedInLinux(action.item);
      if (action.seq_id == null) action.seq_id = -1;
    } else if (action.type === 'update-menu' || action.type === 'update-menu-and-item') {
      await resolveIconForMenu((action as any).menu);
      (action as any).menu.items.forEach(updateCheckedInLinux);
      if (action.type === 'update-menu-and-item') {
        updateCheckedInLinux((action as any).item);
        if ((action as any).seq_id == null) (action as any).seq_id = -1;
      }
    }

    if (this._conf.debug) debugLog('sendAction', action);
    this.writeLine(JSON.stringify(actionTrimmer(action) as any));
    return this;
  }

  onExit(listener: () => void): void {
    this._process?.on('exit', listener);
  }

  onError(listener: (err: Error) => void): void {
    this._process?.on('error', (err: any) => {
      if (this._conf.debug) debugLog('onError', err, 'binPath', this.binPath);
      listener(err);
    });
  }

  /**
   * Kill the systray process
   *
   * @param exitNode Exit current node process after systray process is killed, default is true
   */
  async kill(exitNode = true): Promise<void> {
    await new Promise<void>(async (resolve, reject) => {
      try {
        this.onExit(() => {
          resolve();
          if (exitNode) process.exit(0);
        });
        await this.sendAction({ type: 'exit' } as Action);
      } catch (e) {
        reject(e);
      }
    });
  }
}

