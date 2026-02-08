"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.promptSelectCertificateWinHta = promptSelectCertificateWinHta;
const fs_1 = require("fs");
const os_1 = require("os");
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const child_process_1 = require("child_process");
function escapeHtml(s) {
    return String(s !== null && s !== void 0 ? s : '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
async function promptSelectCertificateWinHta(args) {
    const root = path.join((0, os_1.tmpdir)(), 'vrplike-signer');
    const id = (0, crypto_1.randomUUID)();
    const htaPath = path.join(root, `cert-select-${id}.hta`);
    const outPath = path.join(root, `cert-select-${id}.json`);
    try {
        try {
            (0, fs_1.mkdirSync)(root, { recursive: true });
        }
        catch (_a) {
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
        (0, fs_1.writeFileSync)(htaPath, html, 'utf8');
        const child = (0, child_process_1.spawn)('mshta.exe', [htaPath], {
            stdio: 'ignore',
            windowsHide: false,
            env: Object.assign(Object.assign({}, process.env), { VRPLIKE_PROMPT_OUT: outPath }),
        });
        const exitCode = await new Promise((resolve, reject) => {
            let t = null;
            t = setTimeout(() => {
                try {
                    child.kill();
                }
                catch (_a) {
                }
                reject(new Error('certificate selection timed out'));
            }, args.timeoutMs);
            child.on('error', (e) => {
                if (t)
                    clearTimeout(t);
                reject(e);
            });
            child.on('close', (code) => {
                if (t)
                    clearTimeout(t);
                resolve(typeof code === 'number' ? code : 0);
            });
        });
        void exitCode;
        if (!(0, fs_1.existsSync)(outPath)) {
            throw new Error('certificate selection cancelled');
        }
        const raw = (0, fs_1.readFileSync)(outPath, 'utf8');
        const j = JSON.parse(raw);
        if (j === null || j === void 0 ? void 0 : j.cancelled) {
            throw new Error('certificate selection cancelled');
        }
        const thumbprint = typeof (j === null || j === void 0 ? void 0 : j.thumbprint) === 'string' && j.thumbprint.trim() ? j.thumbprint.trim() : null;
        if (!thumbprint) {
            throw new Error('certificate selection cancelled');
        }
        return { thumbprint, remember: Boolean(j === null || j === void 0 ? void 0 : j.remember) };
    }
    finally {
        try {
            if ((0, fs_1.existsSync)(htaPath))
                (0, fs_1.rmSync)(htaPath, { force: true });
            if ((0, fs_1.existsSync)(outPath))
                (0, fs_1.rmSync)(outPath, { force: true });
        }
        catch (_b) {
        }
    }
}
//# sourceMappingURL=win-hta-cert-select.js.map