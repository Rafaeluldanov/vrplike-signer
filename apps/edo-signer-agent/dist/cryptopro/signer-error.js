"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignerError = void 0;
class SignerError extends Error {
    constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
    }
}
exports.SignerError = SignerError;
//# sourceMappingURL=signer-error.js.map