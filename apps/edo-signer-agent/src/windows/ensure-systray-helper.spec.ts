import * as os from 'os';
import * as path from 'path';

describe('windows/ensure-systray-helper', () => {
  const realFs = jest.requireActual<typeof import('fs')>('fs');
  const envSnapshot = { ...process.env };

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
    jest.unmock('fs');
    for (const k of Object.keys(process.env)) delete (process.env as any)[k];
    Object.assign(process.env, envSnapshot);
  });

  test('throws SYSTRAY_HELPER_NOT_FOUND when no helper is available', async () => {
    const tmp = await fsTempDir('systray-helper-missing');

    const { ensureSystrayHelper } = await import('./ensure-systray-helper');
    await expect(
      ensureSystrayHelper({
        appDataDir: tmp.appData,
        execPath: path.join(tmp.exeDir, 'vrplike-signer.exe'),
        assetPath: path.join(tmp.assetDir, 'systray.exe'),
      }),
    ).rejects.toThrow('SYSTRAY_HELPER_NOT_FOUND');
  });

  test('resolves APPDATA fallback via USERPROFILE when APPDATA is empty', async () => {
    const tmp = await fsTempDir('systray-helper-appdata-fallback');
    const userProfile = path.join(tmp.root, 'UserProfile');
    realFs.mkdirSync(userProfile, { recursive: true });

    process.env.APPDATA = '   ';
    process.env.USERPROFILE = userProfile;

    const exeSibling = path.join(tmp.exeDir, 'systray.exe');
    realFs.writeFileSync(exeSibling, 'dummy', 'utf8');

    const { ensureSystrayHelper } = await import('./ensure-systray-helper');
    const p = await ensureSystrayHelper({
      execPath: path.join(tmp.exeDir, 'vrplike-signer.exe'),
      assetPath: path.join(tmp.assetDir, 'systray.exe'), // intentionally missing
    });

    const expected = path.join(userProfile, 'AppData', 'Roaming', 'vrplike-signer', 'bin', 'systray.exe');
    expect(p).toBe(expected);
    expect(realFs.existsSync(p)).toBe(true);
  });

  test('ensureDir failure throws with details (appData/targetDir/reason)', async () => {
    const tmp = await fsTempDir('systray-helper-ensure-dir-fail');

    jest.doMock('fs', () => {
      const actual = jest.requireActual<typeof import('fs')>('fs');
      return {
        ...actual,
        promises: {
          ...actual.promises,
          mkdir: jest.fn(async () => {
            throw new Error('mkdir failed');
          }),
        },
      };
    });

    const { ensureSystrayHelper } = await import('./ensure-systray-helper');

    try {
      await ensureSystrayHelper({
        appDataDir: tmp.appData,
        execPath: path.join(tmp.exeDir, 'vrplike-signer.exe'),
        assetPath: path.join(tmp.assetDir, 'systray.exe'),
      });
      throw new Error('expected ensureSystrayHelper to throw');
    } catch (e: any) {
      expect(e?.message).toBe('SYSTRAY_HELPER_NOT_FOUND');
      expect(e?.details?.appData).toBe(tmp.appData);
      expect(e?.details?.targetDir).toBe(path.join(tmp.appData, 'vrplike-signer', 'bin'));
      expect(e?.details?.reason).toBe('ensureDir failed');
      expect(typeof e?.details?.error).toBe('string');
      expect(Array.isArray(e?.details?.checkedPaths)).toBe(true);
    }
  });

  test('returns path when helper exists next to exe', async () => {
    const tmp = await fsTempDir('systray-helper-exe-sibling');

    const exeSibling = path.join(tmp.exeDir, 'systray.exe');
    realFs.writeFileSync(exeSibling, 'dummy', 'utf8');

    const { ensureSystrayHelper } = await import('./ensure-systray-helper');
    const p = await ensureSystrayHelper({
      appDataDir: tmp.appData,
      execPath: path.join(tmp.exeDir, 'vrplike-signer.exe'),
      assetPath: path.join(tmp.assetDir, 'systray.exe'), // intentionally missing
    });

    expect(p).toBe(path.join(tmp.appData, 'vrplike-signer', 'bin', 'systray.exe'));
    expect(realFs.existsSync(p)).toBe(true);
  });

  test('extracts helper from pkg asset using readFileSync + writeFileSync', async () => {
    const tmp = await fsTempDir('systray-helper-pkg-asset');

    const assetPath = path.join(tmp.assetDir, 'systray.exe');
    // Keep a placeholder file on disk; contents are controlled via the readFileSync mock.
    realFs.writeFileSync(assetPath, 'placeholder', 'utf8');

    const buf = Buffer.from('dummy-systray-binary');
    jest.doMock('fs', () => {
      const actual = jest.requireActual<typeof import('fs')>('fs');
      return {
        ...actual,
        readFileSync: jest.fn(() => buf),
        writeFileSync: jest.fn((...args: any[]) => (actual as any).writeFileSync(...args)),
      };
    });

    const { ensureSystrayHelper } = await import('./ensure-systray-helper');
    const mockedFs = await import('fs');

    const p = await ensureSystrayHelper({
      appDataDir: tmp.appData,
      execPath: path.join(tmp.exeDir, 'vrplike-signer.exe'),
      assetPath,
    });

    const targetPath = path.join(tmp.appData, 'vrplike-signer', 'bin', 'systray.exe');
    expect(p).toBe(targetPath);
    expect((mockedFs as any).readFileSync).toHaveBeenCalledWith(assetPath);
    expect((mockedFs as any).writeFileSync).toHaveBeenCalledWith(targetPath, buf);
    expect(realFs.existsSync(targetPath)).toBe(true);
    expect(realFs.statSync(targetPath).size).toBeGreaterThan(0);
  });
});

async function fsTempDir(prefix: string): Promise<{ root: string; exeDir: string; appData: string; assetDir: string }> {
  const root = await (await import('fs/promises')).mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  const exeDir = path.join(root, 'exe');
  const appData = path.join(root, 'appdata');
  const assetDir = path.join(root, 'assets');
  const { mkdir } = await import('fs/promises');
  await mkdir(exeDir, { recursive: true });
  await mkdir(appData, { recursive: true });
  await mkdir(assetDir, { recursive: true });
  return { root, exeDir, appData, assetDir };
}

