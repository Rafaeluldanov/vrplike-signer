import { computeBackgroundChildArgs, computeLauncherForwardMessage, sanitizeLauncherArgs, shouldRunLauncher } from './launcher-plan';

describe('launcher-plan', () => {
  test('sanitizeLauncherArgs strips internal flags', () => {
    expect(sanitizeLauncherArgs(['--background', 'a', '--console', 'b'])).toEqual(['a', 'b']);
  });

  test('computeLauncherForwardMessage prefers deeplink', () => {
    const msg = computeLauncherForwardMessage(['--wssUrl', 'wss://x', 'vrplike-signer://pair?token=t&wsUrl=wss%3A%2F%2Fx&le=1']);
    expect(msg).toEqual({ type: 'DEEPLINK', url: 'vrplike-signer://pair?token=t&wsUrl=wss%3A%2F%2Fx&le=1' });
  });

  test('computeLauncherForwardMessage falls back to ARGS', () => {
    const msg = computeLauncherForwardMessage(['--wssUrl', 'wss://x', '--console']);
    expect(msg).toEqual({ type: 'ARGS', argv: ['--wssUrl', 'wss://x'] });
  });

  test('computeBackgroundChildArgs adds --background', () => {
    expect(computeBackgroundChildArgs(['a', '--console', 'b'])).toEqual(['--background', 'a', 'b']);
  });

  test('shouldRunLauncher only for pkg win32 default', () => {
    const prev = (process as any).pkg;
    try {
      (process as any).pkg = { enabled: true };
      expect(shouldRunLauncher({ platform: 'win32', rawArgs: [] })).toBe(true);
      expect(shouldRunLauncher({ platform: 'win32', rawArgs: ['--console'] })).toBe(false);
      expect(shouldRunLauncher({ platform: 'win32', rawArgs: ['--background'] })).toBe(false);
      expect(shouldRunLauncher({ platform: 'linux', rawArgs: [] })).toBe(false);
    } finally {
      (process as any).pkg = prev;
    }
  });
});

