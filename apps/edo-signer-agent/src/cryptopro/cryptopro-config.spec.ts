import { buildArgsFromTemplate, looksLikeThumbprint, normalizeThumbprint, splitArgsTemplate } from './cryptopro-config';

describe('cryptopro-config', () => {
  test('looksLikeThumbprint accepts sha1/sha256 hex', () => {
    expect(looksLikeThumbprint('a'.repeat(40))).toBe(true);
    expect(looksLikeThumbprint('A'.repeat(64))).toBe(true);
    expect(looksLikeThumbprint('not-a-thumbprint')).toBe(false);
  });

  test('normalizeThumbprint removes spaces and uppercases', () => {
    expect(normalizeThumbprint('aa bb cc')).toBe('AABBCC');
  });

  test('splitArgsTemplate supports quotes', () => {
    const args = splitArgsTemplate('-sign -in "{IN}" -out "{OUT}" -dn "CN=\\"Test User\\""');
    expect(args).toEqual(['-sign', '-in', '{IN}', '-out', '{OUT}', '-dn', 'CN="Test User"']);
  });

  test('buildArgsFromTemplate substitutes placeholders', () => {
    const args = buildArgsFromTemplate('-sign -thumbprint {THUMBPRINT} -in {IN} -out {OUT}', {
      IN: 'C:\\tmp\\in.txt',
      OUT: 'C:\\tmp\\out.p7s',
      THUMBPRINT: 'ABC',
    });
    expect(args).toEqual(['-sign', '-thumbprint', 'ABC', '-in', 'C:\\tmp\\in.txt', '-out', 'C:\\tmp\\out.p7s']);
  });
});

