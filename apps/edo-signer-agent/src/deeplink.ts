import { hostname } from 'os';

export type VrplikeSignerDeeplinkPair = {
  token: string;
  wsUrl: string;
  legalEntityId?: string;
};

function toNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function parseVrplikeSignerDeeplink(urlRaw: string): VrplikeSignerDeeplinkPair {
  const raw = String(urlRaw ?? '').trim();
  if (!raw) throw new Error('deeplink url is required');

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('invalid deeplink url');
  }

  if (u.protocol !== 'vrplike-signer:') {
    throw new Error('invalid deeplink protocol');
  }

  // Accept either vrplike-signer://pair?... (host=pair) or vrplike-signer:///pair?... (pathname=/pair)
  const host = toNonEmptyString(u.hostname);
  const path = toNonEmptyString(u.pathname);
  const isPair = host === 'pair' || path === '/pair' || path === 'pair';
  if (!isPair) {
    throw new Error('unsupported deeplink path');
  }

  const token = toNonEmptyString(u.searchParams.get('token'));
  const wsUrl = toNonEmptyString(u.searchParams.get('wsUrl'));
  const le = toNonEmptyString(u.searchParams.get('le')) ?? undefined;
  if (!token) throw new Error('deeplink token is required');
  if (!wsUrl) throw new Error('deeplink wsUrl is required');

  return { token, wsUrl, legalEntityId: le };
}

export function apiBaseFromWsUrl(wsUrlRaw: string): string {
  const raw = String(wsUrlRaw ?? '').trim();
  if (!raw) throw new Error('wsUrl is required');
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('invalid wsUrl');
  }
  const proto = u.protocol;
  if (proto !== 'ws:' && proto !== 'wss:') {
    throw new Error('wsUrl must use ws/wss');
  }
  const httpProto = proto === 'wss:' ? 'https:' : 'http:';
  return `${httpProto}//${u.host}`;
}

export type DeeplinkPairExchangeResponse = {
  agentId: string;
  agentSecret: string;
  wsUrl: string;
  legalEntityId: string;
};

export type DeeplinkPairAlreadyConnected = {
  status: 'already_connected';
};

export async function exchangeDeeplinkToken(args: {
  apiBaseUrl: string;
  token: string;
  legalEntityId?: string;
  version: string;
  fetchImpl?: typeof fetch;
}): Promise<DeeplinkPairExchangeResponse | DeeplinkPairAlreadyConnected> {
  const apiBaseUrl = String(args.apiBaseUrl ?? '').trim().replace(/\/+$/, '');
  const token = String(args.token ?? '').trim();
  const legalEntityIdHint = toNonEmptyString(args.legalEntityId) ?? undefined;
  if (!apiBaseUrl) throw new Error('apiBaseUrl is required');
  if (!token) throw new Error('token is required');

  const fetchFn = args.fetchImpl ?? (globalThis as any).fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('fetch is not available (Node 18+ required)');
  }

  const url = `${apiBaseUrl}/edo-signer/pair-by-deeplink`;
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token,
      deviceInfo: {
        hostname: hostname(),
        version: args.version,
      },
      ...(legalEntityIdHint ? { legalEntityId: legalEntityIdHint } : {}),
    }),
  } as any);

  if (!res || typeof (res as any).ok !== 'boolean') {
    throw new Error('pair-by-deeplink failed (no response)');
  }

  if (!(res as any).ok) {
    const status = (res as any).status;
    throw new Error(`pair-by-deeplink failed (status=${status})`);
  }

  const data = (await (res as any).json?.()) as any;
  if (data && typeof data === 'object' && data.status === 'already_connected') {
    return { status: 'already_connected' };
  }
  const agentId = toNonEmptyString(data?.agentId);
  const agentSecret = toNonEmptyString(data?.agentSecret);
  const wsUrl = toNonEmptyString(data?.wsUrl);
  const legalEntityId = toNonEmptyString(data?.legalEntityId);
  if (!agentId || !agentSecret || !wsUrl || !legalEntityId) {
    throw new Error('pair-by-deeplink returned invalid payload');
  }

  return { agentId, agentSecret, wsUrl, legalEntityId };
}

