"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.smokeSignChallenge = smokeSignChallenge;
const cryptopro_config_1 = require("./cryptopro-config");
const cryptopro_signer_1 = require("./cryptopro-signer");
async function smokeSignChallenge(input) {
    var _a;
    const cfg = (0, cryptopro_config_1.loadCryptoProConfigFromEnv)(process.env);
    try {
        const buf = await (0, cryptopro_signer_1.signAuthChallengeAttached)(input.challenge, { certificateRef: input.certificateRef }, { config: cfg });
        return { bytesLength: buf.length };
    }
    catch (e) {
        if (e instanceof cryptopro_signer_1.SignerError)
            throw e;
        throw new Error(String((_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e));
    }
}
//# sourceMappingURL=cryptopro-smoke.js.map