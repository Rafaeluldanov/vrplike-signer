#!/usr/bin/env node
/**
 * EDO external signer smoketest (manual).
 *
 * How to run (Node 18+):
 *   SIGNER_URL="https://signer.company.local" \
 *   SIGNER_API_KEY="optional" \
 *   CERTIFICATE_REF="optional-thumbprint-or-alias" \
 *   node scripts/edo/signer-smoketest.ts
 *
 * Notes:
 * - This file is named `.ts`, but intentionally contains plain CommonJS JavaScript
 *   so it can be executed via `node ...` without ts-node.
 * - It does NOT require vrplike DB, JWT, or any internal services.
 */
/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/consistent-type-imports */
/* eslint-disable @typescript-eslint/no-floating-promises */

function nonEmpty(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function normalizeBaseUrl(url) {
  return url.replace(/\/+$/, '');
}

async function httpBinary(url, init) {
  const res = await fetch(url, init);
  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);

  if (!res.ok) {
    // Try to print only safe error text (no binary dumping).
    let text = '';
    try {
      text = buf.toString('utf-8');
    } catch {
      text = '';
    }
    const details = text && text.length < 2000 ? text : '<non-text or large body>';
    throw new Error(`HTTP ${res.status} for ${url}: ${details}`);
  }

  return buf;
}

async function main() {
  const signerUrlRaw = nonEmpty(process.env.SIGNER_URL);
  if (!signerUrlRaw) {
    throw new Error('SIGNER_URL env is required (example: https://signer.company.local)');
  }
  const baseUrl = normalizeBaseUrl(signerUrlRaw);

  const apiKey = nonEmpty(process.env.SIGNER_API_KEY);
  const certificateRef = nonEmpty(process.env.CERTIFICATE_REF);

  const headersAuth = {
    Accept: 'application/octet-stream',
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };

  console.log('[signer-smoketest] 1) auth-challenge-attached...');
  const signedData = await httpBinary(`${baseUrl}/sign/auth-challenge-attached`, {
    method: 'POST',
    headers: headersAuth,
    body: JSON.stringify({
      provider: 'KALUGA_ASTRAL',
      challenge: 'test-challenge',
      certificateRef: certificateRef || undefined,
      meta: {},
    }),
  });
  console.log(`[signer-smoketest] signedData bytes: ${signedData.length}`);

  console.log('[signer-smoketest] 2) draft-detached...');
  const form = new FormData();
  form.append('file', new Blob([Buffer.from('hello')]), 'hello.txt');
  form.append('provider', 'KALUGA_ASTRAL');
  if (certificateRef) form.append('certificateRef', certificateRef);
  form.append('meta', JSON.stringify({}));

  const headersDraft = {
    Accept: 'application/octet-stream',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };

  const signFile = await httpBinary(`${baseUrl}/sign/draft-detached`, {
    method: 'POST',
    headers: headersDraft,
    body: form,
  });
  console.log(`[signer-smoketest] signFile bytes: ${signFile.length}`);

  console.log('[signer-smoketest] OK');
}

main().catch((err) => {
  console.error('[signer-smoketest] FAILED:', err);
  process.exitCode = 1;
});

