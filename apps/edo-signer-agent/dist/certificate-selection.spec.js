"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const certificate_selection_1 = require("./certificate-selection");
describe('certificate-selection', () => {
    test('when >1 candidates and allowRememberSelection=false, always prompts even if pinned exists', async () => {
        const prompt = jest.fn(async () => ({ thumbprint: 'TP2', remember: false }));
        const res = await (0, certificate_selection_1.chooseCertificateThumbprint)({
            expectedInn: '7701000000',
            candidates: [
                { thumbprint: 'TP1', subject: 's1', innExtracted: '7701000000', validTo: null, provider: 'CRYPTOPRO_CERTMGR' },
                { thumbprint: 'TP2', subject: 's2', innExtracted: '7701000000', validTo: null, provider: 'CRYPTOPRO_CERTMGR' },
            ],
            pinnedThumbprint: 'TP1',
            allowRememberSelection: false,
            prompt,
        });
        expect(prompt).toHaveBeenCalledTimes(1);
        expect(res.thumbprint).toBe('TP2');
    });
    test('when >1 candidates and allowRememberSelection=true, still prompts (pinned is only default suggestion)', async () => {
        const prompt = jest.fn(async () => ({ thumbprint: 'TP2', remember: false }));
        const res = await (0, certificate_selection_1.chooseCertificateThumbprint)({
            expectedInn: '7701000000',
            candidates: [
                { thumbprint: 'TP1', subject: 's1', innExtracted: '7701000000', validTo: null, provider: 'CRYPTOPRO_CERTMGR' },
                { thumbprint: 'TP2', subject: 's2', innExtracted: '7701000000', validTo: null, provider: 'CRYPTOPRO_CERTMGR' },
            ],
            pinnedThumbprint: 'TP1',
            allowRememberSelection: true,
            prompt,
        });
        expect(prompt).toHaveBeenCalledTimes(1);
        expect(res).toEqual({ thumbprint: 'TP2', remember: false });
    });
});
//# sourceMappingURL=certificate-selection.spec.js.map