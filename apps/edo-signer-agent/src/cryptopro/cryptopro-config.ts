import { tmpdir } from 'os';

export type CryptoProTool = 'cryptcp' | 'csptest';

export type CryptoProConfig = {
  tool: CryptoProTool;
  /**
   * Optional CryptoPro installation root (Windows).
   * If set, signer will look for <CRYPTOPRO_HOME>\\cryptcp.exe and <CRYPTOPRO_HOME>\\csptest.exe.
   */
  cryptoProHome?: string;
  cryptcpPath: string;
  csptestPath: string;
  cryptcpArgsTemplate?: string;
  csptestArgsTemplate?: string;
  certThumbprint?: string;
  certSubject?: string;
  containerName?: string;
  certPin?: string;
  signFormat: 'ATTACHED_CMS';
  tmpDir: string;
  timeoutMs: number;
};

export type CertificateSelection =
  | { kind: 'thumbprint'; thumbprint: string }
  | { kind: 'subject'; subject: string }
  | { kind: 'container'; containerName: string };

export type TemplateVars = {
  IN: string;
  OUT: string;
  CERTIFICATE_REF?: string;
  THUMBPRINT?: string;
  SUBJECT?: string;
  CONTAINER?: string;
  PIN?: string;
};

function toNonEmptyStringNoTrim(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function toNonEmptyTrimmed(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function looksLikeThumbprint(s: string): boolean {
  // Common thumbprints: SHA-1 (40 hex), SHA-256 (64 hex).
  const v = s.replace(/\s+/g, '');
  return /^[0-9a-fA-F]{40}$/.test(v) || /^[0-9a-fA-F]{64}$/.test(v);
}

export function normalizeThumbprint(s: string): string {
  return s.replace(/\s+/g, '').toUpperCase();
}

export function loadCryptoProConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CryptoProConfig {
  const tool = (toNonEmptyTrimmed(env.CRYPTOPRO_TOOL) as CryptoProTool | null) ?? 'cryptcp';
  if (tool !== 'cryptcp' && tool !== 'csptest') {
    throw new Error(`Invalid CRYPTOPRO_TOOL=${String(env.CRYPTOPRO_TOOL)} (allowed: cryptcp|csptest)`);
  }

  const cryptoProHome = toNonEmptyTrimmed(env.CRYPTOPRO_HOME) ?? undefined;
  const cryptcpPath = toNonEmptyTrimmed(env.CRYPTCP_PATH) ?? 'cryptcp';
  const csptestPath = toNonEmptyTrimmed(env.CSPTEST_PATH) ?? 'csptest';

  const cryptcpArgsTemplate = toNonEmptyStringNoTrim(env.CRYPTCP_ARGS_TEMPLATE) ?? undefined;
  const csptestArgsTemplate = toNonEmptyStringNoTrim(env.CSPTEST_ARGS_TEMPLATE) ?? undefined;

  const certThumbprint = toNonEmptyTrimmed(env.CERT_THUMBPRINT) ?? undefined;
  const certSubject = toNonEmptyStringNoTrim(env.CERT_SUBJECT) ?? undefined;
  const containerName = toNonEmptyStringNoTrim(env.CONTAINER_NAME) ?? undefined;
  const certPin = toNonEmptyStringNoTrim(env.CERT_PIN) ?? undefined;

  const signFormat = (toNonEmptyTrimmed(env.SIGN_FORMAT) as CryptoProConfig['signFormat'] | null) ?? 'ATTACHED_CMS';
  if (signFormat !== 'ATTACHED_CMS') {
    throw new Error(`Unsupported SIGN_FORMAT=${String(env.SIGN_FORMAT)} (only ATTACHED_CMS is supported in MVP)`);
  }

  const tmpDir = toNonEmptyStringNoTrim(env.TMP_DIR) ?? tmpdir();
  const timeoutMsRaw = toNonEmptyTrimmed(env.CRYPTOPRO_TIMEOUT_MS);
  const timeoutMs = timeoutMsRaw ? Number(timeoutMsRaw) : 20000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid CRYPTOPRO_TIMEOUT_MS=${String(env.CRYPTOPRO_TIMEOUT_MS)} (expected positive number)`);
  }

  return {
    tool,
    cryptoProHome,
    cryptcpPath,
    csptestPath,
    cryptcpArgsTemplate,
    csptestArgsTemplate,
    certThumbprint,
    certSubject,
    containerName,
    certPin,
    signFormat,
    tmpDir,
    timeoutMs,
  };
}

export function resolveCertificateSelection(input: {
  certificateRef?: string;
  certThumbprint?: string;
  certSubject?: string;
  containerName?: string;
}): CertificateSelection | null {
  const { certificateRef, certThumbprint, certSubject, containerName } = input;

  const ref = toNonEmptyTrimmed(certificateRef) ?? null;
  if (ref && looksLikeThumbprint(ref)) {
    return { kind: 'thumbprint', thumbprint: normalizeThumbprint(ref) };
  }
  // If certificateRef is provided but is not a thumbprint, treat it as a subject/alias string.
  // Specific environments may override CLI flags via *_ARGS_TEMPLATE and use {CERTIFICATE_REF}/{SUBJECT}.
  if (ref) {
    return { kind: 'subject', subject: ref };
  }

  const envThumb = toNonEmptyTrimmed(certThumbprint) ?? null;
  if (envThumb) {
    return { kind: 'thumbprint', thumbprint: normalizeThumbprint(envThumb) };
  }

  const subj = toNonEmptyStringNoTrim(certSubject) ?? null;
  if (subj) {
    return { kind: 'subject', subject: subj };
  }

  const cont = toNonEmptyStringNoTrim(containerName) ?? null;
  if (cont) {
    return { kind: 'container', containerName: cont };
  }

  return null;
}

/**
 * Very small argv parser:
 * - Splits by whitespace, supports single/double quotes.
 * - Supports escaping quotes with backslash within the same quote type.
 */
export function splitArgsTemplate(template: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let esc = false;

  const flush = () => {
    if (cur.length) out.push(cur);
    cur = '';
  };

  for (let i = 0; i < template.length; i++) {
    const ch = template[i];

    if (esc) {
      cur += ch;
      esc = false;
      continue;
    }

    if (ch === '\\') {
      esc = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      flush();
      continue;
    }

    cur += ch;
  }

  flush();
  return out;
}

export function substituteTemplateArg(arg: string, vars: TemplateVars): string {
  // Support both {NAME} and ${NAME} for convenience.
  const rep = (s: string, from: string, to: string) => s.split(from).join(to);

  let s = arg;
  s = rep(s, '{IN}', vars.IN);
  s = rep(s, '{OUT}', vars.OUT);
  s = rep(s, '{CERTIFICATE_REF}', vars.CERTIFICATE_REF ?? '');
  s = rep(s, '{THUMBPRINT}', vars.THUMBPRINT ?? '');
  s = rep(s, '{SUBJECT}', vars.SUBJECT ?? '');
  s = rep(s, '{CONTAINER}', vars.CONTAINER ?? '');
  s = rep(s, '{PIN}', vars.PIN ?? '');

  s = rep(s, '${IN}', vars.IN);
  s = rep(s, '${OUT}', vars.OUT);
  s = rep(s, '${CERTIFICATE_REF}', vars.CERTIFICATE_REF ?? '');
  s = rep(s, '${THUMBPRINT}', vars.THUMBPRINT ?? '');
  s = rep(s, '${SUBJECT}', vars.SUBJECT ?? '');
  s = rep(s, '${CONTAINER}', vars.CONTAINER ?? '');
  s = rep(s, '${PIN}', vars.PIN ?? '');

  return s;
}

export function buildArgsFromTemplate(template: string, vars: TemplateVars): string[] {
  const raw = splitArgsTemplate(template);
  return raw
    .map((a) => substituteTemplateArg(a, vars))
    .filter((a) => a.length > 0);
}

