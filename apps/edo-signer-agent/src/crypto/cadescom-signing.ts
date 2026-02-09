import { spawn } from 'child_process';

import { SignerError, type SignerErrorCode, type SignerErrorDetails } from '../cryptopro/signer-error';

export type CadesSignInput = { dataBase64: string; thumbprint: string };
export type CadesSignResult = { signatureBase64: string };

export type CadesCertInfo = { thumbprint: string; store: string; hasPrivateKey: boolean };

const POWERSHELL_FLAGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'] as const;

function normalizeThumbprintStrict(raw: string): string {
  // Keep ONLY hex characters, uppercase. (Users sometimes paste with spaces/newlines.)
  return String(raw ?? '')
    .replace(/[^0-9a-fA-F]/g, '')
    .toUpperCase();
}

function stripPemAndWhitespace(s: string): string {
  const t = String(s ?? '');
  return t
    .replace(/-----BEGIN[^-]*-----/g, '')
    .replace(/-----END[^-]*-----/g, '')
    .replace(/\s+/g, '');
}

function normalizeThumbprintFromPowerShell(raw: string): string {
  // PowerShell cert Thumbprint can contain spaces — normalize to uppercase, no whitespace.
  return String(raw ?? '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

type RunResult = { exitCode: number | null; stdout: string; stderr: string };

async function runPowerShell(opts: {
  script: string;
  env: Record<string, string>;
  timeoutMs: number;
}): Promise<RunResult> {
  return await new Promise<RunResult>((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      [...POWERSHELL_FLAGS, '-Command', opts.script],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...opts.env },
      },
    );

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const onData = (arr: Buffer[], chunk: Buffer) => {
      // Cap memory usage (keep up to ~128KB per stream).
      const MAX = 128 * 1024;
      if (arr.reduce((n, b) => n + b.length, 0) >= MAX) return;
      arr.push(chunk);
    };

    child.stdout?.on('data', (c: Buffer) => onData(stdoutChunks, c));
    child.stderr?.on('data', (c: Buffer) => onData(stderrChunks, c));

    const t = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      reject(new SignerError('TIMEOUT', `PowerShell signing timeout after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);

    child.on('error', (err: any) => {
      clearTimeout(t);
      reject(new SignerError('SIGNING_FAILED', `Failed to start PowerShell: ${String(err?.message ?? err)}`));
    });

    child.on('close', (code) => {
      clearTimeout(t);
      resolve({
        exitCode: typeof code === 'number' ? code : 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8').replace(/\r/g, ''),
        stderr: Buffer.concat(stderrChunks).toString('utf8').replace(/\r/g, ''),
      });
    });
  });
}

const ERROR_PREFIX = 'VRPLIKE_ERROR_JSON=';

function parseErrorFromStderr(stderr: string): { code: SignerErrorCode; message: string; details?: SignerErrorDetails } | null {
  const s = String(stderr ?? '');
  const idx = s.indexOf(ERROR_PREFIX);
  if (idx < 0) return null;

  const jsonRaw = s.slice(idx + ERROR_PREFIX.length).trim();
  // Some PowerShell hosts append extra lines after our payload; keep the first line as JSON.
  const firstLine = jsonRaw.split('\n')[0]?.trim() ?? '';
  try {
    const parsed = JSON.parse(firstLine) as any;
    const code = String(parsed?.code ?? '') as SignerErrorCode;
    const message = String(parsed?.message ?? '');
    const details = (parsed?.details && typeof parsed.details === 'object' ? (parsed.details as any) : undefined) as any;
    if (!code || !message) return null;
    return { code, message, details };
  } catch {
    return null;
  }
}

function mapPowerShellRawError(stderr: string, details: SignerErrorDetails): SignerError {
  const raw = String(stderr ?? '').trim();
  const lower = raw.toLowerCase();

  // Common COM registration failures (EN/RU).
  const looksLikeComNotAvailable =
    lower.includes('cannot create activex object') ||
    lower.includes('retrieving the com class factory') ||
    lower.includes('class not registered') ||
    lower.includes('класс не зарегистрирован') ||
    lower.includes('невозможно создать объект') ||
    lower.includes('cadescom');

  if (looksLikeComNotAvailable) {
    return new SignerError(
      'CADESCOM_NOT_AVAILABLE',
      'Компонента CAdESCOM недоступна (не установлена/не зарегистрирована) — подпись через COM невозможна.',
      { ...details, raw: raw || undefined },
    );
  }

  return new SignerError('SIGNING_FAILED', 'Подпись не выполнена (CAdESCOM).', { ...details, raw: raw || undefined });
}

export async function signBase64ViaCadesCom(input: CadesSignInput): Promise<CadesSignResult> {
  if (process.platform !== 'win32') {
    throw new SignerError('UNSUPPORTED_FORMAT', 'CAdESCOM signing is supported only on Windows.', { platform: process.platform });
  }

  const thumbprint = normalizeThumbprintStrict(input.thumbprint);
  if (!thumbprint) {
    throw new SignerError('TEMPLATE_INVALID', 'Empty/invalid certificate thumbprint (expected hex).');
  }

  const dataBase64 = String(input.dataBase64 ?? '').trim();
  if (!dataBase64) {
    throw new SignerError('TEMPLATE_INVALID', 'Empty input data (base64).');
  }

  // IMPORTANT: never log payload/challenge/signature. We keep only stable error metadata.
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$dataBase64 = [string]$env:VRPLIKE_SIGN_DATA_BASE64",
    "$thumbRaw = [string]$env:VRPLIKE_SIGN_THUMBPRINT",
    "$thumb = ($thumbRaw -replace '[^0-9a-fA-F]', '').ToUpper()",
    "$checkedStores = @('Cert:\\CurrentUser\\My','Cert:\\LocalMachine\\My')",
    '$cert = $null',
    '$certStore = $null',
    '',
    'function _emit_error([string]$code, [string]$message, $details) {',
    '  try {',
    '    $payload = @{ code = $code; message = $message; details = $details } | ConvertTo-Json -Compress',
    `    [Console]::Error.WriteLine('${ERROR_PREFIX}' + $payload)`,
    '  } catch {',
    '    [Console]::Error.WriteLine($message)',
    '  }',
    '}',
    '',
    'try {',
    "  $store = New-Object -ComObject 'CAdESCOM.Store'",
    '  # Try CurrentUser\\My first',
    "  $store.Open(2, 'My', 0)", // 2 = current user
    '  $found = $store.Certificates.Find(0, $thumb, $false)', // 0 = SHA1 hash
    '  if ($found -and $found.Count -gt 0) {',
    '    $cert = $found.Item(1)',
    "    $certStore = 'Cert:\\CurrentUser\\My'",
    '  }',
    '  $store.Close()',
    '',
    '  if (-not $cert) {',
    "    $store.Open(1, 'My', 0)", // 1 = local machine
    '    $found = $store.Certificates.Find(0, $thumb, $false)',
    '    if ($found -and $found.Count -gt 0) {',
    '      $cert = $found.Item(1)',
    "      $certStore = 'Cert:\\LocalMachine\\My'",
    '    }',
    '    $store.Close()',
    '  }',
    '} catch {',
    '  $msg = $_.Exception.Message',
    '  $hr = $null',
    '  try { $hr = ("0x{0:X8}" -f $_.Exception.HResult) } catch {}',
    '  _emit_error "CADESCOM_NOT_AVAILABLE" "Компонента CAdESCOM недоступна (не установлена/не зарегистрирована) — подпись через COM невозможна." @{ thumbprint=$thumb; checkedStores=$checkedStores; hresult=$hr; raw=$msg }',
    '  exit 10',
    '}',
    '',
    'if (-not $cert) {',
    '  _emit_error "CERT_NOT_FOUND" "Сертификат с закрытым ключом не найден по thumbprint." @{ thumbprint=$thumb; checkedStores=$checkedStores }',
    '  exit 11',
    '}',
    '',
    'try {',
    '  if (-not $cert.HasPrivateKey) {',
    '    _emit_error "CERT_NO_PRIVATE_KEY" "Сертификат найден, но закрытый ключ недоступен (HasPrivateKey=false)." @{ thumbprint=$thumb; checkedStores=$checkedStores; foundInStore=$certStore }',
    '    exit 12',
    '  }',
    '} catch {',
    '  # If HasPrivateKey probing fails, treat as signing failure (stable).',
    '  $msg = $_.Exception.Message',
    '  _emit_error "SIGNING_FAILED" "Подпись не выполнена (не удалось проверить закрытый ключ)." @{ thumbprint=$thumb; checkedStores=$checkedStores; foundInStore=$certStore; raw=$msg }',
    '  exit 13',
    '}',
    '',
    'try {',
    "  $signedData = New-Object -ComObject 'CAdESCOM.CadesSignedData'",
    "  $signer = New-Object -ComObject 'CAdESCOM.CPSigner'",
    '  $signedData.ContentEncoding = 1', // CADESCOM_BASE64_TO_BINARY
    '  $signedData.Content = $dataBase64',
    '  $signer.Certificate = $cert',
    '  $sig = $signedData.SignCades($signer, 1, $false)', // 1 = CADES_BES, attached
    "  $clean = ($sig -replace '-----BEGIN[^-]*-----','' -replace '-----END[^-]*-----','') -replace '\\s',''",
    '  [Console]::Out.Write($clean)',
    '  exit 0',
    '} catch {',
    '  $msg = $_.Exception.Message',
    '  $hr = $null',
    '  try { $hr = ("0x{0:X8}" -f $_.Exception.HResult) } catch {}',
    '  _emit_error "SIGNING_FAILED" "Подпись не выполнена (CAdESCOM)." @{ thumbprint=$thumb; checkedStores=$checkedStores; foundInStore=$certStore; hresult=$hr; raw=$msg }',
    '  exit 14',
    '}',
  ].join('\n');

  const res = await runPowerShell({
    script,
    env: {
      VRPLIKE_SIGN_DATA_BASE64: dataBase64,
      VRPLIKE_SIGN_THUMBPRINT: thumbprint,
    },
    timeoutMs: 20000,
  });

  if (res.exitCode !== 0) {
    const parsed = parseErrorFromStderr(res.stderr);
    if (parsed) {
      throw new SignerError(parsed.code, parsed.message, parsed.details);
    }
    throw mapPowerShellRawError(res.stderr, { thumbprint, checkedStores: ['Cert:\\CurrentUser\\My', 'Cert:\\LocalMachine\\My'] });
  }

  const signatureBase64 = stripPemAndWhitespace(res.stdout);
  if (!signatureBase64) {
    throw new SignerError('SIGNING_FAILED', 'Подпись не выполнена (пустой результат CAdESCOM).', {
      thumbprint,
      checkedStores: ['Cert:\\CurrentUser\\My', 'Cert:\\LocalMachine\\My'],
    });
  }

  return { signatureBase64 };
}

export async function listCertsWithPrivateKeyViaPowerShell(): Promise<CadesCertInfo[]> {
  if (process.platform !== 'win32') return [];

  const checkedStores = ['CurrentUser\\My', 'LocalMachine\\My'];
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$out = @()',
    "Get-ChildItem -Path 'Cert:\\CurrentUser\\My' | Where-Object { $_.HasPrivateKey -eq $true } | ForEach-Object {",
    "  $out += [PSCustomObject]@{ thumbprint = [string]$_.Thumbprint; store = 'CurrentUser\\\\My'; hasPrivateKey = [bool]$_.HasPrivateKey }",
    '}',
    "Get-ChildItem -Path 'Cert:\\LocalMachine\\My' | Where-Object { $_.HasPrivateKey -eq $true } | ForEach-Object {",
    "  $out += [PSCustomObject]@{ thumbprint = [string]$_.Thumbprint; store = 'LocalMachine\\\\My'; hasPrivateKey = [bool]$_.HasPrivateKey }",
    '}',
    '$out | ConvertTo-Json -Compress',
  ].join('\n');

  let res: RunResult;
  try {
    res = await runPowerShell({ script, env: {}, timeoutMs: 15000 });
  } catch (e: any) {
    throw new SignerError('CRYPTOAPI_FAILED', 'Не удалось проверить сертификаты Windows (PowerShell).', {
      checkedStores,
      originalErrorMessage: e instanceof Error ? e.message : String(e),
    });
  }

  if (res.exitCode !== 0) {
    throw new SignerError('CRYPTOAPI_FAILED', 'Не удалось проверить сертификаты Windows (PowerShell).', {
      checkedStores,
      originalErrorMessage: (res.stderr || res.stdout || '').trim() || undefined,
    });
  }

  const raw = String(res.stdout ?? '').trim();
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : [];
  } catch {
    throw new SignerError('CRYPTOAPI_FAILED', 'Не удалось проверить сертификаты Windows (PowerShell).', {
      checkedStores,
      originalErrorMessage: 'Invalid JSON from PowerShell.',
    });
  }

  const arr = Array.isArray(parsed) ? parsed : [parsed];
  const out: CadesCertInfo[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const thumbprintRaw = (item as any).thumbprint;
    const storeRaw = (item as any).store;
    const hasPrivateKeyRaw = (item as any).hasPrivateKey;

    const thumbprint = normalizeThumbprintFromPowerShell(
      typeof thumbprintRaw === 'string' ? thumbprintRaw : String(thumbprintRaw ?? ''),
    );
    const store = typeof storeRaw === 'string' ? storeRaw : String(storeRaw ?? '');
    const hasPrivateKey = Boolean(hasPrivateKeyRaw);

    if (!thumbprint) continue;
    if (store !== 'CurrentUser\\My' && store !== 'LocalMachine\\My') continue;
    out.push({ thumbprint, store, hasPrivateKey });
  }
  return out;
}

