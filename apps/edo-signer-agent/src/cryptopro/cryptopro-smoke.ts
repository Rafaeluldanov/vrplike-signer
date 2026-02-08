import { loadCryptoProConfigFromEnv } from './cryptopro-config';
import { signAuthChallengeAttached, SignerError } from './cryptopro-signer';

/**
 * Small helper used by CLI smoke command.
 * Not used by WS agent directly.
 */
export async function smokeSignChallenge(input: { challenge: string; certificateRef?: string }): Promise<{ bytesLength: number }> {
  const cfg = loadCryptoProConfigFromEnv(process.env);
  try {
    const buf = await signAuthChallengeAttached(input.challenge, { certificateRef: input.certificateRef }, { config: cfg });
    return { bytesLength: buf.length };
  } catch (e: any) {
    if (e instanceof SignerError) throw e;
    throw new Error(String(e?.message ?? e));
  }
}

