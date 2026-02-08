"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.looksLikeThumbprint = looksLikeThumbprint;
exports.normalizeThumbprint = normalizeThumbprint;
exports.loadCryptoProConfigFromEnv = loadCryptoProConfigFromEnv;
exports.resolveCertificateSelection = resolveCertificateSelection;
exports.splitArgsTemplate = splitArgsTemplate;
exports.substituteTemplateArg = substituteTemplateArg;
exports.buildArgsFromTemplate = buildArgsFromTemplate;
const os_1 = require("os");
function toNonEmptyStringNoTrim(v) {
    return typeof v === 'string' && v.length > 0 ? v : null;
}
function toNonEmptyTrimmed(v) {
    return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function looksLikeThumbprint(s) {
    const v = s.replace(/\s+/g, '');
    return /^[0-9a-fA-F]{40}$/.test(v) || /^[0-9a-fA-F]{64}$/.test(v);
}
function normalizeThumbprint(s) {
    return s.replace(/\s+/g, '').toUpperCase();
}
function loadCryptoProConfigFromEnv(env = process.env) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    const tool = (_a = toNonEmptyTrimmed(env.CRYPTOPRO_TOOL)) !== null && _a !== void 0 ? _a : 'cryptcp';
    if (tool !== 'cryptcp' && tool !== 'csptest') {
        throw new Error(`Invalid CRYPTOPRO_TOOL=${String(env.CRYPTOPRO_TOOL)} (allowed: cryptcp|csptest)`);
    }
    const cryptoProHome = (_b = toNonEmptyTrimmed(env.CRYPTOPRO_HOME)) !== null && _b !== void 0 ? _b : undefined;
    const cryptcpPath = (_c = toNonEmptyTrimmed(env.CRYPTCP_PATH)) !== null && _c !== void 0 ? _c : 'cryptcp';
    const csptestPath = (_d = toNonEmptyTrimmed(env.CSPTEST_PATH)) !== null && _d !== void 0 ? _d : 'csptest';
    const cryptcpArgsTemplate = (_e = toNonEmptyStringNoTrim(env.CRYPTCP_ARGS_TEMPLATE)) !== null && _e !== void 0 ? _e : undefined;
    const csptestArgsTemplate = (_f = toNonEmptyStringNoTrim(env.CSPTEST_ARGS_TEMPLATE)) !== null && _f !== void 0 ? _f : undefined;
    const certThumbprint = (_g = toNonEmptyTrimmed(env.CERT_THUMBPRINT)) !== null && _g !== void 0 ? _g : undefined;
    const certSubject = (_h = toNonEmptyStringNoTrim(env.CERT_SUBJECT)) !== null && _h !== void 0 ? _h : undefined;
    const containerName = (_j = toNonEmptyStringNoTrim(env.CONTAINER_NAME)) !== null && _j !== void 0 ? _j : undefined;
    const certPin = (_k = toNonEmptyStringNoTrim(env.CERT_PIN)) !== null && _k !== void 0 ? _k : undefined;
    const signFormat = (_l = toNonEmptyTrimmed(env.SIGN_FORMAT)) !== null && _l !== void 0 ? _l : 'ATTACHED_CMS';
    if (signFormat !== 'ATTACHED_CMS') {
        throw new Error(`Unsupported SIGN_FORMAT=${String(env.SIGN_FORMAT)} (only ATTACHED_CMS is supported in MVP)`);
    }
    const tmpDir = (_m = toNonEmptyStringNoTrim(env.TMP_DIR)) !== null && _m !== void 0 ? _m : (0, os_1.tmpdir)();
    const timeoutMsRaw = toNonEmptyTrimmed(env.CRYPTOPRO_TIMEOUT_MS);
    const timeoutMs = timeoutMsRaw ? Number(timeoutMsRaw) : 20000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error(`Invalid CRYPTOPRO_TIMEOUT_MS=${String(env.CRYPTOPRO_TIMEOUT_MS)} (expected positive number)`);
    }
    return {
        tool,
        cryptoProHome,
        cryptcpPath,
        csptestPath,
        cryptcpArgsTemplate,
        csptestArgsTemplate,
        certThumbprint,
        certSubject,
        containerName,
        certPin,
        signFormat,
        tmpDir,
        timeoutMs,
    };
}
function resolveCertificateSelection(input) {
    var _a, _b, _c, _d;
    const { certificateRef, certThumbprint, certSubject, containerName } = input;
    const ref = (_a = toNonEmptyTrimmed(certificateRef)) !== null && _a !== void 0 ? _a : null;
    if (ref && looksLikeThumbprint(ref)) {
        return { kind: 'thumbprint', thumbprint: normalizeThumbprint(ref) };
    }
    if (ref) {
        return { kind: 'subject', subject: ref };
    }
    const envThumb = (_b = toNonEmptyTrimmed(certThumbprint)) !== null && _b !== void 0 ? _b : null;
    if (envThumb) {
        return { kind: 'thumbprint', thumbprint: normalizeThumbprint(envThumb) };
    }
    const subj = (_c = toNonEmptyStringNoTrim(certSubject)) !== null && _c !== void 0 ? _c : null;
    if (subj) {
        return { kind: 'subject', subject: subj };
    }
    const cont = (_d = toNonEmptyStringNoTrim(containerName)) !== null && _d !== void 0 ? _d : null;
    if (cont) {
        return { kind: 'container', containerName: cont };
    }
    return null;
}
function splitArgsTemplate(template) {
    const out = [];
    let cur = '';
    let quote = null;
    let esc = false;
    const flush = () => {
        if (cur.length)
            out.push(cur);
        cur = '';
    };
    for (let i = 0; i < template.length; i++) {
        const ch = template[i];
        if (esc) {
            cur += ch;
            esc = false;
            continue;
        }
        if (ch === '\\') {
            esc = true;
            continue;
        }
        if (quote) {
            if (ch === quote) {
                quote = null;
            }
            else {
                cur += ch;
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (/\s/.test(ch)) {
            flush();
            continue;
        }
        cur += ch;
    }
    flush();
    return out;
}
function substituteTemplateArg(arg, vars) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const rep = (s, from, to) => s.split(from).join(to);
    let s = arg;
    s = rep(s, '{IN}', vars.IN);
    s = rep(s, '{OUT}', vars.OUT);
    s = rep(s, '{CERTIFICATE_REF}', (_a = vars.CERTIFICATE_REF) !== null && _a !== void 0 ? _a : '');
    s = rep(s, '{THUMBPRINT}', (_b = vars.THUMBPRINT) !== null && _b !== void 0 ? _b : '');
    s = rep(s, '{SUBJECT}', (_c = vars.SUBJECT) !== null && _c !== void 0 ? _c : '');
    s = rep(s, '{CONTAINER}', (_d = vars.CONTAINER) !== null && _d !== void 0 ? _d : '');
    s = rep(s, '{PIN}', (_e = vars.PIN) !== null && _e !== void 0 ? _e : '');
    s = rep(s, '${IN}', vars.IN);
    s = rep(s, '${OUT}', vars.OUT);
    s = rep(s, '${CERTIFICATE_REF}', (_f = vars.CERTIFICATE_REF) !== null && _f !== void 0 ? _f : '');
    s = rep(s, '${THUMBPRINT}', (_g = vars.THUMBPRINT) !== null && _g !== void 0 ? _g : '');
    s = rep(s, '${SUBJECT}', (_h = vars.SUBJECT) !== null && _h !== void 0 ? _h : '');
    s = rep(s, '${CONTAINER}', (_j = vars.CONTAINER) !== null && _j !== void 0 ? _j : '');
    s = rep(s, '${PIN}', (_k = vars.PIN) !== null && _k !== void 0 ? _k : '');
    return s;
}
function buildArgsFromTemplate(template, vars) {
    const raw = splitArgsTemplate(template);
    return raw
        .map((a) => substituteTemplateArg(a, vars))
        .filter((a) => a.length > 0);
}
//# sourceMappingURL=cryptopro-config.js.map