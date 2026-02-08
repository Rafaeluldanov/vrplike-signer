import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import * as path from 'path';

import {
  buildArgsFromTemplate,
  CryptoProConfig,
  loadCryptoProConfigFromEnv,
  resolveCertificateSelection,
  type CertificateSelection,
} from './cryptopro-config';
import { resolveCryptoProTool } from './cryptopro-tool-resolver';
import { spawnWithTimeout } from './spawn';
import { SignerError, type SignerErrorCode } from './signer-error';
import { signBase64ViaCadesCom } from '../crypto/cadescom-signing';

export { SignerError, type SignerErrorCode };

function defaultCryptcpTemplate(sel: CertificateSelection): string {
  // IMPORTANT: CryptoPro CLI flags differ across versions; this is a best-effort default.
  // Override with CRYPTCP_ARGS_TEMPLATE if your environment uses different flags.
  if (sel.kind === 'thumbprint') return '-sign -thumbprint {THUMBPRINT} -in {IN} -out {OUT}';
  if (sel.kind === 'subject') return '-sign -dn {SUBJECT} -in {IN} -out {OUT}';
  return '-sign -cont {CONTAINER} -in {IN} -out {OUT}';
}

function defaultCsptestTemplate(sel: CertificateSelection): string {
  // Best-effort default; override with CSPTEST_ARGS_TEMPLATE in real installs.
  if (sel.kind === 'thumbprint') return '-sfsign -thumbprint {THUMBPRINT} -in {IN} -out {OUT}';
  if (sel.kind === 'subject') return '-sfsign -dn {SUBJECT} -in {IN} -out {OUT}';
  return '-sfsign -cont {CONTAINER} -in {IN} -out {OUT}';
}

