"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cryptopro_smoke_1 = require("../cryptopro/cryptopro-smoke");
const cryptopro_signer_1 = require("../cryptopro/cryptopro-signer");
function getArgValue(argv, name) {
    const idx = argv.indexOf(name);
    if (idx === -1)
        return undefined;
    const v = argv[idx + 1];
    if (!v)
        return undefined;
    return v;
}
async function main() {
    var _a, _b, _c;
    const challenge = (_a = getArgValue(process.argv, '--challenge')) !== null && _a !== void 0 ? _a : getArgValue(process.argv, '-c');
    const certificateRef = (_b = getArgValue(process.argv, '--certificateRef')) !== null && _b !== void 0 ? _b : getArgValue(process.argv, '--cert');
    if (!challenge) {
        console.error('Usage: node dist/cli/smoke-sign-challenge.js --challenge "ping" [--certificateRef "<thumbprint-or-alias>"]');
        process.exit(2);
    }
    try {
        const r = await (0, cryptopro_smoke_1.smokeSignChallenge)({ challenge, certificateRef });
        console.log(`OK signature bytes length=${r.bytesLength}`);
        process.exit(0);
    }
    catch (e) {
        if (e instanceof cryptopro_signer_1.SignerError) {
            console.error(`ERROR code=${e.code} message=${e.message}`);
            process.exit(1);
        }
        console.error(`ERROR ${String((_c = e === null || e === void 0 ? void 0 : e.message) !== null && _c !== void 0 ? _c : e)}`);
        process.exit(1);
    }
}
main();
//# sourceMappingURL=smoke-sign-challenge.js.map