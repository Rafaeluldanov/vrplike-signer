import { signAuthChallengeAttached, SignerError } from './cryptopro-signer';

describe('cryptopro-signer', () => {
  test('throws NO_CERTIFICATE_SELECTED when no selection available', async () => {
    await expect(signAuthChallengeAttached('ping', {}, { config: {
      tool: 'cryptcp',
      cryptcpPath: 'cryptcp',
      csptestPath: 'csptest',
      signFormat: 'ATTACHED_CMS',
      tmpDir: require('os').tmpdir(),
      timeoutMs: 2000,
    } as any })).rejects.toMatchObject({ code: 'NO_CERTIFICATE_SELECTED' });
  });

  test('returns CRYPTOPRO_NOT_FOUND when tool missing', async () => {
    const cfg = {
      tool: 'cryptcp' as const,
      cryptcpPath: 'definitely-missing-cryptcp-binary',
      csptestPath: 'csptest',
      signFormat: 'ATTACHED_CMS' as const,
      tmpDir: require('os').tmpdir(),
      timeoutMs: 2000,
      certThumbprint: 'A'.repeat(40),
    };

    try {
      await signAuthChallengeAttached('ping', {}, { config: cfg as any });
      throw new Error('expected to throw');
    } catch (e: any) {
      expect(e).toBeInstanceOf(SignerError);
      expect(e.code).toBe('CRYPTOPRO_NOT_FOUND');
    }
  });
});

