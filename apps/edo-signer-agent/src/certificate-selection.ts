import type { LocalCertificate } from './cryptopro/cryptopro-certmgr';
import { SignerError } from './cryptopro/signer-error';

export type CertPrompt = (args: {
  expectedInn: string;
  candidates: LocalCertificate[];
  defaultThumbprint?: string;
  allowRememberSelection: boolean;
}) => Promise<{ thumbprint: string; remember: boolean }>;

function normalizeInn(v: string): string {
  return String(v ?? '').replace(/\D+/g, '');
}

export function filterCertificatesByInn(certs: LocalCertificate[], expectedInnRaw: string): LocalCertificate[] {
  const expectedInn = normalizeInn(expectedInnRaw);
  return (certs ?? []).filter((c) => normalizeInn(c.innExtracted ?? '') === expectedInn);
}

export async function chooseCertificateThumbprint(args: {
  expectedInn: string;
  candidates: LocalCertificate[];
  pinnedThumbprint?: string;
  allowRememberSelection: boolean;
  prompt: CertPrompt;
}): Promise<{ thumbprint: string; remember: boolean }> {
  const expectedInn = normalizeInn(args.expectedInn);
  if (!expectedInn) {
    throw new SignerError('CERT_LIST_FAILED', 'expectedInn is required for certificate selection');
  }

  const candidates = args.candidates ?? [];
  if (candidates.length === 0) {
    throw new SignerError('NO_CERT_FOUND_FOR_INN', `No certificate found for INN=${expectedInn}`);
  }

  if (candidates.length === 1) {
    return { thumbprint: candidates[0].thumbprint, remember: false };
  }

  const pinned = args.pinnedThumbprint?.trim() || undefined;

  // IMPORTANT (product invariant):
  // If there are multiple matching certificates for the expected INN, we ALWAYS PROMPT the user.
  // Pinned thumbprint (if any) is used only as a default suggestion (Enter) to speed up selection.
  return args.prompt({
    expectedInn,
    candidates,
    defaultThumbprint: pinned && candidates.some((c) => c.thumbprint === pinned) ? pinned : undefined,
    allowRememberSelection: args.allowRememberSelection,
  });
}