async function bestEffortRm(p: string): Promise<void> {
  try {
    await rm(p, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

export async function signAuthChallengeAttached(
  challenge: string,
  opts: { certificateRef?: string },
  injected?: { config?: CryptoProConfig },
): Promise<Buffer> {
  const config = injected?.config ?? loadCryptoProConfigFromEnv(process.env);
  if (config.signFormat !== 'ATTACHED_CMS') {
    throw new SignerError('UNSUPPORTED_FORMAT', `Unsupported sign format: ${config.signFormat}`);
  }

  const selection = resolveCertificateSelection({
    certificateRef: opts.certificateRef,
    certThumbprint: config.certThumbprint,
    certSubject: config.certSubject,
    containerName: config.containerName,
  });

  if (!selection) {
    throw new SignerError(
      'NO_CERTIFICATE_SELECTED',
      'No certificate selected. Provide payload.certificateRef (thumbprint/alias) or set CERT_THUMBPRINT / CERT_SUBJECT / CONTAINER_NAME in agent env.',
    );
  }

  // Windows-first invariant (MVP):
  // Prefer COM-based CAdESCOM signing. Do NOT require cryptcp/csptest in PATH.
  // Fallback to CryptoPro CLI only when CAdESCOM is not available (dev/non-standard installs).
  let resolvedWinCliTool: Awaited<ReturnType<typeof resolveCryptoProTool>> | null = null;
  if (process.platform === 'win32' && selection.kind === 'thumbprint') {
    try {
      const dataBase64 = Buffer.from(challenge, 'utf8').toString('base64');
      const r = await signBase64ViaCadesCom({ dataBase64, thumbprint: selection.thumbprint });
      const bytes = Buffer.from(r.signatureBase64, 'base64');
      if (!bytes.length) {
        throw new SignerError('SIGNING_FAILED', 'Подпись не выполнена (пустой результат CAdESCOM).', {
          thumbprint: selection.thumbprint,
        });
      }
      return bytes;
    } catch (e: any) {
      if (e instanceof SignerError) {
        if (e.code === 'CERT_NOT_FOUND' || e.code === 'CERT_NO_PRIVATE_KEY') {
          // Strict UX: cert problems are final (do not fallback to CLI).
          throw e;
        }
        if (e.code === 'CADESCOM_NOT_AVAILABLE') {
          // Allow fallback to CLI only if tools are present; otherwise, surface COM-specific error.
          try {
            resolvedWinCliTool = await resolveCryptoProTool({
              preferredTool: config.tool,
              envCryptcpPath: process.env.CRYPTCP_PATH ?? null,
              envCsptestPath: process.env.CSPTEST_PATH ?? null,
              cryptoProHome: config.cryptoProHome ?? process.env.CRYPTOPRO_HOME ?? null,
            });
          } catch (cliErr: any) {
            if (cliErr instanceof SignerError && cliErr.code === 'SIGNING_TOOL_NOT_FOUND') {
              throw e;
            }
            throw cliErr;
          }
          // Continue to CLI path below.
        } else if (e.code === 'SIGNING_FAILED') {
          throw e;
        } else {
          throw new SignerError('SIGNING_FAILED', 'Подпись не выполнена (CAdESCOM).', {
            ...(e.details ?? {}),
            thumbprint: selection.thumbprint,
          });
        }
      }
      throw new SignerError('SIGNING_FAILED', `Подпись не выполнена (CAdESCOM): ${String(e?.message ?? e)}`);
    }
  }

  const tmpBase = config.tmpDir;
  const dir = await mkdtemp(path.join(tmpBase, 'vrplike-cryptopro-'));
  const inPath = path.join(dir, 'input.txt');
  const outPath = path.join(dir, 'signature.p7s');

  try {
    // IMPORTANT: write as-is, without adding extra newline/whitespace.
    await writeFile(inPath, challenge, { encoding: 'utf8' });

    // On Windows: auto-detect CryptoPro tools (no PATH / no PowerShell / no admin).
    // On non-Windows: keep legacy behavior (PATH-based).
    const resolved =
      process.platform === 'win32'
        ? resolvedWinCliTool ??
          (await resolveCryptoProTool({
            preferredTool: config.tool,
            envCryptcpPath: process.env.CRYPTCP_PATH ?? null,
            envCsptestPath: process.env.CSPTEST_PATH ?? null,
            cryptoProHome: config.cryptoProHome ?? process.env.CRYPTOPRO_HOME ?? null,
          }))
        : null;

    const effectiveTool = (resolved?.tool ?? config.tool) as 'cryptcp' | 'csptest';

    const template =
      effectiveTool === 'cryptcp'
        ? config.cryptcpArgsTemplate ?? defaultCryptcpTemplate(selection)
        : config.csptestArgsTemplate ?? defaultCsptestTemplate(selection);

    const args = buildArgsFromTemplate(template, {
      IN: inPath,
      OUT: outPath,
      CERTIFICATE_REF: opts.certificateRef,
      THUMBPRINT: selection.kind === 'thumbprint' ? selection.thumbprint : undefined,
      SUBJECT: selection.kind === 'subject' ? selection.subject : undefined,
      CONTAINER: selection.kind === 'container' ? selection.containerName : undefined,
      PIN: config.certPin,
    });

    const cmd =
      process.platform === 'win32'
        ? resolved!.path
        : effectiveTool === 'cryptcp'
          ? config.cryptcpPath
          : config.csptestPath;
    const res = await spawnWithTimeout(cmd, args, config.timeoutMs);
    if (res.exitCode !== 0) {
      // Do NOT include full argv or any signature data. Keep errors readable and stable.
      const tail = res.stderrTrunc.trim() || res.stdoutTrunc.trim();
      const hint = tail ? ` Tool output: ${tail}` : '';
      throw new SignerError(
        'SIGN_FAILED',
        `CryptoPro signing failed (tool=${effectiveTool}, exitCode=${String(res.exitCode)}).${hint}`,
      );
    }

    const signatureBytes = await readFile(outPath);
    if (!signatureBytes.length) {
      throw new SignerError('SIGN_FAILED', 'CryptoPro produced empty signature output');
    }
    return signatureBytes;
  } catch (err: any) {
    if (err instanceof SignerError) throw err;
    // Common IO failures.
    throw new SignerError('IO_ERROR', `Signing IO error: ${String(err?.message ?? err)}`);
  } finally {
    await bestEffortRm(dir);
  }
}

