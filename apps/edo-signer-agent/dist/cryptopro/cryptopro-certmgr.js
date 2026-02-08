"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractInnFromSubject = extractInnFromSubject;
exports.listCertificatesCertmgr = listCertificatesCertmgr;
const cryptopro_config_1 = require("./cryptopro-config");
const spawn_1 = require("./spawn");
const signer_error_1 = require("./signer-error");
function toNonEmptyTrimmed(v) {
    return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function normalizeInn(v) {
    return v.replace(/\D+/g, '');
}
function extractInnFromSubject(subject) {
    const s = String(subject !== null && subject !== void 0 ? subject : '');
    const m1 = s.match(/(?:^|[,;\s])INN\s*=\s*([0-9]{10,12})(?:$|[,;\s])/i);
    if (m1 === null || m1 === void 0 ? void 0 : m1[1])
        return normalizeInn(m1[1]);
    const m2 = s.match(/(?:^|[,;\s])ИНН\s*=\s*([0-9]{10,12})(?:$|[,;\s])/i);
    if (m2 === null || m2 === void 0 ? void 0 : m2[1])
        return normalizeInn(m2[1]);
    const m3 = s.match(/(?:^|[,;\s])1\.2\.643\.3\.131\.1\.1\s*=\s*([0-9]{10,12})(?:$|[,;\s])/i);
    if (m3 === null || m3 === void 0 ? void 0 : m3[1])
        return normalizeInn(m3[1]);
    return null;
}
function normalizeThumbprint(s) {
    return String(s !== null && s !== void 0 ? s : '').replace(/\s+/g, '').toUpperCase();
}
async function listCertificatesCertmgr(env = process.env) {
    var _a, _b, _c, _d, _e;
    const cfg = (0, cryptopro_config_1.loadCryptoProConfigFromEnv)(env);
    const certmgrPath = (_a = toNonEmptyTrimmed(env.CERTMGR_PATH)) !== null && _a !== void 0 ? _a : 'certmgr';
    const res = await (0, spawn_1.spawnWithTimeout)(certmgrPath, ['-list', '-store', 'uMy'], cfg.timeoutMs);
    if (res.exitCode !== 0) {
        const tail = res.stderrTrunc.trim() || res.stdoutTrunc.trim();
        throw new signer_error_1.SignerError('CERT_LIST_FAILED', `certmgr failed (exitCode=${String(res.exitCode)}). ${tail}`.trim());
    }
    const out = res.stdoutTrunc;
    if (!out.trim())
        return [];
    const blocks = out.split(/\r?\n\r?\n+/g).map((b) => b.trim()).filter(Boolean);
    const certs = [];
    for (const b of blocks) {
        const lines = b.split(/\r?\n/g).map((l) => l.trim());
        const subjectLine = (_b = lines.find((l) => /^Subject\s*:/i.test(l))) !== null && _b !== void 0 ? _b : null;
        const hashLine = (_c = lines.find((l) => /^(SHA1\s+Hash|SHA-1\s+Hash)\s*:/i.test(l))) !== null && _c !== void 0 ? _c : null;
        const validToLine = (_e = (_d = lines.find((l) => /^Valid\s+To\s*:/i.test(l))) !== null && _d !== void 0 ? _d : lines.find((l) => /^Not\s+After\s*:/i.test(l))) !== null && _e !== void 0 ? _e : null;
        const subject = subjectLine ? subjectLine.replace(/^Subject\s*:/i, '').trim() : '';
        const hashRaw = hashLine ? hashLine.replace(/^(SHA1\s+Hash|SHA-1\s+Hash)\s*:/i, '').trim() : '';
        const thumbprint = normalizeThumbprint(hashRaw);
        if (!thumbprint || thumbprint.length < 20)
            continue;
        const validTo = validToLine ? validToLine.replace(/^(Valid\s+To|Not\s+After)\s*:/i, '').trim() : null;
        certs.push({
            thumbprint,
            subject: subject || b.slice(0, 200),
            innExtracted: subject ? extractInnFromSubject(subject) : null,
            validTo: validTo || null,
            provider: 'CRYPTOPRO_CERTMGR',
        });
    }
    const uniq = new Map();
    for (const c of certs) {
        if (!uniq.has(c.thumbprint))
            uniq.set(c.thumbprint, c);
    }
    return Array.from(uniq.values());
}
//# sourceMappingURL=cryptopro-certmgr.js.map