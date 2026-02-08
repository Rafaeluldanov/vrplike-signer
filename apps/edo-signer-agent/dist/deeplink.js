"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseVrplikeSignerDeeplink = parseVrplikeSignerDeeplink;
exports.apiBaseFromWsUrl = apiBaseFromWsUrl;
exports.exchangeDeeplinkToken = exchangeDeeplinkToken;
const os_1 = require("os");
function toNonEmptyString(v) {
    return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function parseVrplikeSignerDeeplink(urlRaw) {
    var _a;
    const raw = String(urlRaw !== null && urlRaw !== void 0 ? urlRaw : '').trim();
    if (!raw)
        throw new Error('deeplink url is required');
    let u;
    try {
        u = new URL(raw);
    }
    catch (_b) {
        throw new Error('invalid deeplink url');
    }
    if (u.protocol !== 'vrplike-signer:') {
        throw new Error('invalid deeplink protocol');
    }
    const host = toNonEmptyString(u.hostname);
    const path = toNonEmptyString(u.pathname);
    const isPair = host === 'pair' || path === '/pair' || path === 'pair';
    if (!isPair) {
        throw new Error('unsupported deeplink path');
    }
    const token = toNonEmptyString(u.searchParams.get('token'));
    const wsUrl = toNonEmptyString(u.searchParams.get('wsUrl'));
    const le = (_a = toNonEmptyString(u.searchParams.get('le'))) !== null && _a !== void 0 ? _a : undefined;
    if (!token)
        throw new Error('deeplink token is required');
    if (!wsUrl)
        throw new Error('deeplink wsUrl is required');
    return { token, wsUrl, legalEntityId: le };
}
function apiBaseFromWsUrl(wsUrlRaw) {
    const raw = String(wsUrlRaw !== null && wsUrlRaw !== void 0 ? wsUrlRaw : '').trim();
    if (!raw)
        throw new Error('wsUrl is required');
    let u;
    try {
        u = new URL(raw);
    }
    catch (_a) {
        throw new Error('invalid wsUrl');
    }
    const proto = u.protocol;
    if (proto !== 'ws:' && proto !== 'wss:') {
        throw new Error('wsUrl must use ws/wss');
    }
    const httpProto = proto === 'wss:' ? 'https:' : 'http:';
    return `${httpProto}//${u.host}`;
}
async function exchangeDeeplinkToken(args) {
    var _a, _b, _c, _d, _e, _f;
    const apiBaseUrl = String((_a = args.apiBaseUrl) !== null && _a !== void 0 ? _a : '').trim().replace(/\/+$/, '');
    const token = String((_b = args.token) !== null && _b !== void 0 ? _b : '').trim();
    const legalEntityIdHint = (_c = toNonEmptyString(args.legalEntityId)) !== null && _c !== void 0 ? _c : undefined;
    if (!apiBaseUrl)
        throw new Error('apiBaseUrl is required');
    if (!token)
        throw new Error('token is required');
    const fetchFn = (_d = args.fetchImpl) !== null && _d !== void 0 ? _d : globalThis.fetch;
    if (typeof fetchFn !== 'function') {
        throw new Error('fetch is not available (Node 18+ required)');
    }
    const url = `${apiBaseUrl}/edo-signer/pair-by-deeplink`;
    const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.assign({ token, deviceInfo: {
                hostname: (0, os_1.hostname)(),
                version: args.version,
            } }, (legalEntityIdHint ? { legalEntityId: legalEntityIdHint } : {}))),
    });
    if (!res || typeof res.ok !== 'boolean') {
        throw new Error('pair-by-deeplink failed (no response)');
    }
    if (!res.ok) {
        const status = res.status;
        throw new Error(`pair-by-deeplink failed (status=${status})`);
    }
    const data = (await ((_f = (_e = res).json) === null || _f === void 0 ? void 0 : _f.call(_e)));
    if (data && typeof data === 'object' && data.status === 'already_connected') {
        return { status: 'already_connected' };
    }
    const agentId = toNonEmptyString(data === null || data === void 0 ? void 0 : data.agentId);
    const agentSecret = toNonEmptyString(data === null || data === void 0 ? void 0 : data.agentSecret);
    const wsUrl = toNonEmptyString(data === null || data === void 0 ? void 0 : data.wsUrl);
    const legalEntityId = toNonEmptyString(data === null || data === void 0 ? void 0 : data.legalEntityId);
    if (!agentId || !agentSecret || !wsUrl || !legalEntityId) {
        throw new Error('pair-by-deeplink returned invalid payload');
    }
    return { agentId, agentSecret, wsUrl, legalEntityId };
}
//# sourceMappingURL=deeplink.js.map