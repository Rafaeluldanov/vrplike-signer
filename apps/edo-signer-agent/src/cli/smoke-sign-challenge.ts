import { smokeSignChallenge } from '../cryptopro/cryptopro-smoke';
import { SignerError } from '../cryptopro/cryptopro-signer';

function getArgValue(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  if (idx === -1) return undefined;
  const v = argv[idx + 1];
  if (!v) return undefined;
  return v;
}

async function main() {
  const challenge = getArgValue(process.argv, '--challenge') ?? getArgValue(process.argv, '-c');
  const certificateRef = getArgValue(process.argv, '--certificateRef') ?? getArgValue(process.argv, '--cert');

  if (!challenge) {
    // eslint-disable-next-line no-console
    console.error('Usage: node dist/cli/smoke-sign-challenge.js --challenge "ping" [--certificateRef "<thumbprint-or-alias>"]');
    process.exit(2);
  }

  try {
    const r = await smokeSignChallenge({ challenge, certificateRef });
    // eslint-disable-next-line no-console
    console.log(`OK signature bytes length=${r.bytesLength}`);
    process.exit(0);
  } catch (e: any) {
    if (e instanceof SignerError) {
      // eslint-disable-next-line no-console
      console.error(`ERROR code=${e.code} message=${e.message}`);
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.error(`ERROR ${String(e?.message ?? e)}`);
    process.exit(1);
  }
}

main();

