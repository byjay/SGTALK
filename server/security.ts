import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';

// Runtime-only fallback signing key (never hardcoded; never committed)
const RUNTIME_SIGNING_SECRET =
  process.env.SESSION_SECRET?.trim() || crypto.randomBytes(32).toString('hex');

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const VERIFY_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const WS_TICKET_TTL_MS = 30 * 1000; // 30 seconds

export interface SessionPayload {
  sub: string;
  email: string;
  role: string;
  kakaoVerified: boolean;
  emailVerified: boolean;
  iat: number;
  exp: number;
  scope: 'session';
}

export interface FileScopePayload {
  sub: string;
  iat: number;
  exp: number;
  scope: 'file';
}

export interface FileSharePayload {
  fileId: string;
  roomId: string;
  iat: number;
  exp: number;
  scope: 'file_share';
}

export interface ShareUnlockPayload {
  fileId: string;
  iat: number;
  exp: number;
  scope: 'file_unlock';
}

export interface KakaoVerificationPayload {
  kakaoId: string;
  nickname: string;
  sandbox: boolean;
  grantId?: string;
  iat: number;
  exp: number;
  scope: 'kakao_verify';
}

export interface EmailVerificationPayload {
  email: string;
  iat: number;
  exp: number;
  scope: 'email_verify';
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  return Buffer.from(padded, 'base64');
}

function signObject(payload: object): string {
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', RUNTIME_SIGNING_SECRET).update(encoded).digest();
  return `${encoded}.${base64UrlEncode(sig)}`;
}

