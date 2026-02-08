"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const launcher_plan_1 = require("./launcher-plan");
describe('launcher-plan', () => {
    test('sanitizeLauncherArgs strips internal flags', () => {
        expect((0, launcher_plan_1.sanitizeLauncherArgs)(['--background', 'a', '--console', 'b'])).toEqual(['a', 'b']);
    });
    test('computeLauncherForwardMessage prefers deeplink', () => {
        const msg = (0, launcher_plan_1.computeLauncherForwardMessage)(['--wssUrl', 'wss://x', 'vrplike-signer://pair?token=t&wsUrl=wss%3A%2F%2Fx&le=1']);
        expect(msg).toEqual({ type: 'DEEPLINK', url: 'vrplike-signer://pair?token=t&wsUrl=wss%3A%2F%2Fx&le=1' });
    });
    test('computeLauncherForwardMessage falls back to ARGS', () => {
        const msg = (0, launcher_plan_1.computeLauncherForwardMessage)(['--wssUrl', 'wss://x', '--console']);
        expect(msg).toEqual({ type: 'ARGS', argv: ['--wssUrl', 'wss://x'] });
    });
    test('computeBackgroundChildArgs adds --background', () => {
        expect((0, launcher_plan_1.computeBackgroundChildArgs)(['a', '--console', 'b'])).toEqual(['--background', 'a', 'b']);
    });
    test('shouldRunLauncher only for pkg win32 default', () => {
        const prev = process.pkg;
        try {
            process.pkg = { enabled: true };
            expect((0, launcher_plan_1.shouldRunLauncher)({ platform: 'win32', rawArgs: [] })).toBe(true);
            expect((0, launcher_plan_1.shouldRunLauncher)({ platform: 'win32', rawArgs: ['--console'] })).toBe(false);
            expect((0, launcher_plan_1.shouldRunLauncher)({ platform: 'win32', rawArgs: ['--background'] })).toBe(false);
            expect((0, launcher_plan_1.shouldRunLauncher)({ platform: 'linux', rawArgs: [] })).toBe(false);
        }
        finally {
            process.pkg = prev;
        }
    });
});
//# sourceMappingURL=launcher-plan.spec.js.map