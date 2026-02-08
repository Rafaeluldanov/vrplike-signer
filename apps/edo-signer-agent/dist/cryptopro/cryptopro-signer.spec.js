"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cryptopro_signer_1 = require("./cryptopro-signer");
describe('cryptopro-signer', () => {
    test('throws NO_CERTIFICATE_SELECTED when no selection available', async () => {
        await expect((0, cryptopro_signer_1.signAuthChallengeAttached)('ping', {}, { config: {
                tool: 'cryptcp',
                cryptcpPath: 'cryptcp',
                csptestPath: 'csptest',
                signFormat: 'ATTACHED_CMS',
                tmpDir: require('os').tmpdir(),
                timeoutMs: 2000,
            } })).rejects.toMatchObject({ code: 'NO_CERTIFICATE_SELECTED' });
    });
    test('returns CRYPTOPRO_NOT_FOUND when tool missing', async () => {
        const cfg = {
            tool: 'cryptcp',
            cryptcpPath: 'definitely-missing-cryptcp-binary',
            csptestPath: 'csptest',
            signFormat: 'ATTACHED_CMS',
            tmpDir: require('os').tmpdir(),
            timeoutMs: 2000,
            certThumbprint: 'A'.repeat(40),
        };
        try {
            await (0, cryptopro_signer_1.signAuthChallengeAttached)('ping', {}, { config: cfg });
            throw new Error('expected to throw');
        }
        catch (e) {
            expect(e).toBeInstanceOf(cryptopro_signer_1.SignerError);
            expect(e.code).toBe('CRYPTOPRO_NOT_FOUND');
        }
    });
});
//# sourceMappingURL=cryptopro-signer.spec.js.map