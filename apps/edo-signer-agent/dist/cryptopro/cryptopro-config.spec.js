"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cryptopro_config_1 = require("./cryptopro-config");
describe('cryptopro-config', () => {
    test('looksLikeThumbprint accepts sha1/sha256 hex', () => {
        expect((0, cryptopro_config_1.looksLikeThumbprint)('a'.repeat(40))).toBe(true);
        expect((0, cryptopro_config_1.looksLikeThumbprint)('A'.repeat(64))).toBe(true);
        expect((0, cryptopro_config_1.looksLikeThumbprint)('not-a-thumbprint')).toBe(false);
    });
    test('normalizeThumbprint removes spaces and uppercases', () => {
        expect((0, cryptopro_config_1.normalizeThumbprint)('aa bb cc')).toBe('AABBCC');
    });
    test('splitArgsTemplate supports quotes', () => {
        const args = (0, cryptopro_config_1.splitArgsTemplate)('-sign -in "{IN}" -out "{OUT}" -dn "CN=\\"Test User\\""');
        expect(args).toEqual(['-sign', '-in', '{IN}', '-out', '{OUT}', '-dn', 'CN="Test User"']);
    });
    test('buildArgsFromTemplate substitutes placeholders', () => {
        const args = (0, cryptopro_config_1.buildArgsFromTemplate)('-sign -thumbprint {THUMBPRINT} -in {IN} -out {OUT}', {
            IN: 'C:\\tmp\\in.txt',
            OUT: 'C:\\tmp\\out.p7s',
            THUMBPRINT: 'ABC',
        });
        expect(args).toEqual(['-sign', '-thumbprint', 'ABC', '-in', 'C:\\tmp\\in.txt', '-out', 'C:\\tmp\\out.p7s']);
    });
});
//# sourceMappingURL=cryptopro-config.spec.js.map