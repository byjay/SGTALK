import crypto from 'node:crypto';
import type { User } from '../src/shared/types';
import { buildBmailEmbedLaunchUrl, type BmailRemoteMailItem } from '../src/shared/bmailSync';

export interface BmailBridgeConfigStatus {
  bmailBaseUrlConfigured: boolean;
  bmailBaseUrlOrigin: string | null;
  ssoSecretConfigured: boolean;
  embedSupported: boolean;
}

export interface SgwSsoPayloadForBmail {
  sub: string;
  name: string;
  department: string;
  email: string;
  role: string;
  exp: number;
  nonce: string;
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64').toString('utf8');
}

function timingSafeHexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Matches byjay/bmail's verifySgwSsoToken() in src/utils/sgwAuth.ts:
 * `<base64url(payloadJson)>.<hexHmacSha256>`
 */
export function signSgwSsoTokenForBmail(
  user: Pick<User, 'id' | 'name' | 'department' | 'email' | 'role'>,
  secret: string,
  options?: { ttlSec?: number; nowSec?: number; nonce?: string },
): string {
  const cleanSecret = secret.trim();
  if (!cleanSecret) {
    throw new Error('SGW_SSO_SECRET 환경변수가 설정되지 않았습니다.');
  }
  const nowSec = options?.nowSec ?? Math.floor(Date.now() / 1000);
  const ttlSec = Math.max(30, Math.min(3600, options?.ttlSec ?? 300));
  const payload: SgwSsoPayloadForBmail = {
    sub: user.id,
    name: user.name,
    department: user.department || '',
    email: user.email || '',
    role: user.role === 'admin' ? 'admin' : 'user',
    exp: nowSec + ttlSec,
    nonce: options?.nonce || crypto.randomUUID(),
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const sigHex = crypto.createHmac('sha256', cleanSecret).update(encodedPayload).digest('hex');
  return `${encodedPayload}.${sigHex}`;
}

export function verifySgwSsoTokenFromBmail(
  token: string,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): { ok: boolean; payload?: SgwSsoPayloadForBmail; error?: string } {
  const cleanSecret = secret.trim();
  if (!cleanSecret) return { ok: false, error: 'SGW_SSO_SECRET 미설정' };

  const trimmed = String(token || '').trim();
  const dotIdx = trimmed.lastIndexOf('.');
  if (dotIdx <= 0 || dotIdx === trimmed.length - 1) {
    return { ok: false, error: '유효하지 않은 SSO 토큰 형식' };
  }
  const encodedPayload = trimmed.slice(0, dotIdx);
  const providedSig = trimmed.slice(dotIdx + 1);
  const expectedSig = crypto.createHmac('sha256', cleanSecret).update(encodedPayload).digest('hex');
  if (!timingSafeHexEqual(providedSig, expectedSig)) {
    return { ok: false, error: 'SSO 토큰 서명 불일치' };
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(encodedPayload)) as Partial<SgwSsoPayloadForBmail>;
    if (typeof parsed.exp !== 'number' || parsed.exp <= nowSec || !parsed.sub || !parsed.nonce) {
      return { ok: false, error: 'SSO 토큰 만료 또는 필수 클레임 누락' };
    }
    return { ok: true, payload: parsed as SgwSsoPayloadForBmail };
  } catch {
    return { ok: false, error: 'SSO 토큰 디코딩 실패' };
  }
}