function verifySignedObject<T extends { exp: number; scope: string }>(
  token: string,
  expectedScope: T['scope'],
): T | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sigPart] = parts;
  if (!encoded || !sigPart) return null;

  const expectedSig = crypto.createHmac('sha256', RUNTIME_SIGNING_SECRET).update(encoded).digest();
  const actualSig = base64UrlDecode(sigPart);
  if (actualSig.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(actualSig, expectedSig)) return null;

  try {
    const parsed = JSON.parse(base64UrlDecode(encoded).toString('utf8')) as T;
    if (!parsed || parsed.scope !== expectedScope || typeof parsed.exp !== 'number') {
      return null;
    }
    if (Date.now() > parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function signSessionToken(input: {
  userId: string;
  email: string;
  role: string;
  kakaoVerified: boolean;
  emailVerified: boolean;
}): string {
  const now = Date.now();
  const payload: SessionPayload = {
    sub: input.userId,
    email: input.email,
    role: input.role,
    kakaoVerified: input.kakaoVerified,
    emailVerified: input.emailVerified,
    iat: now,
    exp: now + TOKEN_TTL_MS,
    scope: 'session',
  };
  return signObject(payload);
}

export function verifySessionToken(token: string): SessionPayload | null {
  return verifySignedObject<SessionPayload>(token, 'session');
}

export function signFileScopeToken(userId: string): string {
  const now = Date.now();
  const payload: FileScopePayload = {
    sub: userId,
    iat: now,
    exp: now + TOKEN_TTL_MS,
    scope: 'file',
  };
  return signObject(payload);
}

export function verifyFileScopeToken(token: string): FileScopePayload | null {
  return verifySignedObject<FileScopePayload>(token, 'file');
}

const FILE_SHARE_DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function signFileShareToken(
  fileId: string,
  roomId: string,
  ttlMs = FILE_SHARE_DEFAULT_TTL_MS,
): { token: string; expiresAt: string } {
  const now = Date.now();
  const exp = now + Math.max(60_000, ttlMs);
  const payload: FileSharePayload = {
    fileId,
    roomId,
    iat: now,
    exp,
    scope: 'file_share',
  };
  return {
    token: signObject(payload),
    expiresAt: new Date(exp).toISOString(),
  };
}

export function verifyFileShareToken(token: string): FileSharePayload | null {
  return verifySignedObject<FileSharePayload>(token, 'file_share');
}

export function hashSharePasscode(passcode: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(passcode.trim(), salt, 32).toString('hex');
  return `${salt}:${derived}`;
}

export function verifySharePasscode(passcode: string, storedHash: string): boolean {
  const trimmed = passcode.trim();
  if (!trimmed || !storedHash) return false;
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  try {
    const derivedBuf = crypto.scryptSync(trimmed, salt, 32);
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    if (derivedBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(derivedBuf, expectedBuf);
  } catch {
    return false;
  }
}

export function signShareUnlockToken(fileId: string, ttlMs = 5 * 60 * 1000): string {
  const now = Date.now();
  const payload: ShareUnlockPayload = {
    fileId,
    iat: now,
    exp: now + Math.max(30_000, ttlMs),
    scope: 'file_unlock',
  };
  return signObject(payload);
}

export function verifyShareUnlockToken(token: string, fileId: string): boolean {
  const parsed = verifySignedObject<ShareUnlockPayload>(token, 'file_unlock');
  if (!parsed) return false;
  return parsed.fileId === fileId;
}

export function issueKakaoVerificationToken(profile: {
  kakaoId: string;
  nickname: string;
  sandbox: boolean;
  grantId?: string;
}): string {
  const now = Date.now();
  const payload: KakaoVerificationPayload = {
    kakaoId: profile.kakaoId,
    nickname: profile.nickname,
    sandbox: profile.sandbox,
    ...(profile.grantId ? { grantId: profile.grantId } : {}),
    iat: now,
    exp: now + VERIFY_TTL_MS,
    scope: 'kakao_verify',
  };
  return signObject(payload);
}

export function verifyKakaoVerificationToken(token: string): KakaoVerificationPayload | null {
  return verifySignedObject<KakaoVerificationPayload>(token, 'kakao_verify');
}

export function issueEmailVerificationToken(email: string): string {
  const now = Date.now();
  const payload: EmailVerificationPayload = {
    email: email.trim().toLowerCase(),
    iat: now,
    exp: now + VERIFY_TTL_MS,
    scope: 'email_verify',
  };
  return signObject(payload);
}

export function verifyEmailVerificationToken(
  token: string,
  expectedEmail: string,
): EmailVerificationPayload | null {
  const parsed = verifySignedObject<EmailVerificationPayload>(token, 'email_verify');
  if (!parsed) return null;
  if (parsed.email !== expectedEmail.trim().toLowerCase()) return null;
  return parsed;
}

// --- Single-use WebSocket handshake tickets ---
const wsTickets = new Map<string, { userId: string; exp: number }>();

export function issueWsTicket(userId: string): string {
  const now = Date.now();
  for (const [k, v] of wsTickets.entries()) {
    if (v.exp < now) wsTickets.delete(k);
  }
  const ticket = crypto.randomBytes(24).toString('hex');
  wsTickets.set(ticket, { userId, exp: now + WS_TICKET_TTL_MS });
  return ticket;
}

export function consumeWsTicket(ticket: string): string | null {
  const entry = wsTickets.get(ticket);
  if (!entry) return null;
  wsTickets.delete(ticket);
  if (Date.now() > entry.exp) return null;
  return entry.userId;
}

// --- Kakao OAuth CSRF State & Server-Only Token Vault ---
interface KakaoStateEntry {
  exp: number;
  mode: 'verify' | 'link';
  userId?: string;
}

const kakaoStates = new Map<string, KakaoStateEntry>();

export function createKakaoState(options?: { mode?: 'verify' | 'link'; userId?: string }): string {
  const now = Date.now();
  for (const [k, entry] of kakaoStates.entries()) {
    if (entry.exp < now) kakaoStates.delete(k);
  }
  const state = crypto.randomBytes(20).toString('hex');
  kakaoStates.set(state, {
    exp: now + VERIFY_TTL_MS,
    mode: options?.mode ?? 'verify',
    userId: options?.userId,
  });
  return state;
}

export function consumeKakaoState(state: string): { mode: 'verify' | 'link'; userId?: string } | null {
  const entry = kakaoStates.get(state);
  if (!entry) return null;
  kakaoStates.delete(state);
  if (Date.now() > entry.exp) return null;
  return { mode: entry.mode, userId: entry.userId };
}

export interface KakaoGrantRecord {
  accessToken: string;
  scopes: string[];
  kakaoId: string;
  nickname: string;
  exp: number;
}

const pendingKakaoGrants = new Map<string, KakaoGrantRecord>();
const userKakaoGrants = new Map<string, KakaoGrantRecord>();

export function storePendingKakaoGrant(input: {
  accessToken: string;
  scopes: string[];
  kakaoId: string;
  nickname: string;
  expiresInSec?: number;
}): string {
  const now = Date.now();
  for (const [k, v] of pendingKakaoGrants.entries()) {
    if (v.exp < now) pendingKakaoGrants.delete(k);
  }
  const grantId = crypto.randomBytes(18).toString('hex');
  const ttl = Math.max(60, Math.min(input.expiresInSec ?? 21600, 86400)) * 1000;
  pendingKakaoGrants.set(grantId, {
    accessToken: input.accessToken,
    scopes: input.scopes,
    kakaoId: input.kakaoId,
    nickname: input.nickname,
    exp: now + ttl,
  });
  return grantId;
}

export function bindPendingKakaoGrantToUser(grantId: string | undefined, userId: string): boolean {
  if (!grantId) return false;
  const grant = pendingKakaoGrants.get(grantId);
  if (!grant) return false;
  pendingKakaoGrants.delete(grantId);
  if (Date.now() > grant.exp) return false;
  userKakaoGrants.set(userId, grant);
  return true;
}

export function setUserKakaoGrant(userId: string, grant: Omit<KakaoGrantRecord, 'exp'> & { expiresInSec?: number }): void {
  const ttl = Math.max(60, Math.min(grant.expiresInSec ?? 21600, 86400)) * 1000;
  userKakaoGrants.set(userId, {
    accessToken: grant.accessToken,
    scopes: grant.scopes,
    kakaoId: grant.kakaoId,
    nickname: grant.nickname,
    exp: Date.now() + ttl,
  });
}

export function getUserKakaoGrant(userId: string): KakaoGrantRecord | null {
  const grant = userKakaoGrants.get(userId);
  if (!grant) return null;
  if (Date.now() > grant.exp) {
    userKakaoGrants.delete(userId);
    return null;
  }
  return grant;
}

export function clearUserKakaoGrant(userId: string): void {
  userKakaoGrants.delete(userId);
}

// --- Per-Email Login Brute-Force Lockout ---
const LOGIN_LOCK_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_LOCK_DURATION_MS = 60 * 1000;
const MAX_FAILED_LOGINS = 5;

interface LoginFailureRecord {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
}

const loginFailures = new Map<string, LoginFailureRecord>();

export function checkLoginAttemptAllowed(rawEmail: string): { allowed: true } | { allowed: false; retryAfterSec: number } {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return { allowed: true };
  const rec = loginFailures.get(email);
  if (!rec) return { allowed: true };
  const now = Date.now();
  if (rec.lockedUntil > now) {
    return { allowed: false, retryAfterSec: Math.ceil((rec.lockedUntil - now) / 1000) };
  }
  if (now - rec.firstFailureAt > LOGIN_LOCK_WINDOW_MS) {
    loginFailures.delete(email);
  }
  return { allowed: true };
}

export function recordLoginFailure(rawEmail: string): void {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return;
  const now = Date.now();
  const existing = loginFailures.get(email);
  if (!existing || now - existing.firstFailureAt > LOGIN_LOCK_WINDOW_MS) {
    loginFailures.set(email, { failures: 1, firstFailureAt: now, lockedUntil: 0 });
    return;
  }
  existing.failures += 1;
  if (existing.failures >= MAX_FAILED_LOGINS) {
    existing.lockedUntil = now + LOGIN_LOCK_DURATION_MS;
  }
}

export function clearLoginFailures(rawEmail: string): void {
  const email = rawEmail.trim().toLowerCase();
  if (email) loginFailures.delete(email);
}

// --- Company Email Security Code (6-digit OTP) Store ---
interface OtpRecord {
  codeHash: string;
  expiresAt: number;
  attemptsLeft: number;
  lastSentAt: number;
}

const emailOtpStore = new Map<string, OtpRecord>();

export function isTestBypassLoginEnabled(): boolean {
  if (process.env.SGW_REQUIRE_LOGIN?.trim().toLowerCase() === 'true') return false;
  if (process.env.SGW_TEST_BYPASS_LOGIN?.trim().toLowerCase() === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

export function getAllowedCompanyEmailDomain(): string {
  return (process.env.COMPANY_EMAIL_DOMAIN || 'sgw.co.kr').trim().toLowerCase();
}

export function isAllowedCompanyEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const domain = getAllowedCompanyEmailDomain();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) && normalized.endsWith(`@${domain}`);
}

function hashOtpCode(email: string, code: string): string {
  return crypto
    .createHmac('sha256', RUNTIME_SIGNING_SECRET)
    .update(`${email.trim().toLowerCase()}:${code}`)
    .digest('hex');
}

export async function generateAndSendEmailSecurityCode(rawEmail: string): Promise<{
  ok: boolean;
  error?: string;
  expiresInSec?: number;
  previewCode?: string;
  deliveryMode?: 'smtp-webhook' | 'preview';
}> {
  const email = rawEmail.trim().toLowerCase();
  if (!isAllowedCompanyEmail(email)) {
    return {
      ok: false,
      error: `회사 이메일(@${getAllowedCompanyEmailDomain()}) 형식만 인증 코드를 받을 수 있습니다.`,
    };
  }

  const now = Date.now();
  const existing = emailOtpStore.get(email);
  if (existing && now - existing.lastSentAt < 5_000) {
    return {
      ok: false,
      error: '잠시 후 다시 보안코드를 요청해주세요. (최소 5초 간격)',
    };
  }

  const code = String(crypto.randomInt(100000, 1000000));
  emailOtpStore.set(email, {
    codeHash: hashOtpCode(email, code),
    expiresAt: now + OTP_TTL_MS,
    attemptsLeft: 5,
    lastSentAt: now,
  });

  const smtpWebhook = process.env.SMTP_WEBHOOK_URL?.trim();
  if (smtpWebhook) {
    const valid = validateExternalHttpUrl(smtpWebhook);
    if (!valid.ok) {
      return { ok: false, error: '이메일 발송 서버 URL 검증에 실패했습니다.' };
    }
    try {
      const resp = await fetch(valid.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: email,
          subject: '[SG Talk] 회사 계정 보안 인증 코드',
          code,
          expiresInSec: Math.round(OTP_TTL_MS / 1000),
        }),
      });
      if (!resp.ok) {
        return { ok: false, error: '사내 메일 발송 서버에서 코드 전송을 거부했습니다.' };
      }
      return {
        ok: true,
        expiresInSec: Math.round(OTP_TTL_MS / 1000),
        deliveryMode: 'smtp-webhook',
      };
    } catch {
      return { ok: false, error: '사내 메일 발송 서버와 연결할 수 없습니다.' };
    }
  }

  // Non-production preview mode without external SMTP webhook
  return {
    ok: true,
    expiresInSec: Math.round(OTP_TTL_MS / 1000),
    previewCode: process.env.NODE_ENV !== 'production' ? code : undefined,
    deliveryMode: 'preview',
  };
}

