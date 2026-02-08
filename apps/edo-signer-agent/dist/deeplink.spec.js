"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const deeplink_1 = require("./deeplink");
describe('deeplink', () => {
    it('parses vrplike-signer://pair deeplink', () => {
        const u = 'vrplike-signer://pair?token=abc123&wsUrl=' +
            encodeURIComponent('wss://api.vrplike.io/ws/edo-signer') +
            '&le=le-1';
        const parsed = (0, deeplink_1.parseVrplikeSignerDeeplink)(u);
        expect(parsed).toEqual({
            token: 'abc123',
            wsUrl: 'wss://api.vrplike.io/ws/edo-signer',
            legalEntityId: 'le-1',
        });
    });
    it('maps wss url to https api base', () => {
        expect((0, deeplink_1.apiBaseFromWsUrl)('wss://api.vrplike.io/ws/edo-signer')).toBe('https://api.vrplike.io');
    });
    it('rejects invalid protocol', () => {
        expect(() => (0, deeplink_1.parseVrplikeSignerDeeplink)('https://example.com')).toThrow(/protocol/i);
    });
});
//# sourceMappingURL=deeplink.spec.js.map