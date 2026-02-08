"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.filterCertificatesByInn = filterCertificatesByInn;
exports.chooseCertificateThumbprint = chooseCertificateThumbprint;
const signer_error_1 = require("./cryptopro/signer-error");
function normalizeInn(v) {
    return String(v !== null && v !== void 0 ? v : '').replace(/\D+/g, '');
}
function filterCertificatesByInn(certs, expectedInnRaw) {
    const expectedInn = normalizeInn(expectedInnRaw);
    return (certs !== null && certs !== void 0 ? certs : []).filter((c) => { var _a; return normalizeInn((_a = c.innExtracted) !== null && _a !== void 0 ? _a : '') === expectedInn; });
}
async function chooseCertificateThumbprint(args) {
    var _a, _b;
    const expectedInn = normalizeInn(args.expectedInn);
    if (!expectedInn) {
        throw new signer_error_1.SignerError('CERT_LIST_FAILED', 'expectedInn is required for certificate selection');
    }
    const candidates = (_a = args.candidates) !== null && _a !== void 0 ? _a : [];
    if (candidates.length === 0) {
        throw new signer_error_1.SignerError('NO_CERT_FOUND_FOR_INN', `No certificate found for INN=${expectedInn}`);
    }
    if (candidates.length === 1) {
        return { thumbprint: candidates[0].thumbprint, remember: false };
    }
    const pinned = ((_b = args.pinnedThumbprint) === null || _b === void 0 ? void 0 : _b.trim()) || undefined;
    return args.prompt({
        expectedInn,
        candidates,
        defaultThumbprint: pinned && candidates.some((c) => c.thumbprint === pinned) ? pinned : undefined,
        allowRememberSelection: args.allowRememberSelection,
    });
}
//# sourceMappingURL=certificate-selection.js.map