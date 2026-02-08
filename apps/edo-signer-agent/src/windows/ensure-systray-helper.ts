import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type EnsureSystrayHelperErrorCode = 'SYSTRAY_HELPER_NOT_FOUND';

function helperError(code: EnsureSystrayHelperErrorCode, details?: Record<string, unknown>): Error {
  const err = new Error(code);
  (err as any).code = code;
  if (details) (err as any).details = details;
  return err;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

async function fileSize(p: string): Promise<number | null> {
  try {
    const st = await fs.promises.stat(p);
    if (!st.isFile()) return null;
    return st.size;
  } catch {
    return null;
  }
}

async function ensureDir(p: string): Promise<void> {
  await fs.promises.mkdir(p, { recursive: true });
}

/**
 * Ensure systray helper binary exists in a writable location and return its path.
 *
 * Windows (portable pkg):
 * - We ship `systray.exe` next to the main exe (best UX).
 * - On startup we copy it into `%APPDATA%\\vrplike-signer\\bin\\systray.exe` and spawn from there.
 * - This avoids spawning from pkg snapshot or node_modules paths.
 *
 * `opts` is primarily for unit tests.
 */
export async function ensureSystrayHelper(opts?: {
  appDataDir?: string | null;
  execPath?: string;
  /**
   * Override for packaged asset path (snapshot) lookup.
   * By default resolves to `../../assets/systray/windows/systray.exe` from this module.
   */
  assetPath?: string;
  /**
   * Optional logger (file logger in background mode).
   * Defaults to console.log.
   */
  log?: (line: string) => void;
}): Promise<string> {
  const checkedPaths: string[] = [];

  const userProfile = String(process.env.USERPROFILE ?? '').trim() || null;
  const homeDrive = String(process.env.HOMEDRIVE ?? '').trim() || null;
  const homePath = String(process.env.HOMEPATH ?? '').trim() || null;

  let appData = String(opts?.appDataDir ?? process.env.APPDATA ?? '').trim() || '';
  if (!appData) {
    if (userProfile) appData = path.join(userProfile, 'AppData', 'Roaming');
    else appData = path.join(os.homedir(), 'AppData', 'Roaming');
  }

  const targetDir = path.join(appData, 'vrplike-signer', 'bin');
  const targetPath = path.join(targetDir, 'systray.exe');

  const execPath = opts?.execPath ?? process.execPath;
  const exeSibling = path.join(path.dirname(execPath), 'systray.exe');
  checkedPaths.push(path.normalize(exeSibling));

  const log = opts?.log ?? console.log;

  const existingSize = await fileSize(targetPath);
  if (existingSize != null && existingSize > 0) {
    // Best-effort guess: if helper exists next to the exe now, likely extracted from EXE_DIR; otherwise from PKG_ASSET.
    const source = (await pathExists(exeSibling)) ? 'EXE_DIR' : 'PKG_ASSET';
    log(`systray helper ready: ${targetPath} size=${existingSize} source=${source}`);
    return targetPath;
  }

  const snapshotAsset =
    opts?.assetPath ??
    // Runtime __dirname is dist/windows, so ../../assets resolves to packageRoot/assets.
    path.resolve(__dirname, '../../assets/systray/windows/systray.exe');
  checkedPaths.push(path.normalize(snapshotAsset));
  checkedPaths.push(path.normalize(targetPath));

  try {
    await ensureDir(targetDir);
  } catch (e: any) {
    throw helperError('SYSTRAY_HELPER_NOT_FOUND', {
      checkedPaths,
      appData,
      userProfile,
      homeDrive,
      homePath,
      targetDir,
      reason: 'ensureDir failed',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // A) Prefer a real file next to the main exe.
  if (await pathExists(exeSibling)) {
    try {
      fs.copyFileSync(exeSibling, targetPath);
    } catch (e: any) {
      throw helperError('SYSTRAY_HELPER_NOT_FOUND', {
        checkedPaths,
        appData,
        userProfile,
        homeDrive,
        homePath,
        targetDir,
        reason: 'copy EXE_DIR failed',
        error: e instanceof Error ? e.message : String(e),
      });
    }

    let size: number;
    try {
      size = fs.statSync(targetPath).size;
    } catch (e: any) {
      throw helperError('SYSTRAY_HELPER_NOT_FOUND', {
        checkedPaths,
        appData,
        userProfile,
        homeDrive,
        homePath,
        targetDir,
        reason: 'stat copied helper failed',
        error: e instanceof Error ? e.message : String(e),
      });
    }

    if (size > 0) {
      log(`systray helper ready: ${targetPath} size=${size} source=EXE_DIR`);
      return targetPath;
    }

    throw helperError('SYSTRAY_HELPER_NOT_FOUND', {
      checkedPaths,
      appData,
      userProfile,
      homeDrive,
      homePath,
      targetDir,
      reason: 'copied EXE_DIR but helper is empty',
      error: `size=${size}`,
    });
  }

  // B) Fallback: pkg snapshot asset. IMPORTANT: copyFileSync does NOT work from snapshot.
  let wroteAsset = false;
  try {
    const buf = fs.readFileSync(snapshotAsset); // pkg can read snapshot assets via readFileSync
    fs.writeFileSync(targetPath, buf);
    wroteAsset = true;
  } catch (e: any) {
    throw helperError('SYSTRAY_HELPER_NOT_FOUND', {
      checkedPaths,
      appData,
      userProfile,
      homeDrive,
      homePath,
      targetDir,
      reason: 'read/write asset failed',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  if (!wroteAsset) {
    throw helperError('SYSTRAY_HELPER_NOT_FOUND', {
      checkedPaths,
      appData,
      userProfile,
      homeDrive,
      homePath,
      targetDir,
      reason: 'read/write asset failed',
      error: 'unknown',
    });
  }

  let size: number;
  try {
    size = fs.statSync(targetPath).size;
  } catch (e: any) {
    throw helperError('SYSTRAY_HELPER_NOT_FOUND', {
      checkedPaths,
      appData,
      userProfile,
      homeDrive,
      homePath,
      targetDir,
      reason: 'stat extracted helper failed',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  if (size > 0) {
    log(`systray helper ready: ${targetPath} size=${size} source=PKG_ASSET`);
    return targetPath;
  }

  throw helperError('SYSTRAY_HELPER_NOT_FOUND', {
    checkedPaths,
    appData,
    userProfile,
    homeDrive,
    homePath,
    targetDir,
    reason: 'asset extracted but helper is empty',
    error: `size=${size}`,
  });
}

