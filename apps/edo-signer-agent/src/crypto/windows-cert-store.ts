import { execFile } from 'child_process';

export type ReadinessOk = {
  ok: true;
  privateKeyCertCount: number;
  totalCertCount: number;
  sampleThumbprint?: string;
};

export type ReadinessFail =
  | { ok: false; code: 'CERT_NOT_FOUND'; message: string; details?: any }
  | { ok: false; code: 'CRYPTOAPI_FAILED'; message: string; details?: any };

type ParsedCert = { thumbprint: string; hasPrivateKey: boolean };

const THUMBPRINT_PATTERNS: RegExp[] = [
  /Cert Hash\(sha1\):\s*([0-9A-F ]+)/i,
  /Хэш сертификата\s*\(sha1\):\s*([0-9A-F ]+)/i,
];

const PRIVATE_KEY_POSITIVE = /Key Container\s*=|Имя контейнера\s*=|Контейнер ключа\s*=|Provider\s*=|Провайдер\s*=/i;
const PRIVATE_KEY_NEGATIVE =
  /No key provider information|Нет сведений о поставщике ключа|Private key is NOT present|Закрытый ключ отсутствует/i;

function toText(out: Buffer | string | null | undefined): string {
  if (!out) return '';
  if (typeof out === 'string') return out;
  const buf = Buffer.isBuffer(out) ? out : Buffer.from(String(out), 'utf8');

  // Heuristic: UTF-16LE output has lots of NUL bytes.
  const head = buf.subarray(0, Math.min(buf.length, 4096));
  const nulCount = head.reduce((n, b) => n + (b === 0 ? 1 : 0), 0);
  const looksUtf16 = buf.length >= 4 && nulCount > Math.min(50, Math.floor(head.length / 20));

  const text = looksUtf16 ? buf.toString('utf16le') : buf.toString('utf8');
  return text.replace(/\r/g, '');
}

function extractThumbprint(block: string): string | null {
  for (const re of THUMBPRINT_PATTERNS) {
    const m = block.match(re);
    if (!m) continue;
    const raw = String(m[1] ?? '')
      .replace(/[^0-9a-fA-F ]/g, '')
      .trim();
    const normalized = raw.replace(/\s+/g, '').toUpperCase();
    if (normalized) return normalized;
  }
  return null;
}

function splitCertBlocks(text: string): string[] {
  const s = String(text ?? '').replace(/\r/g, '');
  if (!s.trim()) return [];

  // Primary: certutil delimiter (EN/RU).
  const delimiter = /^=+\s*(Certificate|Сертификат)\b.*$/gim;
  const matches = [...s.matchAll(delimiter)];
  if (matches.length >= 1) {
    const blocks: string[] = [];
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index ?? 0;
      const end = (matches[i + 1]?.index ?? s.length) as number;
      const chunk = s.slice(start, end).trim();
      if (chunk) blocks.push(chunk);
    }
    if (blocks.length) return blocks;
  }

  // Secondary: start a new block at each thumbprint line occurrence.
  const thumbLine = /^(?:Cert Hash\(sha1\):|Хэш сертификата\s*\(sha1\):)\s*[0-9A-F ]+/gim;
  const tMatches = [...s.matchAll(thumbLine)];
  if (tMatches.length >= 1) {
    const blocks: string[] = [];
    for (let i = 0; i < tMatches.length; i++) {
      const start = tMatches[i].index ?? 0;
      const end = (tMatches[i + 1]?.index ?? s.length) as number;
      // Expand backwards to include a bit of context above thumbprint line.
      const back = Math.max(0, s.lastIndexOf('\n', start - 1));
      const chunk = s.slice(back, end).trim();
      if (chunk) blocks.push(chunk);
    }
    if (blocks.length) return blocks;
  }

  // Fallback: paragraphs.
  return s
    .split(/\n\s*\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseCertutilStoreOutput(text: string): ParsedCert[] {
  const blocks = splitCertBlocks(text);
  const parsed: ParsedCert[] = [];
  for (const b of blocks) {
    const thumbprint = extractThumbprint(b);
    if (!thumbprint) continue;
    const hasPrivateKey = PRIVATE_KEY_NEGATIVE.test(b) ? false : PRIVATE_KEY_POSITIVE.test(b);
    parsed.push({ thumbprint, hasPrivateKey });
  }
  return parsed;
}

async function execCertutil(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    execFile(
      'certutil',
      args,
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        // Keep Buffer stdout/stderr to support UTF-16LE output.
      } as any,
      (error: any, stdout: any, stderr: any) => {
        if (error) {
          reject({ error, stdout: toText(stdout), stderr: toText(stderr) });
          return;
        }
        resolve({ stdout: toText(stdout), stderr: toText(stderr) });
      },
    );
  });
}

function truncateForDetails(s: string, max = 512): string {
  const t = String(s ?? '').trim();
  if (!t) return '';
  return t.length <= max ? t : t.slice(0, max) + '...[truncated]';
}

export async function checkWindowsSigningReadiness(opts?: { timeoutMs?: number }): Promise<ReadinessOk | ReadinessFail> {
  const timeoutMs = typeof opts?.timeoutMs === 'number' ? opts!.timeoutMs : 5000;

  if (process.platform !== 'win32') {
    return {
      ok: false,
      code: 'CRYPTOAPI_FAILED',
      message: 'Windows certificate readiness check is available only on Windows (certutil).',
      details: { platform: process.platform },
    };
  }

  try {
    const user = await execCertutil(['-user', '-store', 'My'], timeoutMs);
    const machine = await execCertutil(['-store', 'My'], timeoutMs);

    const parsed = [...parseCertutilStoreOutput(user.stdout), ...parseCertutilStoreOutput(machine.stdout)];
    const totalCertCount = parsed.length;
    const withPk = parsed.filter((c) => c.hasPrivateKey);
    const privateKeyCertCount = withPk.length;
    const sampleThumbprint = withPk[0]?.thumbprint;

    if (privateKeyCertCount > 0) {
      return { ok: true, privateKeyCertCount, totalCertCount, sampleThumbprint };
    }

    return {
      ok: false,
      code: 'CERT_NOT_FOUND',
      message:
        'На компьютере с компонентом подписи не найден сертификат с закрытым ключом. Установите сертификат/подключите токен и повторите.',
      details: { totalCertCount, privateKeyCertCount },
    };
  } catch (e: any) {
    const err = e?.error ?? e;
    const exitCode = typeof err?.code === 'number' ? err.code : typeof err?.exitCode === 'number' ? err.exitCode : null;
    const code = typeof err?.code === 'string' ? err.code : null;
    const stderr = truncateForDetails(String(e?.stderr ?? err?.stderr ?? ''));

    return {
      ok: false,
      code: 'CRYPTOAPI_FAILED',
      message: 'Не удалось проверить сертификаты Windows (certutil).',
      details: {
        exitCode,
        errorCode: code,
        killed: Boolean(err?.killed),
        signal: err?.signal ?? null,
        stderr: stderr || undefined,
      },
    };
  }
}

