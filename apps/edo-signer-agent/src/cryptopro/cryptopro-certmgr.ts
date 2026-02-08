import { loadCryptoProConfigFromEnv } from './cryptopro-config';
import { spawnWithTimeout } from './spawn';
import { SignerError } from './signer-error';

export type LocalCertificate = {
  thumbprint: string;
  subject: string;
  innExtracted: string | null;
  validTo: string | null;
  provider: 'CRYPTOPRO_CERTMGR';
};

function toNonEmptyTrimmed(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function normalizeInn(v: string): string {
  return v.replace(/\D+/g, '');
}

export function extractInnFromSubject(subject: string): string | null {
  const s = String(subject ?? '');

  const m1 = s.match(/(?:^|[,;\s])INN\s*=\s*([0-9]{10,12})(?:$|[,;\s])/i);
  if (m1?.[1]) return normalizeInn(m1[1]);

  const m2 = s.match(/(?:^|[,;\s])ИНН\s*=\s*([0-9]{10,12})(?:$|[,;\s])/i);
  if (m2?.[1]) return normalizeInn(m2[1]);

  // Common OID for INN in Russian certs: 1.2.643.3.131.1.1
  const m3 = s.match(/(?:^|[,;\s])1\.2\.643\.3\.131\.1\.1\s*=\s*([0-9]{10,12})(?:$|[,;\s])/i);
  if (m3?.[1]) return normalizeInn(m3[1]);

  return null;
}

function normalizeThumbprint(s: string): string {
  return String(s ?? '').replace(/\s+/g, '').toUpperCase();
}

/**
 * List certificates from current user store via CryptoPro certmgr.
 *
 * MVP contract:
 * - Best-effort parsing; if output changes, prefer updating parser rather than loosening security.
 * - We filter by INN later in the selection logic.
 */
export async function listCertificatesCertmgr(env: NodeJS.ProcessEnv = process.env): Promise<LocalCertificate[]> {
  const cfg = loadCryptoProConfigFromEnv(env);
  const certmgrPath = toNonEmptyTrimmed(env.CERTMGR_PATH) ?? 'certmgr';

  // CryptoPro certmgr: list user personal store. Flags vary; keep best-effort.
  // Common: certmgr -list -store uMy
  const res = await spawnWithTimeout(certmgrPath, ['-list', '-store', 'uMy'], cfg.timeoutMs);
  if (res.exitCode !== 0) {
    const tail = res.stderrTrunc.trim() || res.stdoutTrunc.trim();
    throw new SignerError('CERT_LIST_FAILED', `certmgr failed (exitCode=${String(res.exitCode)}). ${tail}`.trim());
  }

  const out = res.stdoutTrunc;
  if (!out.trim()) return [];

  // Heuristic parser: each cert block contains "Subject" and "SHA1 Hash".
  // We'll split by empty lines and pick relevant lines.
  const blocks = out.split(/\r?\n\r?\n+/g).map((b) => b.trim()).filter(Boolean);
  const certs: LocalCertificate[] = [];

  for (const b of blocks) {
    const lines = b.split(/\r?\n/g).map((l) => l.trim());
    const subjectLine = lines.find((l) => /^Subject\s*:/i.test(l)) ?? null;
    const hashLine = lines.find((l) => /^(SHA1\s+Hash|SHA-1\s+Hash)\s*:/i.test(l)) ?? null;
    const validToLine = lines.find((l) => /^Valid\s+To\s*:/i.test(l)) ?? lines.find((l) => /^Not\s+After\s*:/i.test(l)) ?? null;

    const subject = subjectLine ? subjectLine.replace(/^Subject\s*:/i, '').trim() : '';
    const hashRaw = hashLine ? hashLine.replace(/^(SHA1\s+Hash|SHA-1\s+Hash)\s*:/i, '').trim() : '';
    const thumbprint = normalizeThumbprint(hashRaw);

    if (!thumbprint || thumbprint.length < 20) continue;

    const validTo = validToLine ? validToLine.replace(/^(Valid\s+To|Not\s+After)\s*:/i, '').trim() : null;

    certs.push({
      thumbprint,
      subject: subject || b.slice(0, 200),
      innExtracted: subject ? extractInnFromSubject(subject) : null,
      validTo: validTo || null,
      provider: 'CRYPTOPRO_CERTMGR',
    });
  }

  // De-duplicate by thumbprint.
  const uniq = new Map<string, LocalCertificate>();
  for (const c of certs) {
    if (!uniq.has(c.thumbprint)) uniq.set(c.thumbprint, c);
  }
  return Array.from(uniq.values());
}