export function verifyEmailSecurityCode(
  rawEmail: string,
  rawCode: string,
): { ok: boolean; emailVerificationToken?: string; error?: string } {
  const email = rawEmail.trim().toLowerCase();
  const code = rawCode.trim();
  if (!isAllowedCompanyEmail(email)) {
    return { ok: false, error: '올바른 회사 이메일 주소가 아닙니다.' };
  }
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, error: '6자리 숫자 보안코드를 입력해주세요.' };
  }

  const record = emailOtpStore.get(email);
  if (!record) {
    return { ok: false, error: '먼저 보안코드 발송을 요청해주세요.' };
  }
  if (Date.now() > record.expiresAt) {
    emailOtpStore.delete(email);
    return { ok: false, error: '보안코드 유효시간(5분)이 만료되었습니다. 다시 발송해주세요.' };
  }
  if (record.attemptsLeft <= 0) {
    emailOtpStore.delete(email);
    return { ok: false, error: '입력 시도 횟수를 초과했습니다. 보안코드를 다시 발송해주세요.' };
  }

  const expectedBuf = Buffer.from(record.codeHash, 'hex');
  const actualBuf = Buffer.from(hashOtpCode(email, code), 'hex');
  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    record.attemptsLeft -= 1;
    return {
      ok: false,
      error: `보안코드가 일치하지 않습니다. (남은 시도 ${record.attemptsLeft}회)`,
    };
  }

  emailOtpStore.delete(email);
  return {
    ok: true,
    emailVerificationToken: issueEmailVerificationToken(email),
  };
}

