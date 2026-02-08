import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function promptSelectCertificateWinHta(args: {
  expectedInn: string;
  candidates: Array<{ thumbprint: string; subject: string; validTo: string | null }>;
  defaultThumbprint?: string;
  allowRememberSelection: boolean;
  timeoutMs: number;
}): Promise<{ thumbprint: string; remember: boolean }> {
  const root = path.join(tmpdir(), 'vrplike-signer');
  const id = randomUUID();
  const htaPath = path.join(root, `cert-select-${id}.hta`);
  const outPath = path.join(root, `cert-select-${id}.json`);

  try {
    try {
      mkdirSync(root, { recursive: true });
    } catch {
      // ignore best-effort
    }

    const optionsHtml = args.candidates
      .map((c) => {
        const label = `${c.thumbprint} — ${c.subject}${c.validTo ? ` (validTo: ${c.validTo})` : ''}`;
        const selected = args.defaultThumbprint && c.thumbprint === args.defaultThumbprint ? ' selected' : '';
        return `<option value="${escapeHtml(c.thumbprint)}"${selected}>${escapeHtml(label)}</option>`;
      })
      .join('\n');

    const rememberBlock = args.allowRememberSelection
      ? `<label style="display:flex;gap:8px;align-items:center;margin-top:12px;">
           <input type="checkbox" id="remember" />
           <span>Закрепить выбор для этого ИНН (локально)</span>
         </label>`
      : '';

    const html = `<!doctype html>
<html>
<head>
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>vrplike Signer</title>
  <hta:application id="vrplikeSigner" border="thin" caption="yes" showintaskbar="yes" singleinstance="yes" sysmenu="yes" />
  <style>
    body { font-family: Segoe UI, Arial, sans-serif; margin: 16px; }
    .muted { color: #666; font-size: 12px; }
    select { width: 100%; font-family: Consolas, monospace; }
    .row { display:flex; gap:8px; margin-top: 12px; }
    button { padding: 8px 12px; }
  </style>
</head>
<body>
  <div><b>Выберите сертификат для ИНН=${escapeHtml(args.expectedInn)}</b></div>
  <div class="muted" style="margin-top:6px;">Найдено: ${args.candidates.length}. При нескольких сертификатах выбор требуется всегда.</div>

  <div style="margin-top:12px;">
    <select id="cert" size="10">${optionsHtml}</select>
    ${rememberBlock}
  </div>

  <div class="row">
    <button id="ok">OK</button>
    <button id="cancel">Отмена</button>
  </div>

  <script type="text/javascript">
    function writeOut(obj) {
      try {
        var shell = new ActiveXObject("WScript.Shell");
        var outPath = shell.ExpandEnvironmentStrings("%VRPLIKE_PROMPT_OUT%");
        var fso = new ActiveXObject("Scripting.FileSystemObject");
        var fh = fso.CreateTextFile(outPath, true);
        fh.WriteLine(JSON.stringify(obj));
        fh.Close();
      } catch (e) {
        // ignore
      }
    }

    document.getElementById("ok").onclick = function () {
      var sel = document.getElementById("cert");
      var v = sel && sel.value ? String(sel.value) : "";
      if (!v) { alert("Выберите сертификат."); return; }
      var rememberEl = document.getElementById("remember");
      var remember = rememberEl ? Boolean(rememberEl.checked) : false;
      writeOut({ thumbprint: v, remember: remember });
      window.close();
    };
    document.getElementById("cancel").onclick = function () {
      writeOut({ cancelled: true });
      window.close();
    };
  </script>
</body>
</html>`;

    writeFileSync(htaPath, html, 'utf8');

    const child = spawn('mshta.exe', [htaPath], {
      stdio: 'ignore',
      windowsHide: false,
      env: { ...process.env, VRPLIKE_PROMPT_OUT: outPath },
    });

    const exitCode = await new Promise<number>((resolve, reject) => {
      let t: NodeJS.Timeout | null = null;
      t = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // ignore
        }
        reject(new Error('certificate selection timed out'));
      }, args.timeoutMs);

      child.on('error', (e) => {
        if (t) clearTimeout(t);
        reject(e);
      });
      child.on('close', (code) => {
        if (t) clearTimeout(t);
        resolve(typeof code === 'number' ? code : 0);
      });
    });

    void exitCode; // best-effort

    if (!existsSync(outPath)) {
      throw new Error('certificate selection cancelled');
    }
    const raw = readFileSync(outPath, 'utf8');
    const j = JSON.parse(raw) as any;
    if (j?.cancelled) {
      throw new Error('certificate selection cancelled');
    }
    const thumbprint = typeof j?.thumbprint === 'string' && j.thumbprint.trim() ? j.thumbprint.trim() : null;
    if (!thumbprint) {
      throw new Error('certificate selection cancelled');
    }
    return { thumbprint, remember: Boolean(j?.remember) };
  } finally {
    try {
      if (existsSync(htaPath)) rmSync(htaPath, { force: true });
      if (existsSync(outPath)) rmSync(outPath, { force: true });
    } catch {
      // ignore
    }
  }
}

