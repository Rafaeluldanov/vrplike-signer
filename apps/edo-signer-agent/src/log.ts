import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'fs';
import * as path from 'path';

export type Logger = {
  logsDir: string;
  logPath: string;
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
  close: () => void;
};

function toNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function safeMkdir(dir: string): void {
  try {
    if (existsSync(dir)) return;
    mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
}

function isoNow(): string {
  return new Date().toISOString();
}

function safeJson(meta: Record<string, unknown> | undefined): string {
  if (!meta) return '';
  try {
    return ' ' + JSON.stringify(meta);
  } catch {
    return '';
  }
}

function safeUnlink(p: string): void {
  try {
    unlinkSync(p);
  } catch {
    // ignore
  }
}

function safeRename(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch {
    // ignore
  }
}

function rotateLogsIfNeeded(args: { logPath: string; maxBytes: number; maxFiles: number }): void {
  const maxBytes = Math.max(256 * 1024, Number(args.maxBytes || 0)); // guardrails
  const maxFiles = Math.max(1, Math.min(20, Number(args.maxFiles || 0)));

  try {
    if (!existsSync(args.logPath)) return;
    const st = statSync(args.logPath);
    if (!st || !Number.isFinite(st.size) || st.size <= maxBytes) return;
  } catch {
    return;
  }

  // signer.log -> signer.log.1 -> signer.log.2 ... (keep maxFiles)
  for (let i = maxFiles; i >= 1; i--) {
    const src = `${args.logPath}.${i}`;
    const dst = `${args.logPath}.${i + 1}`;
    if (i === maxFiles) {
      safeUnlink(src);
      continue;
    }
    if (existsSync(src)) safeRename(src, dst);
  }
  safeRename(args.logPath, `${args.logPath}.1`);
}

export function createFileLogger(args: {
  logsDir: string;
  filename?: string;
  maxBytes?: number;
  maxFiles?: number;
  rotationCheckEveryWrites?: number;
}): Logger {
  const logsDir = args.logsDir;
  safeMkdir(logsDir);
  const logPath = path.join(logsDir, (toNonEmptyString(args.filename) ?? 'signer.log').trim());
  const maxBytes = Number.isFinite(args.maxBytes) ? Number(args.maxBytes) : 10 * 1024 * 1024; // 10MB
  const maxFiles = Number.isFinite(args.maxFiles) ? Number(args.maxFiles) : 5;
  const rotationCheckEveryWrites = Number.isFinite(args.rotationCheckEveryWrites) ? Number(args.rotationCheckEveryWrites) : 128;

  // Rotate before opening the stream to avoid clobbering open handle.
  rotateLogsIfNeeded({ logPath, maxBytes, maxFiles });
  let stream = createWriteStream(logPath, { flags: 'a' });

  let writesSinceRotationCheck = 0;
  let rotating = false;
  const buffer: string[] = [];

  const checkSizeExceeds = (): boolean => {
    try {
      if (!existsSync(logPath)) return false;
      const st = statSync(logPath);
      return Boolean(st && Number.isFinite(st.size) && st.size > maxBytes);
    } catch {
      return false;
    }
  };

  const flushBuffer = () => {
    if (!buffer.length) return;
    const pending = buffer.splice(0, buffer.length);
    try {
      for (const line of pending) stream.write(line);
    } catch {
      // ignore
    }
  };

  const rotateNow = () => {
    if (rotating) return;
    rotating = true;
    try {
      stream.end(() => {
        try {
          rotateLogsIfNeeded({ logPath, maxBytes, maxFiles });
        } catch {
          // ignore
        }
        try {
          stream = createWriteStream(logPath, { flags: 'a' });
        } catch {
          // ignore
        }
        rotating = false;
        flushBuffer();
      });
    } catch {
      rotating = false;
    }
  };

  const write = (level: 'INFO' | 'WARN' | 'ERROR', msg: string, meta?: Record<string, unknown>) => {
    try {
      writesSinceRotationCheck++;
      if (writesSinceRotationCheck >= rotationCheckEveryWrites) {
        writesSinceRotationCheck = 0;
        if (checkSizeExceeds()) rotateNow();
      }
      const line = `[${isoNow()}] [${level}] ${String(msg ?? '')}${safeJson(meta)}\n`;
      if (rotating) {
        buffer.push(line);
        return;
      }
      stream.write(line);
    } catch {
      // ignore
    }
  };

  return {
    logsDir,
    logPath,
    info: (msg, meta) => write('INFO', msg, meta),
    warn: (msg, meta) => write('WARN', msg, meta),
    error: (msg, meta) => write('ERROR', msg, meta),
    close: () => {
      try {
        rotating = true;
        buffer.splice(0, buffer.length);
        stream.end();
      } catch {
        // ignore
      }
    },
  };
}

export function hookConsoleToLogger(logger: Logger): void {
  const map = (args: any[]) =>
    args
      .map((a) => {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ''}`.trim();
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' ');

  // eslint-disable-next-line no-console
  console.log = (...a: any[]) => logger.info(map(a));
  // eslint-disable-next-line no-console
  console.warn = (...a: any[]) => logger.warn(map(a));
  // eslint-disable-next-line no-console
  console.error = (...a: any[]) => logger.error(map(a));
}

export function hookConsoleToTeeLogger(logger: Logger): void {
  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  const map = (args: any[]) =>
    args
      .map((a) => {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ''}`.trim();
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' ');

  // eslint-disable-next-line no-console
  console.log = (...a: any[]) => {
    try {
      origLog(...a);
    } finally {
      logger.info(map(a));
    }
  };
  // eslint-disable-next-line no-console
  console.warn = (...a: any[]) => {
    try {
      origWarn(...a);
    } finally {
      logger.warn(map(a));
    }
  };
  // eslint-disable-next-line no-console
  console.error = (...a: any[]) => {
    try {
      origError(...a);
    } finally {
      logger.error(map(a));
    }
  };
}

