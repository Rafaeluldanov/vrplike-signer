import { type IpcMessage } from './windows/ipc';

export function isDeeplinkArg(a: unknown): a is string {
  return typeof a === 'string' && a.startsWith('vrplike-signer://');
}

export function sanitizeLauncherArgs(rawArgs: string[]): string[] {
  // Launcher owns the lifecycle; it spawns a detached background child.
  // Strip internal flags if someone passes them accidentally.
  return rawArgs.filter((a) => a !== '--background' && a !== '--console');
}

export function computeLauncherForwardMessage(rawArgs: string[]): IpcMessage {
  const args = sanitizeLauncherArgs(rawArgs);
  const deeplink = args.find(isDeeplinkArg) ?? null;
  if (deeplink) return { type: 'DEEPLINK', url: deeplink };
  return { type: 'ARGS', argv: args };
}

export function computeBackgroundChildArgs(rawArgs: string[]): string[] {
  const args = sanitizeLauncherArgs(rawArgs);
  return ['--background', ...args];
}

export function shouldRunLauncher(args: { platform: NodeJS.Platform; rawArgs: string[] }): boolean {
  if (args.platform !== 'win32') return false;
  // Launcher mode is only for packaged portable exe (pkg).
  // In dev (`node dist/index.js`) spawning `process.execPath` would spawn node.exe without the script.
  if (!(globalThis as any).process?.pkg) return false;
  // Explicit modes bypass launcher.
  if (args.rawArgs.includes('--background')) return false;
  if (args.rawArgs.includes('--console')) return false;
  if (args.rawArgs.includes('--doctor')) return false;
  if (args.rawArgs.includes('--help') || args.rawArgs.includes('-h')) return false;
  // Default Windows UX: double click / deeplink / autorun => launcher.
  return true;
}

