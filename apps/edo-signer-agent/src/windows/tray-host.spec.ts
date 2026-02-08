import { EventEmitter } from 'events';
import * as os from 'os';
import * as path from 'path';

describe('windows/tray-host', () => {
  const realFs = jest.requireActual<typeof import('fs')>('fs');
  const envSnapshot = { ...process.env };

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
    jest.unmock('fs');
    for (const k of Object.keys(process.env)) delete (process.env as any)[k];
    Object.assign(process.env, envSnapshot);
  });

  test('computeTrayHostPipeName includes user SID when available', async () => {
    const { computeTrayHostPipeName } = await import('./tray-host');
    const sid = 'S-1-5-21-111-222-333-1001';
    const name = computeTrayHostPipeName({ platform: 'win32', sid });
    expect(name).toContain('vrplike-signer-tray-');
    expect(name).toContain(sid);
  });

  test('getUserSidWindows parses whoami /user CSV output', async () => {
    const { getUserSidWindows } = await import('./tray-host');
    const sid = 'S-1-5-21-111-222-333-1001';
    const parsed = getUserSidWindows({
      platform: 'win32',
      run: () => ({
        status: 0,
        stdout: `"DOMAIN\\\\user","${sid}"\r\n`,
        stderr: '',
      }),
    });
    expect(parsed).toBe(sid);
  });

  test('ensureTrayHostBinary extracts exe from pkg asset using readFileSync + writeFileSync', async () => {
    const tmp = await fsTempDir('tray-host-asset');
    const assetPath = path.join(tmp.assetDir, 'tray-host.exe');
    realFs.writeFileSync(assetPath, 'placeholder', 'utf8');

    const buf = Buffer.from('dummy-tray-host-binary');
    jest.doMock('fs', () => {
      const actual = jest.requireActual<typeof import('fs')>('fs');
      return {
        ...actual,
        copyFileSync: jest.fn((...args: any[]) => (actual as any).copyFileSync(...args)),
        readFileSync: jest.fn(() => buf),
        writeFileSync: jest.fn((...args: any[]) => (actual as any).writeFileSync(...args)),
      };
    });

    const { ensureTrayHostBinary } = await import('./tray-host');
    const mockedFs = await import('fs');

    const p = await ensureTrayHostBinary({
      platform: 'win32',
      appDataDir: tmp.appData,
      execPath: path.join(tmp.exeDir, 'vrplike-signer.exe'),
      assetPath,
      log: () => void 0,
    });

    const targetPath = path.join(tmp.appData, 'vrplike-signer', 'bin', 'tray-host.exe');
    expect(p).toBe(targetPath);
    expect((mockedFs as any).readFileSync).toHaveBeenCalledWith(assetPath);
    expect((mockedFs as any).writeFileSync).toHaveBeenCalledWith(targetPath, buf);
    expect(realFs.existsSync(targetPath)).toBe(true);
    expect(realFs.statSync(targetPath).size).toBeGreaterThan(0);
  });

  test('startTrayHostAndConnect resolves ready on TRAY_READY and forwards menu clicks', async () => {
    const { startTrayHostAndConnect } = await import('./tray-host');

    const events: any[] = [];
    const fakeChild = { pid: 123, kill: jest.fn() } as any;

    const socket = new FakeSocket();
    const connectImpl = jest.fn(() => {
      process.nextTick(() => {
        socket.emit('connect');
        socket.emit('data', JSON.stringify({ type: 'TRAY_READY' }) + '\n');
      });
      return socket as any;
    });
    const spawnImpl = jest.fn(() => fakeChild);

    const r = await startTrayHostAndConnect({
      pipeName: 'vrplike-signer-tray-S-1-5-21-test',
      appData: 'C:\\\\Users\\\\x\\\\AppData\\\\Roaming',
      trayHostExe: 'C:\\\\tmp\\\\tray-host.exe',
      onEvent: (ev) => events.push(ev),
      spawnImpl: spawnImpl as any,
      connectImpl: connectImpl as any,
      log: () => void 0,
    });

    await expect(r.conn.ready).resolves.toBeUndefined();

    // Simulate menu click.
    socket.emit('data', JSON.stringify({ type: 'MENU_CLICK', id: 'RECONNECT' }) + '\n');
    expect(events).toContainEqual({ type: 'MENU_CLICK', id: 'RECONNECT' });

    r.conn.close();
  });
});

class FakeSocket extends EventEmitter {
  setEncoding(): void {
    // noop
  }
  write(): void {
    // noop
  }
  end(): void {
    // noop
  }
  destroy(): void {
    // noop
  }
}

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

