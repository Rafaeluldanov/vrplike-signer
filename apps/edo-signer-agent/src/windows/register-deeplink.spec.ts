import { ensureVrplikeSignerDeeplinkRegisteredWindows } from './register-deeplink';

describe('ensureVrplikeSignerDeeplinkRegisteredWindows', () => {
  test('does nothing on non-windows platform', async () => {
    const calls: string[][] = [];
    await ensureVrplikeSignerDeeplinkRegisteredWindows({
      platform: 'linux',
      runReg: async (args) => {
        calls.push(args);
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });
    expect(calls).toEqual([]);
  });

  test('skips registration when key exists', async () => {
    const calls: string[][] = [];
    await ensureVrplikeSignerDeeplinkRegisteredWindows({
      platform: 'win32',
      log: () => void 0,
      runReg: async (args) => {
        calls.push(args);
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      },
    });
    expect(calls).toEqual([['query', 'HKCU\\Software\\Classes\\vrplike-signer\\shell\\open\\command']]);
  });

  test('registers protocol when key is missing', async () => {
    const calls: string[][] = [];
    const logs: string[] = [];
    let first = true;

    await ensureVrplikeSignerDeeplinkRegisteredWindows({
      platform: 'win32',
      exePath: 'C:\\Users\\me\\Downloads\\vrplike-signer.exe',
      log: (l) => logs.push(l),
      runReg: async (args) => {
        calls.push(args);
        if (first) {
          first = false;
          return { exitCode: 1, stdout: '', stderr: 'not found' };
        }
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });

    expect(calls).toEqual([
      ['query', 'HKCU\\Software\\Classes\\vrplike-signer\\shell\\open\\command'],
      ['add', 'HKCU\\Software\\Classes\\vrplike-signer', '/ve', '/t', 'REG_SZ', '/d', 'URL:vrplike signer', '/f'],
      ['add', 'HKCU\\Software\\Classes\\vrplike-signer', '/v', 'URL Protocol', '/t', 'REG_SZ', '/d', '', '/f'],
      [
        'add',
        'HKCU\\Software\\Classes\\vrplike-signer\\shell\\open\\command',
        '/ve',
        '/t',
        'REG_SZ',
        '/d',
        '"C:\\Users\\me\\Downloads\\vrplike-signer.exe" "%1"',
        '/f',
      ],
    ]);
    expect(logs.join('\n')).toMatch(/Deep link protocol registered/i);
  });
});