export function getNormalizedBmailBaseUrl(): string | null {
  const raw = process.env.BMAIL_BASE_URL?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function getBmailBridgeConfigStatus(): BmailBridgeConfigStatus {
  const origin = getNormalizedBmailBaseUrl();
  return {
    bmailBaseUrlConfigured: Boolean(origin),
    bmailBaseUrlOrigin: origin,
    ssoSecretConfigured: Boolean(process.env.SGW_SSO_SECRET?.trim()),
    embedSupported: Boolean(origin && process.env.SGW_SSO_SECRET?.trim()),
  };
}

export function createBmailLaunchUrlForUser(
  user: Pick<User, 'id' | 'name' | 'department' | 'email' | 'role'>,
): { ok: boolean; launchUrl?: string; error?: string } {
  const origin = getNormalizedBmailBaseUrl();
  const secret = process.env.SGW_SSO_SECRET?.trim() || '';
  if (!origin) {
    return { ok: false, error: 'BMAIL_BASE_URL 환경변수가 설정되지 않았습니다.' };
  }
  if (!secret) {
    return { ok: false, error: 'SGW_SSO_SECRET 환경변수가 설정되지 않았습니다.' };
  }
  const token = signSgwSsoTokenForBmail(user, secret);
  return {
    ok: true,
    launchUrl: buildBmailEmbedLaunchUrl(origin, token),
  };
}

async function exchangeSgwCookieWithBmail(
  bmailOrigin: string,
  user: Pick<User, 'id' | 'name' | 'department' | 'email' | 'role'>,
  secret: string,
): Promise<string | null> {
  const token = signSgwSsoTokenForBmail(user, secret);
  const res = await fetch(`${bmailOrigin}/api/sgw/auth/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ token }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return null;
  const match = setCookie.match(/sgw_session_id=([^;]+)/);
  return match ? `sgw_session_id=${match[1]}` : null;
}

export async function fetchBmailRemoteInbox(
  user: Pick<User, 'id' | 'name' | 'department' | 'email' | 'role'>,
): Promise<{ ok: boolean; items: BmailRemoteMailItem[]; error?: string }> {
  const origin = getNormalizedBmailBaseUrl();
  const secret = process.env.SGW_SSO_SECRET?.trim() || '';
  if (!origin || !secret) {
    return { ok: false, items: [], error: '원격 bmail 서버(BMAIL_BASE_URL / SGW_SSO_SECRET)가 미설정 상태입니다.' };
  }
  try {
    const cookie = await exchangeSgwCookieWithBmail(origin, user, secret);
    if (!cookie) {
      return { ok: false, items: [], error: 'bmail SSO 세션 교환에 실패했습니다.' };
    }
    const res = await fetch(`${origin}/api/sgw/mail?box=inbox`, {
      method: 'GET',
      headers: { Accept: 'application/json', Cookie: cookie },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      return { ok: false, items: [], error: `bmail 메일 조회 실패 (HTTP ${res.status})` };
    }
    const data = (await res.json()) as { items?: BmailRemoteMailItem[] };
    return {
      ok: true,
      items: Array.isArray(data.items) ? data.items : [],
    };
  } catch (err) {
    return {
      ok: false,
      items: [],
      error: err instanceof Error ? err.message : 'bmail 서버 통신 오류',
    };
  }
}

export async function pushMailToBmailGateway(
  user: Pick<User, 'id' | 'name' | 'department' | 'email' | 'role'>,
  payload: {
    recipients: Array<{ sub: string; name?: string }>;
    subject: string;
    body: string;
    threadId?: string | null;
  },
): Promise<{ ok: boolean; remoteMailId?: string; error?: string }> {
  const origin = getNormalizedBmailBaseUrl();
  const secret = process.env.SGW_SSO_SECRET?.trim() || '';
  if (!origin || !secret) {
    return { ok: false, error: '원격 bmail 미설정' };
  }
  try {
    const cookie = await exchangeSgwCookieWithBmail(origin, user, secret);
    if (!cookie) {
      return { ok: false, error: 'bmail SSO 인증 실패' };
    }
    const res = await fetch(`${origin}/api/sgw/mail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Cookie: cookie },
      body: JSON.stringify({
        to: payload.recipients,
        subject: payload.subject,
        body: payload.body,
        ...(payload.threadId ? { threadId: payload.threadId } : {}),
        isDraft: false,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      return { ok: false, error: `bmail 발송 동기화 실패 (HTTP ${res.status})` };
    }
    const data = (await res.json()) as { item?: { id?: string } };
    return { ok: true, remoteMailId: data.item?.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'bmail 발송 동기화 오류',
    };
  }
}
