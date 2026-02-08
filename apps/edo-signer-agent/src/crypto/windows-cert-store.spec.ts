import { checkWindowsSigningReadiness } from './windows-cert-store';

jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

import { execFile } from 'child_process';

describe('windows-cert-store readiness (certutil parsing)', () => {
  const origPlatform = process.platform;

  beforeAll(() => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform });
  });

  beforeEach(() => {
    (execFile as any as jest.Mock).mockReset();
  });

  test('EN output: 1 cert with private key => ok', async () => {
    const en = [
      '================ Certificate 0 ================',
      'Issuer: CN=Test CA',
      'Cert Hash(sha1): AA BB CC DD EE FF 00 11 22 33 44 55 66 77 88 99 00 11 22 33',
      'Key Container = 1234567890',
      'Provider = Crypto-Pro GOST R 34.10-2012 Cryptographic Service Provider',
      '',
    ].join('\n');

    (execFile as any as jest.Mock)
      .mockImplementationOnce((_cmd: string, _args: string[], _opts: any, cb: any) => cb(null, Buffer.from(en, 'utf8'), Buffer.from('', 'utf8')))
      .mockImplementationOnce((_cmd: string, _args: string[], _opts: any, cb: any) => cb(null, Buffer.from('', 'utf8'), Buffer.from('', 'utf8')));

    const r = await checkWindowsSigningReadiness({ timeoutMs: 1000 });
    expect(r).toMatchObject({ ok: true, privateKeyCertCount: 1, totalCertCount: 1 });
    if (r.ok) {
      expect(r.sampleThumbprint).toBe('AABBCCDDEEFF0011223344556677889900112233');
    }
  });

  test('RU output: certs exist but no private key => CERT_NOT_FOUND', async () => {
    const ru = [
      '================ Сертификат 0 ================',
      'Издатель: CN=Тестовый УЦ',
      'Хэш сертификата (sha1): 11 22 33 44 55 66 77 88 99 00 AA BB CC DD EE FF 00 11 22 33',
      'Закрытый ключ отсутствует',
      '',
    ].join('\n');

    (execFile as any as jest.Mock)
      .mockImplementationOnce((_cmd: string, _args: string[], _opts: any, cb: any) => cb(null, Buffer.from(ru, 'utf8'), Buffer.from('', 'utf8')))
      .mockImplementationOnce((_cmd: string, _args: string[], _opts: any, cb: any) => cb(null, Buffer.from('', 'utf8'), Buffer.from('', 'utf8')));

    const r = await checkWindowsSigningReadiness({ timeoutMs: 1000 });
    expect(r).toMatchObject({ ok: false, code: 'CERT_NOT_FOUND' });
  });

  test('certutil failure => CRYPTOAPI_FAILED', async () => {
    const err: any = new Error('certutil failed');
    err.code = 1;
    (execFile as any as jest.Mock).mockImplementationOnce((_cmd: string, _args: string[], _opts: any, cb: any) =>
      cb(err, Buffer.from('', 'utf8'), Buffer.from('Access is denied', 'utf8')),
    );

    const r = await checkWindowsSigningReadiness({ timeoutMs: 1000 });
    expect(r).toMatchObject({ ok: false, code: 'CRYPTOAPI_FAILED' });
  });
});

