"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDeeplinkArg = isDeeplinkArg;
exports.sanitizeLauncherArgs = sanitizeLauncherArgs;
exports.computeLauncherForwardMessage = computeLauncherForwardMessage;
exports.computeBackgroundChildArgs = computeBackgroundChildArgs;
exports.shouldRunLauncher = shouldRunLauncher;
function isDeeplinkArg(a) {
    return typeof a === 'string' && a.startsWith('vrplike-signer://');
}
function sanitizeLauncherArgs(rawArgs) {
    return rawArgs.filter((a) => a !== '--background' && a !== '--console');
}
function computeLauncherForwardMessage(rawArgs) {
    var _a;
    const args = sanitizeLauncherArgs(rawArgs);
    const deeplink = (_a = args.find(isDeeplinkArg)) !== null && _a !== void 0 ? _a : null;
    if (deeplink)
        return { type: 'DEEPLINK', url: deeplink };
    return { type: 'ARGS', argv: args };
}
function computeBackgroundChildArgs(rawArgs) {
    const args = sanitizeLauncherArgs(rawArgs);
    return ['--background', ...args];
}
function shouldRunLauncher(args) {
    var _a;
    if (args.platform !== 'win32')
        return false;
    if (!((_a = globalThis.process) === null || _a === void 0 ? void 0 : _a.pkg))
        return false;
    if (args.rawArgs.includes('--background'))
        return false;
    if (args.rawArgs.includes('--console'))
        return false;
    if (args.rawArgs.includes('--doctor'))
        return false;
    if (args.rawArgs.includes('--help') || args.rawArgs.includes('-h'))
        return false;
    return true;
}
//# sourceMappingURL=launcher-plan.js.map