import { signAuthChallengeAttached } from './cryptopro-signer';
import type { CryptoProConfig } from './cryptopro-config';

jest.mock('../crypto/cadescom-signing', () => ({
  signBase64ViaCadesCom: jest.fn(async () => {
    throw new Error('signBase64ViaCadesCom must not be called in no-cert branch');
  }),
  listCertsWithPrivateKeyViaPowerShell: jest.fn(),
}));

jest.mock('./cryptopro-tool-resolver', () => ({ resolveCryptoProTool: jest.fn() }));
jest.mock('./spawn', () => ({ spawnWithTimeout: jest.fn() }));

describe('cryptopro-signer (win32 no cert selected)', () => {
  const originalPlatform = process.platform;

  beforeAll(() => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  beforeEach(() => {
    const { listCertsWithPrivateKeyViaPowerShell, signBase64ViaCadesCom } = require('../crypto/cadescom-signing');
    listCertsWithPrivateKeyViaPowerShell.mockReset();
    signBase64ViaCadesCom.mockClear();

    const { resolveCryptoProTool } = require('./cryptopro-tool-resolver');
    resolveCryptoProTool.mockReset();

    const { spawnWithTimeout } = require('./spawn');
    spawnWithTimeout.mockReset();
  });

  const cfg: CryptoProConfig = {
    tool: 'cryptcp',
    cryptcpPath: 'cryptcp',
    csptestPath: 'csptest',
    signFormat: 'ATTACHED_CMS',
    tmpDir: require('os').tmpdir(),
    timeoutMs: 2000,
  };

  test('no thumbprint + 0 certs => CERT_NOT_FOUND (no CLI fallback)', async () => {
    const { listCertsWithPrivateKeyViaPowerShell } = require('../crypto/cadescom-signing');
    listCertsWithPrivateKeyViaPowerShell.mockResolvedValue([]);

    await expect(signAuthChallengeAttached('ping', {}, { config: cfg as any })).rejects.toMatchObject({
      code: 'CERT_NOT_FOUND',
      message: 'Сертификат с закрытым ключом не найден. Установите сертификат и повторите.',
    });

    const { resolveCryptoProTool } = require('./cryptopro-tool-resolver');
    const { spawnWithTimeout } = require('./spawn');
    expect(resolveCryptoProTool).not.toHaveBeenCalled();
    expect(spawnWithTimeout).not.toHaveBeenCalled();
  });

  test('no thumbprint + certs exist => CERT_NOT_SELECTED (no CLI fallback)', async () => {
    const { listCertsWithPrivateKeyViaPowerShell } = require('../crypto/cadescom-signing');
    listCertsWithPrivateKeyViaPowerShell.mockResolvedValue([
      { thumbprint: 'AA', store: 'CurrentUser\\My', hasPrivateKey: true },
    ]);

    await expect(signAuthChallengeAttached('ping', {}, { config: cfg as any })).rejects.toMatchObject({
      code: 'CERT_NOT_SELECTED',
      message: 'Сертификат не выбран. Нажмите «Сменить сертификат» и выберите сертификат для подписи.',
    });

    const { resolveCryptoProTool } = require('./cryptopro-tool-resolver');
    const { spawnWithTimeout } = require('./spawn');
    expect(resolveCryptoProTool).not.toHaveBeenCalled();
    expect(spawnWithTimeout).not.toHaveBeenCalled();
  });
});