// --- Path Containment & SSRF Guards ---
export function isPathInsideDir(targetPath: string, baseDir: string): boolean {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget.startsWith(resolvedBase + path.sep);
}

function isPrivateOrLoopbackIp(host: string): boolean {
  const cleaned = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (cleaned === 'localhost' || cleaned.endsWith('.local') || cleaned.endsWith('.internal')) {
    return true;
  }
  if (net.isIP(cleaned) === 4) {
    const [a, b] = cleaned.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  if (net.isIP(cleaned) === 6) {
    if (cleaned === '::1' || cleaned.startsWith('fc') || cleaned.startsWith('fd') || cleaned.startsWith('fe80')) {
      return true;
    }
  }
  return false;
}

export function validateExternalHttpUrl(rawUrl: string): { ok: true; url: string } | { ok: false; error: string } {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'HTTP/HTTPS URL만 허용됩니다.' };
    }
    if (isPrivateOrLoopbackIp(parsed.hostname)) {
      return { ok: false, error: '내부망 또는 로컬 주소로의 요청은 차단됩니다.' };
    }
    return { ok: true, url: parsed.toString() };
  } catch {
    return { ok: false, error: '유효하지 않은 URL입니다.' };
  }
}

export function verifyWebhookSecret(provided: string | undefined, expected: string | undefined): boolean {
  if (!expected?.trim() || !provided?.trim()) return false;
  const a = Buffer.from(provided.trim(), 'utf8');
  const b = Buffer.from(expected.trim(), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- Sliding-Window Rate Limiter ---
export function createRateLimiter(options: { windowMs: number; max: number; message: string }) {
  const buckets = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = String(req.ip || req.socket.remoteAddress || 'unknown');
    const now = Date.now();
    const cutoff = now - options.windowMs;
    const timestamps = (buckets.get(ip) ?? []).filter((t) => t > cutoff);
    if (timestamps.length >= options.max) {
      res.status(429).json({ error: options.message });
      return;
    }
    timestamps.push(now);
    buckets.set(ip, timestamps);
    next();
  };
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

const SAFE_INLINE_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

export function isSafeInlineImageMime(mimeType: string | undefined): boolean {
  if (!mimeType) return false;
  return SAFE_INLINE_IMAGE_MIMES.has(mimeType.split(';')[0].trim().toLowerCase());
}

