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
exports.SignerError = void 0;
exports.signAuthChallengeAttached = signAuthChallengeAttached;
const promises_1 = require("fs/promises");
const path = __importStar(require("path"));
const cryptopro_config_1 = require("./cryptopro-config");
const cryptopro_tool_resolver_1 = require("./cryptopro-tool-resolver");
const spawn_1 = require("./spawn");
const signer_error_1 = require("./signer-error");
Object.defineProperty(exports, "SignerError", { enumerable: true, get: function () { return signer_error_1.SignerError; } });
function defaultCryptcpTemplate(sel) {
    if (sel.kind === 'thumbprint')
        return '-sign -thumbprint {THUMBPRINT} -in {IN} -out {OUT}';
    if (sel.kind === 'subject')
        return '-sign -dn {SUBJECT} -in {IN} -out {OUT}';
    return '-sign -cont {CONTAINER} -in {IN} -out {OUT}';
}
function defaultCsptestTemplate(sel) {
    if (sel.kind === 'thumbprint')
        return '-sfsign -thumbprint {THUMBPRINT} -in {IN} -out {OUT}';
    if (sel.kind === 'subject')
        return '-sfsign -dn {SUBJECT} -in {IN} -out {OUT}';
    return '-sfsign -cont {CONTAINER} -in {IN} -out {OUT}';
}
async function bestEffortRm(p) {
    try {
        await (0, promises_1.rm)(p, { recursive: true, force: true });
    }
    catch (_a) {
    }
}
async function signAuthChallengeAttached(challenge, opts, injected) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const config = (_a = injected === null || injected === void 0 ? void 0 : injected.config) !== null && _a !== void 0 ? _a : (0, cryptopro_config_1.loadCryptoProConfigFromEnv)(process.env);
    if (config.signFormat !== 'ATTACHED_CMS') {
        throw new signer_error_1.SignerError('UNSUPPORTED_FORMAT', `Unsupported sign format: ${config.signFormat}`);
    }
    const selection = (0, cryptopro_config_1.resolveCertificateSelection)({
        certificateRef: opts.certificateRef,
        certThumbprint: config.certThumbprint,
        certSubject: config.certSubject,
        containerName: config.containerName,
    });
    if (!selection) {
        throw new signer_error_1.SignerError('NO_CERTIFICATE_SELECTED', 'No certificate selected. Provide payload.certificateRef (thumbprint/alias) or set CERT_THUMBPRINT / CERT_SUBJECT / CONTAINER_NAME in agent env.');
    }
    const tmpBase = config.tmpDir;
    const dir = await (0, promises_1.mkdtemp)(path.join(tmpBase, 'vrplike-cryptopro-'));
    const inPath = path.join(dir, 'input.txt');
    const outPath = path.join(dir, 'signature.p7s');
    try {
        await (0, promises_1.writeFile)(inPath, challenge, { encoding: 'utf8' });
        const resolved = process.platform === 'win32'
            ? await (0, cryptopro_tool_resolver_1.resolveCryptoProTool)({
                preferredTool: config.tool,
                envCryptcpPath: (_b = process.env.CRYPTCP_PATH) !== null && _b !== void 0 ? _b : null,
                envCsptestPath: (_c = process.env.CSPTEST_PATH) !== null && _c !== void 0 ? _c : null,
                cryptoProHome: (_e = (_d = config.cryptoProHome) !== null && _d !== void 0 ? _d : process.env.CRYPTOPRO_HOME) !== null && _e !== void 0 ? _e : null,
            })
            : null;
        const effectiveTool = ((_f = resolved === null || resolved === void 0 ? void 0 : resolved.tool) !== null && _f !== void 0 ? _f : config.tool);
        const template = effectiveTool === 'cryptcp'
            ? (_g = config.cryptcpArgsTemplate) !== null && _g !== void 0 ? _g : defaultCryptcpTemplate(selection)
            : (_h = config.csptestArgsTemplate) !== null && _h !== void 0 ? _h : defaultCsptestTemplate(selection);
        const args = (0, cryptopro_config_1.buildArgsFromTemplate)(template, {
            IN: inPath,
            OUT: outPath,
            CERTIFICATE_REF: opts.certificateRef,
            THUMBPRINT: selection.kind === 'thumbprint' ? selection.thumbprint : undefined,
            SUBJECT: selection.kind === 'subject' ? selection.subject : undefined,
            CONTAINER: selection.kind === 'container' ? selection.containerName : undefined,
            PIN: config.certPin,
        });
        const cmd = process.platform === 'win32'
            ? resolved.path
            : effectiveTool === 'cryptcp'
                ? config.cryptcpPath
                : config.csptestPath;
        const res = await (0, spawn_1.spawnWithTimeout)(cmd, args, config.timeoutMs);
        if (res.exitCode !== 0) {
            const tail = res.stderrTrunc.trim() || res.stdoutTrunc.trim();
            const hint = tail ? ` Tool output: ${tail}` : '';
            throw new signer_error_1.SignerError('SIGN_FAILED', `CryptoPro signing failed (tool=${effectiveTool}, exitCode=${String(res.exitCode)}).${hint}`);
        }
        const signatureBytes = await (0, promises_1.readFile)(outPath);
        if (!signatureBytes.length) {
            throw new signer_error_1.SignerError('SIGN_FAILED', 'CryptoPro produced empty signature output');
        }
        return signatureBytes;
    }
    catch (err) {
        if (err instanceof signer_error_1.SignerError)
            throw err;
        throw new signer_error_1.SignerError('IO_ERROR', `Signing IO error: ${String((_j = err === null || err === void 0 ? void 0 : err.message) !== null && _j !== void 0 ? _j : err)}`);
    }
    finally {
        await bestEffortRm(dir);
    }
}
//# sourceMappingURL=cryptopro-signer.js.map