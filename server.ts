import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import { formatFileSize } from './src/shared/logic';
import {
  SEDMS_MENU_CATALOG,
  maskViewOnceMessageForUser,
  summarizeRoomMessagesPure,
} from './src/shared/chatLogic';
import {
  buildSgwChatMessageDto,
  buildSgwChatRoomDto,
  buildSgwDirectMessageDto,
  buildSgwEmployeeDto,
} from './src/shared/bmailSync';
import {
  createBmailLaunchUrlForUser,
  fetchBmailRemoteInbox,
  getBmailBridgeConfigStatus,
  pushMailToBmailGateway,
} from './server/bmailBridge';
import {
  buildConciseMailDigest,
  filterNoticesByScope,
  parseControlTowerCommand,
} from './src/shared/controlTower';
import {
  parseDrawCandidates,
  parseHttpRangeHeader,
  sanitizeNasFilename,
  sanitizeNasFolder,
  validateNasShareRequest,
  validateScheduleCardInput,
} from './src/shared/nasShare';
import { normalizeNoticePriority } from './src/shared/noticeAlert';
import { validateLargeFileLinkInput } from './src/shared/voiceAnalysis';
import type {
  IntegrationActionSummary,
  LeaveType,
  MailAttachmentItem,
  MailCategory,
  MailProvider,
  NoticePriority,
  PollData,
  PresenceStatus,
  ScheduleCardData,
  SedmsMenuKey,
  ShareProvider,
  User,
  VoiceAttachment,
} from './src/shared/types';
import {
  copyBufferToNasFolder,
  copyExistingFileToNasFolder,
  ensureNasPackageFile,
  ensureNasSeedStructure,
  getConfiguredNasExternalBaseUrl,
  getNasRootDir,
  listNasFolders,
  resolveNasFilePath,
} from './server/nas';
import {
  bindPendingKakaoGrantToUser,
  checkLoginAttemptAllowed,
  clearLoginFailures,
  clearUserKakaoGrant,
  consumeKakaoState,
  consumeWsTicket,
  createKakaoState,
  createRateLimiter,
  extractBearerToken,
  generateAndSendEmailSecurityCode,
  getAllowedCompanyEmailDomain,
  hashSharePasscode,
  isAllowedCompanyEmail,
  isPathInsideDir,
  isSafeInlineImageMime,
  isTestBypassLoginEnabled,
  issueKakaoVerificationToken,
  issueWsTicket,
  recordLoginFailure,
  setUserKakaoGrant,
  signFileScopeToken,
  signFileShareToken,
  signSessionToken,
  signShareUnlockToken,
  storePendingKakaoGrant,
  validateExternalHttpUrl,
  verifyEmailSecurityCode,
  verifyEmailVerificationToken,
  verifyFileScopeToken,
  verifyFileShareToken,
  verifyKakaoVerificationToken,
  verifySessionToken,
  verifySharePasscode,
  verifyShareUnlockToken,
  verifyWebhookSecret,
} from './server/security';
import {
  getKakaoFreeApiStatusForUser,
  searchKakaoDaum,
  searchKakaoLocalPlaces,
} from './server/kakaoFreeApis';
import { runAutonomousEgoAgent } from './server/egoAgent';
import {
  analyzeChatMessageQuick,
  analyzeVoicePayload,
  summarizeMailContent,
} from './server/voiceAnalyzer';
import { getUploadDir, store } from './server/store';
import { createZipArchive, type ZipEntry } from './server/zipBuilder';

const PORT = 3000;
const app = express();
app.use(express.json({ limit: '10mb' }));

// Iframe-compatible security headers (unblocks SGW_V0 corporate HTTPS portals & preview embedding)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=*');
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'self' https: http://localhost:* http://127.0.0.1:*",
  );
  next();
});

const authLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 40,
  message: '보안 인증 요청이 너무 많습니다. 1분 후 다시 시도해주세요.',
});

const webhookLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 60,
  message: '연동 웹훅 요청 한도를 초과했습니다.',
});

const egoLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 30,
  message: 'EGO 에이전트 요청이 너무 많습니다. 1분 후 다시 시도해주세요.',
});

interface AuthenticatedRequest extends Request {
  authUserId?: string;
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: '인증 토큰이 필요합니다. 다시 로그인해주세요.' });
    return;
  }
  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ error: '세션이 만료되었거나 유효하지 않습니다. 다시 로그인해주세요.' });
    return;
  }
  req.authUserId = payload.sub;
  next();
}

function requireWebhookOrUserAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const secretHeader =
    typeof req.headers['x-sgw-webhook-secret'] === 'string'
      ? req.headers['x-sgw-webhook-secret']
      : undefined;
  if (verifyWebhookSecret(secretHeader, process.env.SGW_WEBHOOK_SECRET)) {
    next();
    return;
  }
  const token = extractBearerToken(req);
  const payload = token ? verifySessionToken(token) : null;
  if (payload) {
    req.authUserId = payload.sub;
    next();
    return;
  }
  res.status(401).json({ error: '유효한 웹훅 시크릿 또는 사용자 인증 토큰이 필요합니다.' });
}

function resolveRequestOrigin(req: Request): string {
  const envUrl = process.env.APP_URL?.trim();
  if (envUrl) return envUrl.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
    .split(',')[0]
    .trim();
  const host = String(req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000')
    .split(',')[0]
    .trim();
  return `${proto}://${host}`;
}

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, getUploadDir());
  },
  filename: (_req, file, cb) => {
    const fileId = `file-${crypto.randomUUID().slice(0, 8)}`;
    const originalDecoded = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const safeBase = originalDecoded.replace(/[^\w.\-가-힣\s()]/g, '_');
    const diskName = `${fileId}-${safeBase}`;
    (file as Express.Multer.File & { customFileId?: string; decodedName?: string }).customFileId =
      fileId;
    (file as Express.Multer.File & { customFileId?: string; decodedName?: string }).decodedName =
      originalDecoded;
    cb(null, diskName);
  },
});

const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 200 * 1024 * 1024 },
});

const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const shareVerifyLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 30,
  message: '공유 링크 비밀번호 확인 시도가 너무 많습니다. 1분 후 다시 시도해주세요.',
});

const MAX_CHUNKED_TOTAL_BYTES = 500 * 1024 * 1024;
const MAX_CHUNK_COUNT = 200;
const CHUNK_SESSION_TTL_MS = 30 * 60 * 1000;

interface ChunkSession {
  id: string;
  userId: string;
  roomId: string;
  filename: string;
  mimeType: string;
  totalSize: number;
  totalChunks: number;
  receivedChunks: Set<number>;
  createdAt: number;
  chunkDir: string;
  nasFolder?: string;
}

const chunkSessions = new Map<string, ChunkSession>();

function getChunksRootDir(): string {
  const root = path.resolve(getUploadDir(), '.chunks');
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

function cleanupExpiredChunkSessions(): void {
  const now = Date.now();
  const root = getChunksRootDir();
  for (const [id, session] of chunkSessions.entries()) {
    if (now - session.createdAt > CHUNK_SESSION_TTL_MS) {
      if (isPathInsideDir(session.chunkDir, root) && fs.existsSync(session.chunkDir)) {
        fs.rmSync(session.chunkDir, { recursive: true, force: true });
      }
      chunkSessions.delete(id);
    }
  }
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const userSockets = new Map<string, Set<WebSocket>>();
const socketUsers = new Map<WebSocket, string>();

function broadcastAll(event: string, payload: unknown): void {
  const frame = JSON.stringify({ event, payload });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(frame);
    }
  }
}

function broadcastToUsers(userIds: string[], event: string, payload: unknown): void {
  const frame = JSON.stringify({ event, payload });
  for (const uid of userIds) {
    const sockets = userSockets.get(uid);
    if (!sockets) continue;
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(frame);
      }
    }
  }
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const ticket = url.searchParams.get('ticket');
  const userId = ticket ? consumeWsTicket(ticket) : null;

  if (!userId) {
    ws.close(1008, 'Unauthorized WebSocket ticket');
    return;
  }

  socketUsers.set(ws, userId);
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId)!.add(ws);
  const updatedUser = store.setUserOnline(userId, true);
  if (updatedUser) {
    broadcastAll('presence:update', {
      userId,
      online: true,
      presenceStatus: updatedUser.presenceStatus,
      lastSeen: updatedUser.lastSeen,
    });
  }

  ws.on('message', (raw) => {
    try {
      const parsed = JSON.parse(String(raw)) as {
        event?: string;
        payload?: Record<string, unknown>;
      };
      if (parsed.event === 'typing' && parsed.payload) {
        const authedUserId = socketUsers.get(ws);
        if (!authedUserId) return;
        const roomId = String(parsed.payload.roomId ?? '');
        const isTyping = Boolean(parsed.payload.isTyping);
        const room = store.getRoomById(roomId);
        if (room && room.memberIds.includes(authedUserId)) {
          broadcastToUsers(
            room.memberIds.filter((id) => id !== authedUserId),
            'typing:update',
            { roomId, userId: authedUserId, isTyping },
          );
        }
      } else if (parsed.event === 'ui:sync' && parsed.payload) {
        const authedUserId = socketUsers.get(ws);
        if (!authedUserId) return;
        const activeRoomId =
          typeof parsed.payload.activeRoomId === 'string' && parsed.payload.activeRoomId.trim()
            ? parsed.payload.activeRoomId.trim()
            : undefined;
        const activeTab =
          typeof parsed.payload.activeTab === 'string' && parsed.payload.activeTab.trim()
            ? parsed.payload.activeTab.trim()
            : undefined;
        const sourceClientId =
          typeof parsed.payload.sourceClientId === 'string' ? parsed.payload.sourceClientId : undefined;
        if (activeRoomId) {
          const room = store.getRoomById(activeRoomId);
          if (!room || !room.memberIds.includes(authedUserId)) return;
        }
        broadcastToUsers([authedUserId], 'ui:sync', {
          ...(activeRoomId ? { activeRoomId } : {}),
          ...(activeTab ? { activeTab } : {}),
          ...(sourceClientId ? { sourceClientId } : {}),
        });
      }
    } catch {
      // Ignore malformed socket frames
    }
  });

  ws.on('close', () => {
    const uid = socketUsers.get(ws);
    socketUsers.delete(ws);
    if (!uid) return;
    const set = userSockets.get(uid);
    if (set) {
      set.delete(ws);
      if (set.size === 0) {
        userSockets.delete(uid);
        const updated = store.setUserOnline(uid, false);
        if (updated) {
          broadcastAll('presence:update', {
            userId: uid,
            online: false,
            presenceStatus: updated.presenceStatus,
            lastSeen: updated.lastSeen,
          });
        }
      }
    }
  });
});

// --- Health, Full Source Download, Docs & Extension Package (Open Direct-Link Access + CORS) ---
const EXCLUDED_SOURCE_DIRS = new Set([
  'node_modules',
  'dist',
  'dev-dist',
  '.git',
  '.playwright-cli',
  'uploads',
  'data',
  '.aistudio',
  '.vscode',
  '.idea',
]);

function isExcludedSourceFile(filename: string): boolean {
  if (filename === '.env.example') return false;
  if (filename === '.env' || filename.startsWith('.env.')) return true;
  if (filename === '.DS_Store' || filename.endsWith('.log') || filename.endsWith('.zip')) {
    return true;
  }
  return false;
}

function collectWorkspaceSourceEntries(rootDir: string): ZipEntry[] {
  const entries: ZipEntry[] = [];

  const walk = (dirPath: string) => {
    const dirents = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const dirent of dirents) {
      if (dirent.isSymbolicLink()) continue;
      const fullPath = path.resolve(dirPath, dirent.name);
      if (!isPathInsideDir(fullPath, rootDir)) continue;

      if (dirent.isDirectory()) {
        if (EXCLUDED_SOURCE_DIRS.has(dirent.name)) continue;
        walk(fullPath);
        continue;
      }

      if (!dirent.isFile() || isExcludedSourceFile(dirent.name)) continue;
      const relPath = path.relative(rootDir, fullPath).split(path.sep).join('/');
      entries.push({
        name: `sgw-messenger-source/${relPath}`,
        data: fs.readFileSync(fullPath),
      });
    }
  };

  walk(rootDir);
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

function applyPublicDownloadHeaders(res: Response): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
}

app.options(
  [
    '/api/health',
    '/api/auth/config',
    '/api/install/extension.zip',
    '/api/download/source.zip',
    '/api/download/manual.md',
    '/api/download/handoff.md',
  ],
  (_req, res) => {
    applyPublicDownloadHeaders(res);
    res.status(204).end();
  },
);

app.get('/api/health', (_req, res) => {
  applyPublicDownloadHeaders(res);
  res.json({ ok: true, service: 'SG-Talk', time: new Date().toISOString() });
});

app.get('/api/download/source.zip', (_req, res) => {
  const rootDir = path.resolve(process.cwd());
  const entries = collectWorkspaceSourceEntries(rootDir);
  if (entries.length === 0) {
    res.status(404).json({ error: '다운로드 가능한 소스 파일을 찾을 수 없습니다.' });
    return;
  }
  const zipBuf = createZipArchive(entries);
  applyPublicDownloadHeaders(res);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="sgw-messenger-source.zip"');
  res.send(zipBuf);
});

app.get('/api/download/manual.md', (req, res) => {
  const manualPath = path.resolve(process.cwd(), 'MANUAL.md');
  if (!fs.existsSync(manualPath)) {
    res.status(404).json({ error: '매뉴얼 파일을 찾을 수 없습니다.' });
    return;
  }
  const inline = req.query.inline === '1';
  applyPublicDownloadHeaders(res);
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="SGW_MANUAL.md"`,
  );
  res.send(fs.readFileSync(manualPath, 'utf8'));
});

app.get('/api/download/handoff.md', (req, res) => {
  const handoffPath = path.resolve(process.cwd(), 'HANDOFF.md');
  if (!fs.existsSync(handoffPath)) {
    res.status(404).json({ error: '핸드오프 문서를 찾을 수 없습니다.' });
    return;
  }
  const inline = req.query.inline === '1';
  applyPublicDownloadHeaders(res);
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="SGW_HANDOFF.md"`,
  );
  res.send(fs.readFileSync(handoffPath, 'utf8'));
});

app.get('/api/install/extension.zip', (req, res) => {
  const extDir = path.resolve(process.cwd(), 'extension');
  if (!fs.existsSync(extDir)) {
    res.status(404).json({ error: '확장앱 패키지를 찾을 수 없습니다.' });
    return;
  }
  const origin = resolveRequestOrigin(req);
  const files = fs.readdirSync(extDir);
  const entries: ZipEntry[] = [];
  for (const name of files) {
    const full = path.resolve(extDir, name);
    if (!isPathInsideDir(full, extDir)) continue;
    if (!fs.statSync(full).isFile()) continue;
    if (name === 'config.json') {
      entries.push({
        name: `sgw-messenger-extension/${name}`,
        data: Buffer.from(JSON.stringify({ sgwServerOrigin: origin }, null, 2), 'utf8'),
      });
    } else {
      entries.push({
        name: `sgw-messenger-extension/${name}`,
        data: fs.readFileSync(full),
      });
    }
  }

  const zipBuf = createZipArchive(entries);
  applyPublicDownloadHeaders(res);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="sgw-messenger-extension.zip"');
  res.send(zipBuf);
});

// Non-PII Proprietary Portal Configuration (zero internal employee data exposed externally)
app.get('/api/auth/config', (_req, res) => {
  applyPublicDownloadHeaders(res);
  res.json({
    companyAssetName: 'SG Talk · 사내 전용 메신저',
    companyDomain: getAllowedCompanyEmailDomain(),
    emailVerificationRequired: true,
    kakaoOAuthConfigured: Boolean(process.env.KAKAO_CLIENT_ID?.trim()),
    kakaoFreeApisConfigured: Boolean(process.env.KAKAO_REST_API_KEY?.trim()),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    testBypassLogin: isTestBypassLoginEnabled(),
  });
});

// --- Kakao Identity Verification (OAuth 2.0 + Non-Prod Preview Sandbox when key unset) ---
app.get('/api/auth/kakao/url', authLimiter, (req, res) => {
  const clientId = process.env.KAKAO_CLIENT_ID?.trim();
  const origin = resolveRequestOrigin(req);
  const callbackUrl = `${origin}/api/auth/kakao/callback`;
  const state = createKakaoState({ mode: 'verify' });

  if (!clientId) {
    res.json({
      configured: false,
      state,
      callbackUrl,
      devCallbackUrl:
        'https://ais-dev-dd6u7da3qpp5txkixdkxir-261255021621.asia-east1.run.app/api/auth/kakao/callback',
      sharedCallbackUrl:
        'https://ais-pre-dd6u7da3qpp5txkixdkxir-261255021621.asia-east1.run.app/api/auth/kakao/callback',
    });
    return;
  }

  const scopes = process.env.KAKAO_OAUTH_SCOPES?.trim() || 'profile_nickname';
  const authUrl = new URL('https://kauth.kakao.com/oauth/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', callbackUrl);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('state', state);

  res.json({
    configured: true,
    state,
    callbackUrl,
    url: authUrl.toString(),
  });
});

// Authenticated Kakao Talk Message + Calendar scope linking for EGO Agent
app.get('/api/auth/kakao/link-url', requireAuth, authLimiter, (req: AuthenticatedRequest, res) => {
  const clientId = process.env.KAKAO_CLIENT_ID?.trim();
  const origin = resolveRequestOrigin(req);
  const callbackUrl = `${origin}/api/auth/kakao/callback`;
  if (!clientId) {
    res.json({
      configured: false,
      callbackUrl,
      error: 'KAKAO_CLIENT_ID가 설정되면 카카오톡 나에게 보내기·톡캘린더 연동이 활성화됩니다.',
    });
    return;
  }

  const state = createKakaoState({ mode: 'link', userId: req.authUserId });
  const authUrl = new URL('https://kauth.kakao.com/oauth/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', callbackUrl);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'profile_nickname,talk_message,talk_calendar');
  authUrl.searchParams.set('state', state);

  res.json({
    configured: true,
    state,
    callbackUrl,
    url: authUrl.toString(),
  });
});

app.get(['/api/auth/kakao/callback', '/api/auth/kakao/callback/'], async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const oauthError = typeof req.query.error === 'string' ? req.query.error : '';
  const origin = resolveRequestOrigin(req);

  const renderPopupResult = (payload: Record<string, unknown>) => {
    const safeJson = JSON.stringify(payload).replace(/</g, '\\u003c');
    const safeTargetOrigin = JSON.stringify(origin);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><title>카카오 본인인증 처리</title></head>
<body style="font-family:sans-serif;padding:24px;text-align:center;">
  <p>카카오 본인인증 결과를 안전하게 전달하고 있습니다...</p>
  <script>
    (function () {
      var payload = ${safeJson};
      if (window.opener) {
        window.opener.postMessage(payload, ${safeTargetOrigin});
      }
      window.close();
    })();
  </script>
</body>
</html>`);
  };

  const consumed = state ? consumeKakaoState(state) : null;
  if (oauthError || !code || !consumed) {
    renderPopupResult({
      type: 'KAKAO_AUTH_ERROR',
      error: '카카오 본인인증 요청이 취소되었거나 유효하지 않습니다.',
    });
    return;
  }

  const clientId = process.env.KAKAO_CLIENT_ID?.trim();
  if (!clientId) {
    renderPopupResult({
      type: 'KAKAO_AUTH_ERROR',
      error: '서버에 KAKAO_CLIENT_ID가 설정되어 있지 않습니다.',
    });
    return;
  }

  const callbackUrl = `${origin}/api/auth/kakao/callback`;

  try {
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: callbackUrl,
      code,
    });
    if (process.env.KAKAO_CLIENT_SECRET?.trim()) {
      tokenParams.set('client_secret', process.env.KAKAO_CLIENT_SECRET.trim());
    }

    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: tokenParams.toString(),
      signal: AbortSignal.timeout(8000),
    });
    if (!tokenRes.ok) {
      renderPopupResult({
        type: 'KAKAO_AUTH_ERROR',
        error: '카카오 인증 토큰 교환에 실패했습니다.',
      });
      return;
    }
    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!tokenJson.access_token) {
      renderPopupResult({
        type: 'KAKAO_AUTH_ERROR',
        error: '카카오 액세스 토큰을 수신하지 못했습니다.',
      });
      return;
    }

    const meRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!meRes.ok) {
      renderPopupResult({
        type: 'KAKAO_AUTH_ERROR',
        error: '카카오 사용자 정보를 불러오지 못했습니다.',
      });
      return;
    }
    const meJson = (await meRes.json()) as {
      id?: number | string;
      kakao_account?: { profile?: { nickname?: string } };
      properties?: { nickname?: string };
    };
    const kakaoId = String(meJson.id ?? '');
    const nickname =
      meJson.kakao_account?.profile?.nickname || meJson.properties?.nickname || '카카오 인증 사용자';
    if (!kakaoId) {
      renderPopupResult({
        type: 'KAKAO_AUTH_ERROR',
        error: '카카오 계정 식별자가 확인되지 않았습니다.',
      });
      return;
    }

    const scopes =
      typeof tokenJson.scope === 'string' && tokenJson.scope.trim()
        ? tokenJson.scope.split(/[,\s]+/).filter(Boolean)
        : ['profile_nickname'];

    if (consumed.mode === 'link' && consumed.userId) {
      setUserKakaoGrant(consumed.userId, {
        accessToken: tokenJson.access_token,
        scopes,
        kakaoId,
        nickname,
        expiresInSec: tokenJson.expires_in,
      });
      renderPopupResult({
        type: 'KAKAO_LINK_SUCCESS',
        scopes,
        nickname,
      });
      return;
    }

    const grantId = storePendingKakaoGrant({
      accessToken: tokenJson.access_token,
      scopes,
      kakaoId,
      nickname,
      expiresInSec: tokenJson.expires_in,
    });

    const kakaoVerificationToken = issueKakaoVerificationToken({
      kakaoId,
      nickname,
      sandbox: false,
      grantId,
    });
    renderPopupResult({
      type: 'KAKAO_AUTH_SUCCESS',
      kakaoVerificationToken,
      kakaoProfile: { kakaoId, nickname, sandbox: false },
    });
  } catch {
    renderPopupResult({
      type: 'KAKAO_AUTH_ERROR',
      error: '카카오 인증 서버와 통신 중 오류가 발생했습니다.',
    });
  }
});

app.post('/api/auth/kakao/sandbox', authLimiter, (req, res) => {
  if (process.env.KAKAO_CLIENT_ID?.trim()) {
    res.status(403).json({
      error: '카카오 OAuth가 설정된 환경에서는 실제 카카오 본인인증 팝업을 사용해야 합니다.',
    });
    return;
  }
  const { state, nickname } = req.body ?? {};
  const consumed = typeof state === 'string' ? consumeKakaoState(state) : null;
  if (!consumed) {
    res.status(400).json({ error: '유효하지 않거나 만료된 인증 요청(state)입니다.' });
    return;
  }
  // Zero employee PII lookup before authentication
  const displayNickname =
    (typeof nickname === 'string' && nickname.trim().slice(0, 40)) || 'SGW 임직원 (카카오 본인인증)';
  const kakaoId = `kakao-preview-${crypto.randomBytes(6).toString('hex')}`;

  const kakaoVerificationToken = issueKakaoVerificationToken({
    kakaoId,
    nickname: displayNickname,
    sandbox: true,
  });

  res.json({
    kakaoVerificationToken,
    kakaoProfile: {
      kakaoId,
      nickname: displayNickname,
      sandbox: true,
    },
  });
});

// --- Company Email 6-digit Security Code ---
app.post('/api/auth/email-code/send', authLimiter, async (req, res) => {
  const email = String(req.body?.email ?? '');
  const result = await generateAndSendEmailSecurityCode(email);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({
    ok: true,
    expiresInSec: result.expiresInSec,
    deliveryMode: result.deliveryMode,
    previewCode: result.previewCode,
  });
});

app.post('/api/auth/email-code/verify', authLimiter, (req, res) => {
  const email = String(req.body?.email ?? '');
  const code = String(req.body?.code ?? '');
  const result = verifyEmailSecurityCode(email, code);
  if (!result.ok || !result.emailVerificationToken) {
    res.status(400).json({ error: result.error ?? '보안코드 검증에 실패했습니다.' });
    return;
  }
  res.json({
    ok: true,
    emailVerificationToken: result.emailVerificationToken,
  });
});

// --- Hardened Login & Registration ---
app.post('/api/auth/register', authLimiter, (req, res) => {
  const {
    name,
    email,
    department,
    position,
    phone,
    password,
    kakaoVerificationToken,
    emailVerificationToken,
  } = req.body ?? {};

  const emailStr = String(email ?? '').trim().toLowerCase();
  if (!isAllowedCompanyEmail(emailStr)) {
    res.status(400).json({ error: '회사 도메인 이메일 계정으로만 가입할 수 있습니다.' });
    return;
  }

  const kakaoPayload = verifyKakaoVerificationToken(String(kakaoVerificationToken ?? ''));
  if (!kakaoPayload) {
    res.status(401).json({ error: '① 카카오 본인인증이 완료되지 않았거나 만료되었습니다.' });
    return;
  }

  const emailPayload = verifyEmailVerificationToken(
    String(emailVerificationToken ?? ''),
    emailStr,
  );
  if (!emailPayload) {
    res.status(401).json({ error: '② 회사 이메일 6자리 보안코드 인증이 완료되지 않았습니다.' });
    return;
  }

  if (String(password ?? '').trim().length < 4) {
    res.status(400).json({ error: '비밀번호는 4자 이상이어야 합니다.' });
    return;
  }

  const result = store.registerUser({
    name: String(name ?? ''),
    email: emailStr,
    department: String(department ?? ''),
    position: String(position ?? ''),
    phone: String(phone ?? ''),
    password: String(password ?? ''),
  });

  if (result.error || !result.user) {
    res.status(400).json({ error: result.error ?? '회원가입 실패' });
    return;
  }

  bindPendingKakaoGrantToUser(kakaoPayload.grantId, result.user.id);

  const token = signSessionToken({
    userId: result.user.id,
    email: result.user.email,
    role: result.user.role,
    kakaoVerified: true,
    emailVerified: true,
  });
  const fileToken = signFileScopeToken(result.user.id);

  broadcastAll('user:registered', { user: result.user });
  for (const sysMsg of result.systemMessages) {
    broadcastAll('message:created', { message: sysMsg });
  }
  res.status(201).json({ user: result.user, token, fileToken });
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const { email, password, kakaoVerificationToken, emailVerificationToken } = req.body ?? {};
  const emailStr = String(email ?? '').trim().toLowerCase();

  const attempt = checkLoginAttemptAllowed(emailStr);
  if (!attempt.allowed) {
    res.status(429).json({
      error: `보안 보호를 위해 로그인이 일시 잠금되었습니다. ${attempt.retryAfterSec}초 후 다시 시도해주세요.`,
    });
    return;
  }

  const hasWeb2FaTokens = Boolean(kakaoVerificationToken && emailVerificationToken);
  const ssoSecretHeader =
    typeof req.headers['x-sgw-sso-secret'] === 'string'
      ? req.headers['x-sgw-sso-secret']
      : undefined;
  const trustedBridgeSecret = verifyWebhookSecret(ssoSecretHeader, process.env.SGW_SSO_SECRET);
  const allowBridgePasswordLogin =
    trustedBridgeSecret ||
    (process.env.SGW_REQUIRE_LOGIN !== 'true' && isTestBypassLoginEnabled());

  let boundKakaoGrantId: string | undefined;
  if (hasWeb2FaTokens) {
    const kakaoPayload = verifyKakaoVerificationToken(String(kakaoVerificationToken ?? ''));
    if (!kakaoPayload) {
      res.status(401).json({ error: '① 카카오 본인인증을 먼저 완료해주세요.' });
      return;
    }

    const emailPayload = verifyEmailVerificationToken(
      String(emailVerificationToken ?? ''),
      emailStr,
    );
    if (!emailPayload) {
      res.status(401).json({ error: '② 회사 이메일 보안코드 인증을 완료해주세요.' });
      return;
    }
    boundKakaoGrantId = kakaoPayload.grantId;
  } else if (!allowBridgePasswordLogin) {
    res.status(401).json({ error: '① 카카오 본인인증을 먼저 완료해주세요.' });
    return;
  }

  const result = store.loginUser(emailStr, String(password ?? ''));
  if (result.error || !result.user) {
    recordLoginFailure(emailStr);
    res.status(401).json({ error: result.error ?? '이메일 또는 비밀번호가 올바르지 않습니다.' });
    return;
  }

  clearLoginFailures(emailStr);
  if (boundKakaoGrantId) {
    bindPendingKakaoGrantToUser(boundKakaoGrantId, result.user.id);
  }

  const token = signSessionToken({
    userId: result.user.id,
    email: result.user.email,
    role: result.user.role,
    kakaoVerified: true,
    emailVerified: true,
  });
  const fileToken = signFileScopeToken(result.user.id);

  broadcastAll('presence:update', {
    userId: result.user.id,
    online: true,
    presenceStatus: result.user.presenceStatus,
    lastSeen: result.user.lastSeen,
  });
  res.json({
    ok: true,
    user: { ...result.user, sub: result.user.id },
    token,
    fileToken,
  });
});

app.post('/api/auth/test-session', authLimiter, (_req, res) => {
  if (!isTestBypassLoginEnabled()) {
    res.status(403).json({
      ok: false,
      disabled: true,
      error: '운영 환경에서는 2단계 사내 보안 로그인이 필수입니다.',
    });
    return;
  }

  const users = store.getUsers();
  const testUser =
    users.find((u) => u.id === 'u-minjun') ?? users.find((u) => u.role !== 'bot');
  if (!testUser) {
    res.status(404).json({ ok: false, error: '테스트용 계정을 찾을 수 없습니다.' });
    return;
  }

  const onlineUser = store.setUserOnline(testUser.id, true) ?? testUser;
  const token = signSessionToken({
    userId: onlineUser.id,
    email: onlineUser.email,
    role: onlineUser.role,
    kakaoVerified: true,
    emailVerified: true,
  });
  const fileToken = signFileScopeToken(onlineUser.id);

  broadcastAll('presence:update', {
    userId: onlineUser.id,
    online: true,
    presenceStatus: onlineUser.presenceStatus,
    lastSeen: onlineUser.lastSeen,
  });

  res.json({ ok: true, user: onlineUser, token, fileToken });
});

app.post('/api/auth/logout', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  clearUserKakaoGrant(userId);
  const updated = store.setUserOnline(userId, false);
  if (updated) {
    broadcastAll('presence:update', {
      userId,
      online: false,
      presenceStatus: updated.presenceStatus,
      lastSeen: updated.lastSeen,
    });
  }
  res.json({ ok: true });
});

// --- Authenticated WebSocket Ticket ---
app.post('/api/ws-ticket', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  res.json({ ticket: issueWsTicket(userId) });
});

// --- Authenticated Workspace Data & Chat APIs ---
app.get('/api/bootstrap', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const data = store.getBootstrap(userId);
  if (!data) {
    res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    return;
  }
  res.json(data);
});

app.patch('/api/users/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const { statusMessage, presenceStatus, department, position, phone } = req.body ?? {};
  const updated = store.updateUserProfile(userId, {
    statusMessage,
    presenceStatus: presenceStatus as PresenceStatus | undefined,
    department,
    position,
    phone,
  });
  if (!updated) {
    res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    return;
  }
  broadcastAll('user:updated', { user: updated });
  res.json({ user: updated });
});

app.post('/api/rooms', requireAuth, (req: AuthenticatedRequest, res) => {
  const creatorId = req.authUserId!;
  const { memberIds, name, description } = req.body ?? {};
  if (!Array.isArray(memberIds) || memberIds.length === 0) {
    res.status(400).json({ error: '대화 상대를 1명 이상 선택해주세요.' });
    return;
  }
  const result = store.createOrFindRoom({
    creatorId,
    memberIds: memberIds.map(String),
    name: typeof name === 'string' ? name : undefined,
    description: typeof description === 'string' ? description : undefined,
  });

  if (result.created) {
    broadcastToUsers(result.room.memberIds, 'room:created', { room: result.room });
    if (result.systemMessage) {
      broadcastToUsers(result.room.memberIds, 'message:created', { message: result.systemMessage });
    }
  }
  res.status(result.created ? 201 : 200).json({ room: result.room, created: result.created });
});

app.post('/api/rooms/direct', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const targetUserId = String(req.body?.targetUserId ?? '');
  if (!targetUserId) {
    res.status(400).json({ error: '대화 상대를 선택해주세요.' });
    return;
  }
  const result = store.createOrFindRoom({
    creatorId: userId,
    memberIds: [targetUserId],
  });
  if (result.created) {
    broadcastToUsers(result.room.memberIds, 'room:created', { room: result.room });
  }
  res.status(result.created ? 201 : 200).json({ room: result.room, created: result.created });
});

app.post('/api/rooms/self', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const result = store.ensureSelfRoom(userId);
  if (!result.room) {
    res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    return;
  }
  res.json({ room: result.room, created: result.created });
});

app.patch('/api/rooms/:roomId/disappearing', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const { disappearingSeconds } = req.body ?? {};
  const sec = typeof disappearingSeconds === 'number' ? disappearingSeconds : null;
  const result = store.setRoomDisappearing(req.params.roomId, userId, sec);
  if (result.error || !result.room) {
    res.status(400).json({ error: result.error ?? '설정 변경 실패' });
    return;
  }
  broadcastToUsers(result.room.memberIds, 'room:updated', { room: result.room });
  if (result.systemMessage) {
    broadcastToUsers(result.room.memberIds, 'message:created', {
      message: result.systemMessage,
      room: result.room,
    });
  }
  res.json({ room: result.room, message: result.systemMessage });
});

const handleTogglePinRoom = (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUserId!;
  const existing = store.getRoomById(req.params.roomId);
  if (!existing) {
    res.status(404).json({ error: '채팅방을 찾을 수 없습니다.' });
    return;
  }
  if (!existing.memberIds.includes(userId)) {
    res.status(403).json({ error: '채팅방 멤버만 설정할 수 있습니다.' });
    return;
  }
  const room = store.toggleRoomPin(req.params.roomId, userId);
  if (room) {
    broadcastToUsers([userId], 'room:updated', { room });
  }
  res.json({ room });
};
app.patch('/api/rooms/:roomId/pin', requireAuth, handleTogglePinRoom);
app.post('/api/rooms/:roomId/pin', requireAuth, handleTogglePinRoom);

const handleToggleMuteRoom = (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUserId!;
  const existing = store.getRoomById(req.params.roomId);
  if (!existing) {
    res.status(404).json({ error: '채팅방을 찾을 수 없습니다.' });
    return;
  }
  if (!existing.memberIds.includes(userId)) {
    res.status(403).json({ error: '채팅방 멤버만 설정할 수 있습니다.' });
    return;
  }
  const room = store.toggleRoomMute(req.params.roomId, userId);
  if (room) {
    broadcastToUsers([userId], 'room:updated', { room });
  }
  res.json({ room });
};
app.patch('/api/rooms/:roomId/mute', requireAuth, handleToggleMuteRoom);
app.post('/api/rooms/:roomId/mute', requireAuth, handleToggleMuteRoom);

app.post('/api/rooms/:roomId/invite', requireAuth, (req: AuthenticatedRequest, res) => {
  const inviterId = req.authUserId!;
  const room = store.getRoomById(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: '채팅방을 찾을 수 없습니다.' });
    return;
  }
  if (!room.memberIds.includes(inviterId)) {
    res.status(403).json({ error: '채팅방 멤버만 초대할 수 있습니다.' });
    return;
  }
  const { userIds } = req.body ?? {};
  if (!Array.isArray(userIds)) {
    res.status(400).json({ error: '초대할 사용자를 선택해주세요.' });
    return;
  }
  const result = store.inviteToRoom(req.params.roomId, inviterId, userIds.map(String));
  if (!result.room) {
    res.status(404).json({ error: '채팅방을 찾을 수 없습니다.' });
    return;
  }
  broadcastToUsers(result.room.memberIds, 'room:updated', { room: result.room });
  if (result.systemMessage) {
    broadcastToUsers(result.room.memberIds, 'message:created', { message: result.systemMessage });
  }
  res.json({ room: result.room });
});

const handleLeaveRoom = (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUserId!;
  const result = store.leaveRoom(req.params.roomId, userId);
  if (result.error || !result.room) {
    res.status(400).json({ error: result.error ?? '방 나가기 실패' });
    return;
  }
  broadcastToUsers(result.room.memberIds, 'room:updated', { room: result.room });
  if (result.systemMessage) {
    broadcastToUsers(result.room.memberIds, 'message:created', { message: result.systemMessage });
  }
  res.json({ ok: true, roomId: result.room.id });
};
app.post('/api/rooms/:roomId/leave', requireAuth, handleLeaveRoom);
app.delete('/api/rooms/:roomId/leave', requireAuth, handleLeaveRoom);

app.post('/api/rooms/read-all', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const { updatedRoomIds } = store.markAllRoomsRead(userId);
  for (const roomId of updatedRoomIds) {
    const room = store.getRoomById(roomId);
    if (room) {
      broadcastToUsers(room.memberIds, 'room:read', {
        roomId,
        userId,
        messageIds: [],
      });
    }
  }
  res.json({ ok: true, updatedRoomIds });
});

app.post('/api/rooms/:roomId/messages', requireAuth, (req: AuthenticatedRequest, res) => {
  const senderId = req.authUserId!;
  const {
    type,
    content,
    replyToId,
    emoticonId,
    poll,
    scheduleCard,
    voice,
    integrationAlert,
    viewOnce,
  } = req.body ?? {};
  let sanitizedSchedule: ScheduleCardData | undefined;
  if (type === 'schedule_card') {
    const check = validateScheduleCardInput({
      title: String(scheduleCard?.title ?? ''),
      dateTime: String(scheduleCard?.dateTime ?? ''),
      location: scheduleCard?.location ? String(scheduleCard.location) : undefined,
      memo: scheduleCard?.memo ? String(scheduleCard.memo) : undefined,
    });
    if (!check.ok) {
      res.status(400).json({ error: check.error });
      return;
    }
    sanitizedSchedule = {
      ...check.data,
      attendeesYes: [senderId],
      attendeesMaybe: [],
      attendeesNo: [],
    };
  }
  const result = store.addMessage({
    roomId: req.params.roomId,
    senderId,
    type: type || 'text',
    content: String(content ?? ''),
    replyToId: replyToId ? String(replyToId) : null,
    emoticonId: emoticonId ? String(emoticonId) : undefined,
    poll: poll as PollData | undefined,
    scheduleCard: sanitizedSchedule,
    voice: voice as VoiceAttachment | undefined,
    integrationAlert: integrationAlert as IntegrationActionSummary | undefined,
    viewOnce: Boolean(viewOnce),
  });

  if (result.error || !result.message || !result.room) {
    res.status(400).json({ error: result.error ?? '메시지 전송 실패' });
    return;
  }

  if (result.message.viewOnce) {
    for (const memberId of result.room.memberIds) {
      broadcastToUsers([memberId], 'message:created', {
        message: maskViewOnceMessageForUser(result.message, memberId),
        room: result.room,
      });
    }
  } else {
    broadcastToUsers(result.room.memberIds, 'message:created', {
      message: result.message,
      room: result.room,
    });
  }
  res.status(201).json({ message: result.message });
});

app.post('/api/messages/:messageId/view-once', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const result = store.markMessageViewedOnce(req.params.messageId, userId);
  if (result.error || !result.message || !result.room) {
    res.status(result.alreadyViewed ? 409 : 400).json({
      error: result.error ?? '1회 열람 메시지를 확인할 수 없습니다.',
      alreadyViewed: Boolean(result.alreadyViewed),
    });
    return;
  }
  for (const memberId of result.room.memberIds) {
    broadcastToUsers([memberId], 'message:updated', {
      message: maskViewOnceMessageForUser(result.message, memberId),
    });
  }
  res.json({ ok: true, message: result.message });
});

app.post('/api/messages/:messageId/schedule-rsvp', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const rawChoice = req.body?.choice;
  const choice: 'yes' | 'maybe' | 'no' =
    rawChoice === 'maybe' || rawChoice === 'no' ? rawChoice : 'yes';
  const result = store.toggleScheduleRsvp(req.params.messageId, userId, choice);
  if (result.error || !result.message || !result.room) {
    res.status(400).json({ error: result.error ?? '일정 참석 응답 실패' });
    return;
  }
  broadcastToUsers(result.room.memberIds, 'message:updated', { message: result.message });
  res.json({ message: result.message });
});

app.post('/api/rooms/:roomId/draw', requireAuth, (req: AuthenticatedRequest, res) => {
  const senderId = req.authUserId!;
  const room = store.getRoomById(req.params.roomId);
  if (!room || !room.memberIds.includes(senderId)) {
    res.status(403).json({ error: '채팅방 멤버만 추첨을 진행할 수 있습니다.' });
    return;
  }
  const topic = String(req.body?.topic ?? '').trim().slice(0, 80) || '랜덤 당번 정하기';
  const candidates = Array.isArray(req.body?.candidates)
    ? parseDrawCandidates(req.body.candidates.map(String).join(','))
    : parseDrawCandidates(String(req.body?.candidatesText ?? ''));
  if (candidates.length < 2) {
    res.status(400).json({ error: '추첨 대상은 최소 2명 이상 입력해 주세요.' });
    return;
  }
  const winnerIdx = crypto.randomInt(0, candidates.length);
  const winner = candidates[winnerIdx];
  const result = store.addMessage({
    roomId: room.id,
    senderId,
    type: 'draw_card',
    content: `[랜덤 추첨] ${topic} → 당첨: ${winner}`,
    drawCard: {
      topic,
      candidates,
      winner,
      drawnAt: new Date().toISOString(),
    },
  });
  if (result.error || !result.message || !result.room) {
    res.status(400).json({ error: result.error ?? '추첨 전송 실패' });
    return;
  }
  broadcastToUsers(result.room.memberIds, 'message:created', {
    message: result.message,
    room: result.room,
  });
  res.status(201).json({ message: result.message });
});

app.post(
  '/api/rooms/:roomId/upload',
  requireAuth,
  upload.single('file'),
  (req: AuthenticatedRequest, res) => {
    const senderId = req.authUserId!;
    const room = store.getRoomById(req.params.roomId);
    if (!room || !room.memberIds.includes(senderId)) {
      res.status(403).json({ error: '채팅방 멤버만 파일을 업로드할 수 있습니다.' });
      return;
    }

    const file = req.file as
      | (Express.Multer.File & { customFileId?: string; decodedName?: string })
      | undefined;
    const caption = String(req.body?.caption ?? '');

    if (!file) {
      res.status(400).json({ error: '업로드할 파일이 필요합니다.' });
      return;
    }

    const fileId = file.customFileId || `file-${crypto.randomUUID().slice(0, 8)}`;
    const filename = file.decodedName || file.originalname;
    store.registerUploadedDiskName(fileId, file.filename);

    const isImage = isSafeInlineImageMime(file.mimetype);
    const signedShare = signFileShareToken(fileId, req.params.roomId);
    const shareUrl = `/api/files/shared/${signedShare.token}`;
    const isLargeFile = file.size >= 5 * 1024 * 1024;
    const attachment = {
      id: fileId,
      filename,
      mimeType: file.mimetype || 'application/octet-stream',
      size: file.size,
      url: `/api/files/${fileId}/download`,
      isImage,
      shareUrl,
      shareExpiresAt: signedShare.expiresAt,
      isLargeFile,
      isExternalLink: false,
    };

    const result = store.addMessage({
      roomId: req.params.roomId,
      senderId,
      type: isImage ? 'image' : 'file',
      content: caption.trim() || filename,
      file: attachment,
    });

    if (result.error || !result.message || !result.room) {
      res.status(400).json({ error: result.error ?? '파일 업로드 실패' });
      return;
    }

    const sharedFile = store.getSharedFileById(fileId);
    broadcastToUsers(result.room.memberIds, 'message:created', {
      message: result.message,
      room: result.room,
      sharedFile,
    });
    res.status(201).json({ message: result.message, file: sharedFile });
  },
);

app.post('/api/rooms/:roomId/large-link', requireAuth, (req: AuthenticatedRequest, res) => {
  const senderId = req.authUserId!;
  const room = store.getRoomById(req.params.roomId);
  if (!room || !room.memberIds.includes(senderId)) {
    res.status(403).json({ error: '채팅방 멤버만 대용량 링크를 공유할 수 있습니다.' });
    return;
  }

  const {
    filename,
    externalUrl,
    sizeMB,
    sizeValue,
    sizeUnit,
    expiresDays,
    shareProvider,
    passcode,
    maxDownloads,
    caption,
  } = req.body ?? {};
  const validated = validateLargeFileLinkInput({
    filename: String(filename ?? ''),
    externalUrl: String(externalUrl ?? ''),
    sizeMB: typeof sizeMB === 'number' ? sizeMB : sizeMB !== undefined ? Number(sizeMB) : undefined,
    sizeValue:
      typeof sizeValue === 'number' ? sizeValue : sizeValue !== undefined ? Number(sizeValue) : undefined,
    sizeUnit: sizeUnit === 'MB' || sizeUnit === 'GB' || sizeUnit === 'TB' ? sizeUnit : undefined,
    expiresDays: typeof expiresDays === 'number' ? expiresDays : Number(expiresDays || 7),
    shareProvider: typeof shareProvider === 'string' ? (shareProvider as ShareProvider) : undefined,
    passcode: typeof passcode === 'string' ? passcode : undefined,
    maxDownloads:
      maxDownloads !== undefined && maxDownloads !== null && maxDownloads !== ''
        ? Number(maxDownloads)
        : undefined,
  });

  if (!validated.ok) {
    res.status(400).json({ error: validated.error });
    return;
  }

  const fileId = `link-${crypto.randomUUID().slice(0, 8)}`;
  const signedShare = signFileShareToken(
    fileId,
    req.params.roomId,
    validated.expiresDays * 24 * 60 * 60 * 1000,
  );
  const shareUrl = `/api/files/shared/${signedShare.token}`;
  const passcodeHash = validated.passcode ? hashSharePasscode(validated.passcode) : undefined;

  const result = store.addExternalLargeFileLink({
    fileId,
    roomId: req.params.roomId,
    senderId,
    filename: validated.filename,
    externalUrl: validated.externalUrl,
    shareUrl,
    shareProvider: validated.shareProvider,
    sizeBytes: validated.sizeBytes,
    expiresAt: signedShare.expiresAt,
    passcodeHash,
    maxDownloads: validated.maxDownloads,
    caption: typeof caption === 'string' ? caption : undefined,
  });

  if (result.error || !result.message || !result.room) {
    res.status(400).json({ error: result.error ?? '대용량 링크 공유 실패' });
    return;
  }

  broadcastToUsers(result.room.memberIds, 'message:created', {
    message: result.message,
    room: result.room,
    sharedFile: result.sharedFile,
  });
  res.status(201).json({ message: result.message, file: result.sharedFile });
});

const nasUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

app.get('/api/nas/folders', requireAuth, (_req, res) => {
  const folders = listNasFolders();
  const configuredExt = getConfiguredNasExternalBaseUrl();
  res.json({
    basePathDisplay: '\\\\nas.sgw.internal\\shared',
    externalGatewayBase: configuredExt || null,
    folders,
  });
});

app.post(
  '/api/nas/upload',
  requireAuth,
  nasUpload.single('file'),
  (req: AuthenticatedRequest, res) => {
    const userId = req.authUserId!;
    const file = req.file;
    if (!file || !file.buffer) {
      res.status(400).json({ error: 'NAS 폴더에 복사할 파일을 선택해 주세요.' });
      return;
    }
    let decodedName = file.originalname;
    try {
      decodedName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    } catch {}
    const safeName = sanitizeNasFilename(decodedName) || `nas_${Date.now()}.bin`;
    const nasFolder = sanitizeNasFolder(String(req.body?.nasFolder ?? '전사-공유'));
    const copied = copyBufferToNasFolder({
      folder: nasFolder,
      filename: safeName,
      buffer: file.buffer,
    });
    if (!copied) {
      res.status(400).json({ error: 'NAS 폴더에 파일을 복사하지 못했습니다.' });
      return;
    }

    const daysNum = Math.min(90, Math.max(1, Number(req.body?.expiresDays || 7) || 7));
    const rawPasscode = typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : '';
    if (rawPasscode && (rawPasscode.length < 4 || rawPasscode.length > 24)) {
      res.status(400).json({ error: '공유 비밀번호(PIN)는 4자 이상 24자 이하로 입력해 주세요.' });
      return;
    }
    const maxDownloads =
      req.body?.maxDownloads !== undefined && req.body?.maxDownloads !== ''
        ? Math.min(1000, Math.max(1, Math.floor(Number(req.body.maxDownloads))))
        : null;
    const roomId = typeof req.body?.roomId === 'string' ? req.body.roomId.trim() : '';
    const fileId = `nas-${crypto.randomUUID().slice(0, 8)}`;
    const signedShare = signFileShareToken(
      fileId,
      roomId || 'nas-vault',
      daysNum * 24 * 60 * 60 * 1000,
    );
    const sharePath = `/api/files/shared/${signedShare.token}`;
    const configuredExt = getConfiguredNasExternalBaseUrl();
    const nasExternalAccessUrl = configuredExt ? `${configuredExt}${sharePath}` : sharePath;
    const passcodeHash = rawPasscode ? hashSharePasscode(rawPasscode) : undefined;

    if (roomId) {
      const room = store.getRoomById(roomId);
      if (!room || !room.memberIds.includes(userId)) {
        res.status(403).json({ error: '채팅방 멤버만 NAS 파일을 공유할 수 있습니다.' });
        return;
      }
      const result = store.addExternalLargeFileLink({
        fileId,
        roomId: room.id,
        senderId: userId,
        filename: copied.filename,
        externalUrl: `/api/files/${fileId}/download`,
        shareUrl: sharePath,
        shareProvider: 'nas',
        storageLocation: 'internal-nas',
        nasFolder: copied.folder,
        nasRelativePath: copied.relativePath,
        nasExternalAccessUrl,
        isExternalLink: false,
        sizeBytes: copied.size,
        expiresAt: signedShare.expiresAt,
        passcodeHash,
        maxDownloads,
        caption: typeof req.body?.caption === 'string' ? req.body.caption : undefined,
      });
      if (result.error || !result.message || !result.room) {
        res.status(400).json({ error: result.error ?? 'NAS 파일 공유 실패' });
        return;
      }
      broadcastToUsers(result.room.memberIds, 'message:created', {
        message: result.message,
        room: result.room,
        sharedFile: result.sharedFile,
      });
      res.status(201).json({ message: result.message, file: result.sharedFile });
      return;
    }

    const registered = store.registerMailNasAttachment({
      fileId,
      senderId: userId,
      filename: copied.filename,
      sizeBytes: copied.size,
      shareUrl: sharePath,
      expiresAt: signedShare.expiresAt,
      passcodeHash,
      maxDownloads,
      shareProvider: 'nas',
      storageLocation: 'internal-nas',
      nasFolder: copied.folder,
      nasRelativePath: copied.relativePath,
      nasExternalAccessUrl,
      externalUrl: `/api/files/${fileId}/download`,
      isExternalLink: false,
    });
    res.status(201).json({ file: registered });
  },
);

app.post('/api/rooms/:roomId/nas-share', requireAuth, (req: AuthenticatedRequest, res) => {
  const senderId = req.authUserId!;
  const room = store.getRoomById(req.params.roomId);
  if (!room || !room.memberIds.includes(senderId)) {
    res.status(403).json({ error: '채팅방 멤버만 NAS 대용량 파일을 공유할 수 있습니다.' });
    return;
  }

  const {
    nasFolder,
    filename,
    sourceNasRelativePath,
    externalNasUrl,
    sizeValue,
    sizeUnit,
    expiresDays,
    passcode,
    maxDownloads,
    caption,
  } = req.body ?? {};

  const validated = validateNasShareRequest({
    nasFolder: String(nasFolder ?? '전사-공유'),
    filename: String(filename ?? ''),
    externalNasUrl: typeof externalNasUrl === 'string' ? externalNasUrl : undefined,
    sizeValue: typeof sizeValue === 'number' ? sizeValue : Number(sizeValue || 100),
    sizeUnit: sizeUnit === 'MB' || sizeUnit === 'GB' || sizeUnit === 'TB' ? sizeUnit : 'GB',
    expiresDays: typeof expiresDays === 'number' ? expiresDays : Number(expiresDays || 7),
    passcode: typeof passcode === 'string' ? passcode : undefined,
    maxDownloads:
      maxDownloads !== undefined && maxDownloads !== null && maxDownloads !== ''
        ? Number(maxDownloads)
        : undefined,
  });

  if (!validated.ok) {
    res.status(400).json({ error: validated.error });
    return;
  }

  const staged = ensureNasPackageFile({
    targetFolder: validated.nasFolder,
    filename: validated.filename,
    sourceNasRelativePath:
      typeof sourceNasRelativePath === 'string' ? sourceNasRelativePath : undefined,
    declaredSizeBytes: validated.sizeBytes,
  });
  if (!staged) {
    res.status(400).json({ error: '사내 NAS 폴더에 파일을 복사하지 못했습니다.' });
    return;
  }

  const fileId = `nas-${crypto.randomUUID().slice(0, 8)}`;
  const signedShare = signFileShareToken(
    fileId,
    req.params.roomId,
    validated.expiresDays * 24 * 60 * 60 * 1000,
  );
  const sharePath = `/api/files/shared/${signedShare.token}`;
  const configuredExt = getConfiguredNasExternalBaseUrl();
  const nasExternalAccessUrl =
    validated.externalNasUrl || (configuredExt ? `${configuredExt}${sharePath}` : sharePath);
  const passcodeHash = validated.passcode ? hashSharePasscode(validated.passcode) : undefined;

  const result = store.addExternalLargeFileLink({
    fileId,
    roomId: req.params.roomId,
    senderId,
    filename: staged.filename,
    externalUrl: validated.externalNasUrl || `/api/files/${fileId}/download`,
    shareUrl: sharePath,
    shareProvider: 'nas',
    storageLocation: 'internal-nas',
    nasFolder: staged.folder,
    nasRelativePath: staged.relativePath,
    nasExternalAccessUrl,
    isExternalLink: Boolean(validated.externalNasUrl),
    sizeBytes: validated.sizeBytes,
    expiresAt: signedShare.expiresAt,
    passcodeHash,
    maxDownloads: validated.maxDownloads,
    caption: typeof caption === 'string' ? caption : undefined,
  });

  if (result.error || !result.message || !result.room) {
    res.status(400).json({ error: result.error ?? 'NAS 대용량 공유 실패' });
    return;
  }

  broadcastToUsers(result.room.memberIds, 'message:created', {
    message: result.message,
    room: result.room,
    sharedFile: result.sharedFile,
  });
  res.status(201).json({ message: result.message, file: result.sharedFile });
});

app.post('/api/files/chunked/init', requireAuth, (req: AuthenticatedRequest, res) => {
  cleanupExpiredChunkSessions();
  const userId = req.authUserId!;
  const { roomId, filename, mimeType, totalSize, totalChunks, nasFolder } = req.body ?? {};
  const room = store.getRoomById(String(roomId ?? ''));
  if (!room || !room.memberIds.includes(userId)) {
    res.status(403).json({ error: '채팅방 멤버만 분할 업로드를 시작할 수 있습니다.' });
    return;
  }

  const cleanName = String(filename ?? '').trim();
  const sizeNum = Number(totalSize);
  const chunksNum = Number(totalChunks);
  if (!cleanName) {
    res.status(400).json({ error: '파일명이 필요합니다.' });
    return;
  }
  if (!Number.isFinite(sizeNum) || sizeNum <= 0 || sizeNum > MAX_CHUNKED_TOTAL_BYTES) {
    res.status(400).json({
      error: '분할 업로드는 최대 500MB까지 지원합니다. 500MB 초과 파일은 100GB 외부 링크 공유를 이용해 주세요.',
    });
    return;
  }
  if (!Number.isInteger(chunksNum) || chunksNum < 1 || chunksNum > MAX_CHUNK_COUNT) {
    res.status(400).json({ error: '유효하지 않은 분할 청크 개수입니다.' });
    return;
  }

  const sessionId = `chk-${crypto.randomUUID().slice(0, 12)}`;
  const root = getChunksRootDir();
  const chunkDir = path.resolve(root, sessionId);
  if (!isPathInsideDir(chunkDir, root)) {
    res.status(400).json({ error: '잘못된 업로드 경로입니다.' });
    return;
  }
  fs.mkdirSync(chunkDir, { recursive: true });

  chunkSessions.set(sessionId, {
    id: sessionId,
    userId,
    roomId: room.id,
    filename: cleanName,
    mimeType: typeof mimeType === 'string' && mimeType.trim() ? mimeType.trim() : 'application/octet-stream',
    totalSize: sizeNum,
    totalChunks: chunksNum,
    receivedChunks: new Set<number>(),
    createdAt: Date.now(),
    chunkDir,
    ...(typeof nasFolder === 'string' && nasFolder.trim()
      ? { nasFolder: sanitizeNasFolder(nasFolder) }
      : {}),
  });

  res.status(201).json({ sessionId, chunkSize: 5 * 1024 * 1024 });
});

app.post(
  '/api/files/chunked/:sessionId/chunk',
  requireAuth,
  chunkUpload.single('chunk'),
  (req: AuthenticatedRequest, res) => {
    const userId = req.authUserId!;
    const session = chunkSessions.get(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: '업로드 세션이 존재하지 않거나 만료되었습니다.' });
      return;
    }
    if (session.userId !== userId) {
      res.status(403).json({ error: '본인의 업로드 세션에만 청크를 전송할 수 있습니다.' });
      return;
    }

    const chunkIndex = Number(req.body?.chunkIndex);
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= session.totalChunks) {
      res.status(400).json({ error: '유효하지 않은 청크 인덱스입니다.' });
      return;
    }
    if (!req.file || !req.file.buffer) {
      res.status(400).json({ error: '전송된 청크 데이터가 없습니다.' });
      return;
    }

    const partPath = path.resolve(session.chunkDir, `${chunkIndex}.part`);
    if (!isPathInsideDir(partPath, session.chunkDir)) {
      res.status(400).json({ error: '잘못된 청크 경로입니다.' });
      return;
    }
    fs.writeFileSync(partPath, req.file.buffer);
    session.receivedChunks.add(chunkIndex);

    res.json({
      ok: true,
      chunkIndex,
      receivedCount: session.receivedChunks.size,
      totalChunks: session.totalChunks,
    });
  },
);

app.post('/api/files/chunked/:sessionId/complete', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const session = chunkSessions.get(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: '업로드 세션이 존재하지 않거나 만료되었습니다.' });
    return;
  }
  if (session.userId !== userId) {
    res.status(403).json({ error: '본인의 업로드 세션만 완료할 수 있습니다.' });
    return;
  }
  for (let i = 0; i < session.totalChunks; i += 1) {
    if (!session.receivedChunks.has(i)) {
      res.status(400).json({ error: `${i + 1}번째 분할 청크가 아직 수신되지 않았습니다.` });
      return;
    }
  }

  const fileId = `file-${crypto.randomUUID().slice(0, 8)}`;
  const safeBase = session.filename.replace(/[^\w.\-가-힣\s()]/g, '_');
  const diskName = `${fileId}-${safeBase}`;
  const uploadDir = getUploadDir();
  const finalPath = path.resolve(uploadDir, diskName);
  if (!isPathInsideDir(finalPath, uploadDir)) {
    res.status(400).json({ error: '잘못된 최종 저장 경로입니다.' });
    return;
  }

  const outFd = fs.openSync(finalPath, 'w');
  let assembledSize = 0;
  try {
    for (let i = 0; i < session.totalChunks; i += 1) {
      const partPath = path.resolve(session.chunkDir, `${i}.part`);
      if (!isPathInsideDir(partPath, session.chunkDir) || !fs.existsSync(partPath)) {
        throw new Error('Missing chunk part');
      }
      const buf = fs.readFileSync(partPath);
      fs.writeSync(outFd, buf);
      assembledSize += buf.length;
    }
  } finally {
    fs.closeSync(outFd);
  }

  const root = getChunksRootDir();
  if (isPathInsideDir(session.chunkDir, root) && fs.existsSync(session.chunkDir)) {
    fs.rmSync(session.chunkDir, { recursive: true, force: true });
  }
  chunkSessions.delete(session.id);

  let finalNasRelativePath: string | undefined;
  let finalNasFolder = session.nasFolder;
  if (finalNasFolder) {
    const copiedToNas = copyExistingFileToNasFolder({
      sourceAbsPath: finalPath,
      allowedSourceRoots: [uploadDir],
      targetFolder: finalNasFolder,
      targetFilename: session.filename,
    });
    if (copiedToNas) {
      finalNasRelativePath = copiedToNas.relativePath;
      finalNasFolder = copiedToNas.folder;
    }
  }

  store.registerUploadedDiskName(fileId, diskName);
  const isImage = isSafeInlineImageMime(session.mimeType);
  const signedShare = signFileShareToken(fileId, session.roomId);
  const shareUrl = `/api/files/shared/${signedShare.token}`;
  const caption = typeof req.body?.caption === 'string' ? req.body.caption.trim() : '';
  const configuredExt = getConfiguredNasExternalBaseUrl();

  const attachment = {
    id: fileId,
    filename: session.filename,
    mimeType: session.mimeType,
    size: assembledSize,
    url: `/api/files/${fileId}/download`,
    isImage,
    shareUrl,
    shareExpiresAt: signedShare.expiresAt,
    isLargeFile: assembledSize >= 5 * 1024 * 1024 || Boolean(finalNasFolder),
    isExternalLink: false,
    shareProvider: (finalNasFolder ? 'nas' : 'sgw-relay') as ShareProvider,
    transferMode: 'chunked-resumable' as const,
    storageLocation: (finalNasFolder ? 'internal-nas' : 'relay') as 'internal-nas' | 'relay',
    ...(finalNasFolder ? { nasFolder: finalNasFolder } : {}),
    ...(finalNasRelativePath ? { nasRelativePath: finalNasRelativePath } : {}),
    ...(finalNasFolder
      ? { nasExternalAccessUrl: configuredExt ? `${configuredExt}${shareUrl}` : shareUrl }
      : {}),
    hasPasscode: false,
    maxDownloads: null,
    downloadCount: 0,
    revoked: false,
  };

  const result = store.addMessage({
    roomId: session.roomId,
    senderId: userId,
    type: isImage ? 'image' : 'file',
    content: caption || (finalNasFolder ? `[NAS 복사 · 분할 업로드] ${finalNasFolder}/${session.filename}` : session.filename),
    file: attachment,
  });

  if (result.error || !result.message || !result.room) {
    res.status(400).json({ error: result.error ?? '분할 업로드 완료 처리 실패' });
    return;
  }

  const sharedFile = store.getSharedFileById(fileId);
  broadcastToUsers(result.room.memberIds, 'message:created', {
    message: result.message,
    room: result.room,
    sharedFile,
  });
  res.status(201).json({ message: result.message, file: sharedFile });
});

function renderSharePasscodeHtml(options: {
  token: string;
  filename: string;
  sizeText: string;
  nasFolder?: string;
  errorText?: string;
}): string {
  const safeToken = encodeURIComponent(options.token);
  const safeName = escapeHtmlText(options.filename);
  const safeSize = escapeHtmlText(options.sizeText);
  const safeFolder = options.nasFolder ? escapeHtmlText(options.nasFolder) : '';
  const safeErr = options.errorText ? escapeHtmlText(options.errorText) : '';
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SGW 보안 파일 공유 확인</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Noto Sans KR", sans-serif; background: #f8fafc; color: #0f172a; margin: 0; display: grid; place-items: center; min-height: 100vh; padding: 16px; }
    .card { width: 100%; max-width: 420px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); }
    h1 { font-size: 18px; margin: 0 0 8px; }
    p { font-size: 13px; color: #475569; margin: 0 0 16px; line-height: 1.5; }
    .meta { background: #f1f5f9; border-radius: 10px; padding: 12px; margin-bottom: 16px; font-size: 13px; }
    .err { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; border-radius: 10px; padding: 10px 12px; font-size: 12px; margin-bottom: 12px; }
    input { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 10px; font-size: 14px; margin-bottom: 12px; }
    button { width: 100%; padding: 11px 16px; border: 0; border-radius: 10px; background: #1c2924; color: #ffffff; font-weight: 600; font-size: 14px; cursor: pointer; }
  </style>
</head>
<body>
  <main class="card">
    <h1>${safeFolder ? 'SGW NAS 외부 보안 다운로드' : 'SGW 보안 파일 확인'}</h1>
    <p>${
      safeFolder
        ? '사내 NAS 폴더에 안전하게 복사된 대용량 파일입니다. 비밀번호 확인 후 외부 접속을 통해 다운로드할 수 있습니다.'
        : '이 대용량 공유 링크는 비밀번호로 보호되어 있습니다. 접근 비밀번호를 입력하면 안전하게 다운로드가 시작됩니다.'
    }</p>
    <div class="meta"><strong>${safeName}</strong>${safeFolder ? `<br />사내 NAS 폴더: ${safeFolder}` : ''}<br />용량: ${safeSize}</div>
    ${safeErr ? `<div class="err">${safeErr}</div>` : ''}
    <form method="POST" action="/api/files/shared/${safeToken}/verify">
      <input type="password" name="passcode" placeholder="비밀번호 4~24자리 입력" required minlength="4" maxlength="24" autofocus />
      <button type="submit">비밀번호 확인 후 다운로드</button>
    </form>
  </main>
</body>
</html>`;
}

app.post(
  '/api/files/shared/:token/verify',
  shareVerifyLimiter,
  express.urlencoded({ extended: false }),
  (req, res) => {
    const payload = verifyFileShareToken(req.params.token);
    if (!payload) {
      res.status(401).json({ error: '만료되었거나 유효하지 않은 대용량 파일 공유 링크입니다.' });
      return;
    }
    const sharedItem = store.getSharedFileById(payload.fileId);
    if (!sharedItem) {
      res.status(404).json({ error: '공유된 파일을 찾을 수 없습니다.' });
      return;
    }
    if (sharedItem.revoked) {
      res.status(410).json({ error: '발신자에 의해 회수된 공유 링크입니다.' });
      return;
    }
    if (sharedItem.shareExpiresAt && Date.now() > new Date(sharedItem.shareExpiresAt).getTime()) {
      res.status(410).json({ error: '만료된 공유 링크입니다.' });
      return;
    }
    if (
      sharedItem.maxDownloads !== undefined &&
      sharedItem.maxDownloads !== null &&
      (sharedItem.downloadCount ?? 0) >= sharedItem.maxDownloads
    ) {
      res.status(410).json({ error: '최대 다운로드 허용 횟수를 초과했습니다.' });
      return;
    }

    const passcode = String(req.body?.passcode ?? '').trim();
    const ok = store.verifyFilePasscode(sharedItem.id, passcode, verifySharePasscode);
    const wantsJson =
      req.is('application/json') || Boolean(req.headers.accept?.includes('application/json'));

    if (!ok) {
      if (wantsJson) {
        res.status(401).json({ error: '공유 링크 비밀번호가 일치하지 않습니다.' });
        return;
      }
      res
        .status(401)
        .type('text/html; charset=utf-8')
        .send(
          renderSharePasscodeHtml({
            token: req.params.token,
            filename: sharedItem.filename,
            sizeText: formatFileSize(sharedItem.size),
            nasFolder: sharedItem.nasFolder,
            errorText: '비밀번호가 일치하지 않습니다. 다시 확인해 주세요.',
          }),
        );
      return;
    }

    const unlockToken = signShareUnlockToken(sharedItem.id);
    const downloadUrl = `/api/files/shared/${encodeURIComponent(req.params.token)}?unlock=${encodeURIComponent(unlockToken)}`;
    if (wantsJson) {
      res.json({ ok: true, downloadUrl });
      return;
    }
    res.redirect(303, downloadUrl);
  },
);

function pipeDiskStreamSafely(res: Response, stream: fs.ReadStream): void {
  const cleanup = () => {
    if (!stream.destroyed) {
      stream.destroy();
    }
  };
  res.on('close', cleanup);
  stream.on('error', () => {
    cleanup();
    if (!res.headersSent) {
      res.status(404).json({ error: '파일 스트림을 읽을 수 없습니다.' });
    } else if (!res.writableEnded) {
      res.end();
    }
  });
  stream.pipe(res);
}

function streamDiskFileWithRange(
  req: Request,
  res: Response,
  options: { filePath: string; filename: string; mimeType: string; inline?: boolean },
): void {
  const stat = fs.statSync(options.filePath);
  const totalSize = stat.size;
  const encodedName = encodeURIComponent(options.filename);
  const disposition = `${options.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodedName}`;

  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:");
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', options.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', disposition);

  const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range : undefined;
  const parsedRange = parseHttpRangeHeader(rangeHeader, totalSize);
  if (parsedRange) {
    if (!parsedRange.ok) {
      res.setHeader('Content-Range', `bytes */${totalSize}`);
      res.status(416).end();
      return;
    }
    const chunkLen = parsedRange.end - parsedRange.start + 1;
    res.status(206);
    res.setHeader('Content-Range', `bytes ${parsedRange.start}-${parsedRange.end}/${totalSize}`);
    res.setHeader('Content-Length', String(chunkLen));
    pipeDiskStreamSafely(
      res,
      fs.createReadStream(options.filePath, {
        start: parsedRange.start,
        end: parsedRange.end,
      }),
    );
    return;
  }

  res.setHeader('Content-Length', String(totalSize));
  pipeDiskStreamSafely(res, fs.createReadStream(options.filePath));
}

app.get('/api/files/shared/:token', (req, res) => {
  const payload = verifyFileShareToken(req.params.token);
  if (!payload) {
    res.status(401).json({ error: '만료되었거나 유효하지 않은 대용량 파일 공유 링크입니다.' });
    return;
  }

  const sharedItem = store.getSharedFileById(payload.fileId);
  if (!sharedItem) {
    res.status(404).json({ error: '공유된 파일을 찾을 수 없습니다.' });
    return;
  }
  if (sharedItem.revoked) {
    res.status(410).json({ error: '발신자에 의해 회수(만료)된 공유 링크입니다.' });
    return;
  }
  if (sharedItem.shareExpiresAt && Date.now() > new Date(sharedItem.shareExpiresAt).getTime()) {
    res.status(410).json({ error: '공유 링크 유효기간이 만료되었습니다.' });
    return;
  }
  if (
    sharedItem.maxDownloads !== undefined &&
    sharedItem.maxDownloads !== null &&
    (sharedItem.downloadCount ?? 0) >= sharedItem.maxDownloads
  ) {
    res.status(410).json({ error: '최대 다운로드 허용 횟수를 초과했습니다.' });
    return;
  }

  if (sharedItem.hasPasscode) {
    const unlock = typeof req.query.unlock === 'string' ? req.query.unlock : '';
    if (!verifyShareUnlockToken(unlock, sharedItem.id)) {
      if (req.headers.accept?.includes('application/json')) {
        res.status(401).json({
          requiresPasscode: true,
          error: '비밀번호 확인이 필요한 공유 링크입니다.',
        });
        return;
      }
      res
        .status(200)
        .type('text/html; charset=utf-8')
        .send(
          renderSharePasscodeHtml({
            token: req.params.token,
            filename: sharedItem.filename,
            sizeText: formatFileSize(sharedItem.size),
            nasFolder: sharedItem.nasFolder,
          }),
        );
      return;
    }
  }

  // Only count full or initial byte requests (start=0) once so multi-part Range resumes don't exhaust limits unfairly
  const rangeHdr = typeof req.headers.range === 'string' ? req.headers.range : '';
  const shouldRecord = !rangeHdr || /^bytes=0-/i.test(rangeHdr);
  if (shouldRecord) {
    const recorded = store.recordFileDownload(sharedItem.id);
    if (recorded.room && recorded.sharedFile) {
      broadcastToUsers(recorded.room.memberIds, 'file:updated', {
        sharedFile: recorded.sharedFile,
        message: recorded.message,
        room: recorded.room,
      });
    }
    for (const mail of recorded.updatedMails) {
      const recipients = Array.from(new Set([mail.senderId, ...mail.recipientIds]));
      broadcastToUsers(recipients, 'mail:updated', { mail });
    }
  }

  if (sharedItem.isExternalLink && sharedItem.url && !sharedItem.url.startsWith('/api/')) {
    const valid = validateExternalHttpUrl(sharedItem.url);
    if (!valid.ok) {
      res.status(400).json({ error: valid.error });
      return;
    }
    res.redirect(302, valid.url);
    return;
  }

  const found = store.getDiskPathForFile(payload.fileId);
  if (!found) {
    res.status(404).json({ error: '공유된 파일을 찾을 수 없습니다.' });
    return;
  }

  streamDiskFileWithRange(req, res, {
    filePath: found.filePath,
    filename: found.item.filename,
    mimeType: found.item.mimeType,
  });
});

app.post('/api/files/:fileId/revoke', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const result = store.revokeSharedFile(req.params.fileId, userId);
  if (result.error || !result.sharedFile) {
    res.status(403).json({ error: result.error ?? '공유 링크 회수에 실패했습니다.' });
    return;
  }
  if (result.room) {
    broadcastToUsers(result.room.memberIds, 'file:updated', {
      sharedFile: result.sharedFile,
      message: result.message,
      room: result.room,
    });
  }
  for (const mail of result.updatedMails) {
    const recipients = Array.from(new Set([mail.senderId, ...mail.recipientIds]));
    broadcastToUsers(recipients, 'mail:updated', { mail });
  }
  res.json({ file: result.sharedFile, message: result.message });
});

app.get('/api/files/:fileId/download', (req, res) => {
  const bearer = extractBearerToken(req);
  const queryFt = typeof req.query.ft === 'string' ? req.query.ft : '';
  const sessionPayload = bearer ? verifySessionToken(bearer) : null;
  const filePayload = queryFt ? verifyFileScopeToken(queryFt) : null;
  const authedUserId = sessionPayload?.sub ?? filePayload?.sub ?? null;

  if (!authedUserId) {
    res.status(401).json({ error: '파일 접근 권한 인증이 필요합니다.' });
    return;
  }

  const existingShared = store.getSharedFileById(req.params.fileId);
  if (existingShared?.revoked) {
    res.status(410).json({ error: '회수된 파일 공유 링크입니다.' });
    return;
  }

  const found = store.getDiskPathForFile(req.params.fileId);
  if (!found) {
    if (existingShared?.isExternalLink && existingShared.url) {
      const room = store.getRoomById(existingShared.roomId);
      if (!room || !room.memberIds.includes(authedUserId)) {
        res.status(403).json({ error: '해당 채팅방 멤버만 파일을 내려받을 수 있습니다.' });
        return;
      }
      const valid = validateExternalHttpUrl(existingShared.url);
      if (!valid.ok) {
        res.status(400).json({ error: valid.error });
        return;
      }
      const rec = store.recordFileDownload(existingShared.id);
      if (rec.room && rec.sharedFile) {
        broadcastToUsers(rec.room.memberIds, 'file:updated', {
          sharedFile: rec.sharedFile,
          message: rec.message,
          room: rec.room,
        });
      }
      res.redirect(302, valid.url);
      return;
    }
    res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    return;
  }
  const { filePath, item } = found;
  const room = store.getRoomById(item.roomId);
  if (!room || !room.memberIds.includes(authedUserId)) {
    res.status(403).json({ error: '해당 채팅방 멤버만 파일을 내려받을 수 있습니다.' });
    return;
  }

  const inline = req.query.inline === '1' && isSafeInlineImageMime(item.mimeType);
  if (!inline) {
    const rec = store.recordFileDownload(item.id);
    if (rec.room && rec.sharedFile) {
      broadcastToUsers(rec.room.memberIds, 'file:updated', {
        sharedFile: rec.sharedFile,
        message: rec.message,
        room: rec.room,
      });
    }
  }
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:");
  res.setHeader('Content-Type', item.mimeType || 'application/octet-stream');
  const encodedName = encodeURIComponent(item.filename);
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodedName}`,
  );
  pipeDiskStreamSafely(res, fs.createReadStream(filePath));
});

app.post('/api/rooms/:roomId/read', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const room = store.getRoomById(req.params.roomId);
  if (!room || !room.memberIds.includes(userId)) {
    res.status(403).json({ error: '채팅방 멤버가 아닙니다.' });
    return;
  }
  const result = store.markRoomRead(req.params.roomId, userId);
  if (result.updatedMessageIds.length > 0) {
    broadcastToUsers(room.memberIds, 'room:read', {
      roomId: req.params.roomId,
      userId,
      messageIds: result.updatedMessageIds,
    });
  }
  res.json({ ok: true, updatedCount: result.updatedMessageIds.length });
});

const handleToggleReaction = (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUserId!;
  const { emoji } = req.body ?? {};
  const msg = store.toggleReaction(req.params.messageId, String(emoji ?? ''), userId);
  if (!msg) {
    res.status(404).json({ error: '메시지를 찾을 수 없습니다.' });
    return;
  }
  const room = store.getRoomById(msg.roomId);
  if (room) {
    broadcastToUsers(room.memberIds, 'message:updated', { message: msg });
  }
  res.json({ message: msg });
};
app.post('/api/messages/:messageId/react', requireAuth, handleToggleReaction);
app.post('/api/messages/:messageId/reactions', requireAuth, handleToggleReaction);

app.delete('/api/messages/:messageId', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const msg = store.deleteMessage(req.params.messageId, userId);
  if (!msg) {
    res.status(403).json({ error: '본인의 메시지만 삭제할 수 있습니다.' });
    return;
  }
  const room = store.getRoomById(msg.roomId);
  if (room) {
    broadcastToUsers(room.memberIds, 'message:updated', { message: msg });
  }
  res.json({ message: msg });
});

app.post('/api/messages/:messageId/recall', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const result = store.recallMessage(req.params.messageId, userId);
  if (result.error || !result.message) {
    res.status(400).json({ error: result.error ?? '메시지 회수 실패' });
    return;
  }
  const room = store.getRoomById(result.message.roomId);
  if (room) {
    broadcastToUsers(room.memberIds, 'message:updated', { message: result.message });
  }
  res.json({ message: result.message });
});

app.patch('/api/messages/:messageId', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const { content } = req.body ?? {};
  const result = store.editMessage(req.params.messageId, userId, String(content ?? ''));
  if (result.error || !result.message) {
    res.status(400).json({ error: result.error ?? '메시지 수정 실패' });
    return;
  }
  const room = store.getRoomById(result.message.roomId);
  if (room) {
    broadcastToUsers(room.memberIds, 'message:updated', { message: result.message });
  }
  res.json({ message: result.message });
});

app.post('/api/messages/:messageId/star', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const msg = store.toggleStarMessage(req.params.messageId, userId);
  if (!msg) {
    res.status(404).json({ error: '메시지를 찾을 수 없습니다.' });
    return;
  }
  const room = store.getRoomById(msg.roomId);
  if (room) {
    broadcastToUsers(room.memberIds, 'message:updated', { message: msg });
  }
  res.json({ message: msg });
});

app.post('/api/messages/forward', requireAuth, (req: AuthenticatedRequest, res) => {
  const senderId = req.authUserId!;
  const { messageIds, targetRoomId, targetUserId } = req.body ?? {};
  const result = store.forwardMessages({
    senderId,
    messageIds: Array.isArray(messageIds) ? messageIds.map(String) : [],
    targetRoomId: targetRoomId ? String(targetRoomId) : undefined,
    targetUserId: targetUserId ? String(targetUserId) : undefined,
  });
  if (result.error || !result.room) {
    res.status(400).json({ error: result.error ?? '메시지 전달 실패' });
    return;
  }
  if (result.roomCreated) {
    broadcastToUsers(result.room.memberIds, 'room:created', { room: result.room });
  }
  for (const msg of result.messages) {
    broadcastToUsers(result.room.memberIds, 'message:created', {
      message: msg,
      room: result.room,
    });
  }
  res.status(201).json({
    room: result.room,
    roomCreated: result.roomCreated,
    messages: result.messages,
  });
});

app.post('/api/polls/:messageId/vote', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const { optionId } = req.body ?? {};
  const msg = store.votePoll(req.params.messageId, String(optionId ?? ''), userId);
  if (!msg) {
    res.status(404).json({ error: '투표를 찾을 수 없습니다.' });
    return;
  }
  const room = store.getRoomById(msg.roomId);
  if (room) {
    broadcastToUsers(room.memberIds, 'message:updated', { message: msg });
  }
  res.json({ message: msg });
});

app.post('/api/rooms/:roomId/notices', requireAuth, (req: AuthenticatedRequest, res) => {
  const authorId = req.authUserId!;
  const room = store.getRoomById(req.params.roomId);
  if (!room || !room.memberIds.includes(authorId)) {
    res.status(403).json({ error: '채팅방 멤버만 공지를 등록할 수 있습니다.' });
    return;
  }
  const { title, content, messageId, priority, isUrgent, pushAllMembers } = req.body ?? {};
  const normalizedPriority = normalizeNoticePriority({ priority, isUrgent });
  const urgentFlag = Boolean(isUrgent || normalizedPriority === 'urgent');
  const result = store.createNotice({
    roomId: req.params.roomId,
    authorId,
    title: String(title ?? ''),
    content: String(content ?? ''),
    messageId: messageId ? String(messageId) : null,
    priority: normalizedPriority,
    isUrgent: urgentFlag,
    pushAllMembers: Boolean(pushAllMembers || urgentFlag),
  });

  if (result.error || !result.notice || !result.room || !result.alertMessage) {
    res.status(400).json({ error: result.error ?? '공지 등록 실패' });
    return;
  }

  broadcastToUsers(result.pushTargetUserIds, 'notice:created', {
    notice: result.notice,
    room: result.room,
    message: result.alertMessage,
  });
  for (const notif of result.notifications) {
    broadcastToUsers([notif.userId], 'notification:new', { notification: notif });
  }

  if (result.notice.isUrgent) {
    const author = store.getUsers().find((u) => u.id === authorId);
    broadcastAll('notification:urgent', {
      notice: result.notice,
      room: result.room,
      authorName: author ? `${author.name} ${author.position}` : '관리자',
      title: `[긴급재난문자] ${result.notice.title}`,
      body: result.notice.content,
      roomId: result.room.id,
      noticeId: result.notice.id,
      createdAt: result.notice.createdAt,
    });
  }

  res.status(201).json({
    notice: result.notice,
    room: result.room,
    message: result.alertMessage,
    notificationsCount: result.notifications.length,
  });
});

app.post('/api/notices/:noticeId/ack', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const result = store.acknowledgeNotice(req.params.noticeId, userId);
  if (result.error || !result.notice) {
    res.status(403).json({ error: result.error ?? '공지 확인 처리 실패' });
    return;
  }
  const targetUserIds =
    result.notice.scope === 'global' || result.notice.pushAllMembers || result.notice.isUrgent
      ? store.getUsers().filter((u) => u.role !== 'bot').map((u) => u.id)
      : result.room?.memberIds ?? [userId];

  broadcastToUsers(targetUserIds, 'notice:updated', {
    notice: result.notice,
    room: result.room,
  });
  res.json({ notice: result.notice, room: result.room });
});

app.patch('/api/notices/:noticeId/pin', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const result = store.toggleNoticePin(req.params.noticeId, userId);
  if (result.error || !result.notice) {
    res.status(403).json({ error: result.error ?? '공지 고정 변경 실패' });
    return;
  }
  const targetUserIds =
    result.notice.scope === 'global' || result.notice.pushAllMembers || result.notice.isUrgent
      ? store.getUsers().filter((u) => u.role !== 'bot').map((u) => u.id)
      : result.room?.memberIds ?? [userId];

  broadcastToUsers(targetUserIds, 'notice:updated', {
    notice: result.notice,
    room: result.room,
  });
  res.json({ notice: result.notice, room: result.room });
});

app.delete('/api/notices/:noticeId', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const result = store.deleteNotice(req.params.noticeId, userId);
  if (result.error || !result.deletedId) {
    res.status(403).json({ error: result.error ?? '공지 삭제 실패' });
    return;
  }
  const targetUserIds = result.room?.memberIds ?? store.getUsers().filter((u) => u.role !== 'bot').map((u) => u.id);
  broadcastToUsers(targetUserIds, 'notice:deleted', {
    noticeId: result.deletedId,
    roomId: result.roomId,
    room: result.room,
  });
  res.json({ ok: true, noticeId: result.deletedId, roomId: result.roomId, room: result.room });
});

app.post('/api/notices/:noticeId/push', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const result = store.pushNoticeUrgentBroadcast(req.params.noticeId, userId);
  if (result.error || !result.notice) {
    res.status(403).json({ error: result.error ?? '긴급 재난문자 전파 실패' });
    return;
  }
  const allUsers = store.getUsers().filter((u) => u.role !== 'bot').map((u) => u.id);
  broadcastToUsers(allUsers, 'notice:updated', {
    notice: result.notice,
    room: result.room,
  });
  for (const notif of result.notifications) {
    broadcastToUsers([notif.userId], 'notification:new', { notification: notif });
  }
  broadcastAll('notification:urgent', {
    notice: result.notice,
    room: result.room,
    authorName: result.actor ? `${result.actor.name} ${result.actor.position}` : '관리자',
    title: `[긴급재난문자] ${result.notice.title}`,
    body: result.notice.content,
    roomId: result.notice.roomId,
    noticeId: result.notice.id,
    createdAt: new Date().toISOString(),
  });
  res.json({
    notice: result.notice,
    room: result.room,
    notificationsCount: result.notifications.length,
  });
});

app.get('/api/leaves', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
  const targetUserId = typeof req.query.userId === 'string' ? req.query.userId.trim() : undefined;
  const from = typeof req.query.from === 'string' ? req.query.from.trim() : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to.trim() : undefined;
  const type = typeof req.query.type === 'string' ? req.query.type.trim() : undefined;

  const result = store.queryLeaves(userId, {
    q,
    userId: targetUserId,
    from,
    to,
    type,
  });
  res.json(result);
});

app.post('/api/leaves', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const { type, startDate, endDate, substituteId, reason } = req.body ?? {};
  const result = store.registerLeave({
    userId,
    type: type as LeaveType,
    startDate: String(startDate ?? ''),
    endDate: String(endDate ?? ''),
    substituteId: substituteId ? String(substituteId) : null,
    reason: String(reason ?? ''),
  });

  if (result.error || !result.leave || !result.updatedUser) {
    res.status(400).json({ error: result.error ?? '연차 등록 실패' });
    return;
  }

  broadcastAll('leave:registered', {
    leave: result.leave,
    user: result.updatedUser,
    linkedMail: result.linkedMail,
    messages: result.messages,
    rooms: result.updatedRooms,
  });

  for (const notif of result.notifications) {
    broadcastToUsers([notif.userId], 'notification:new', { notification: notif });
  }

  res.status(201).json({
    leave: result.leave,
    user: result.updatedUser,
    linkedMail: result.linkedMail,
    notificationsCount: result.notifications.length,
  });
});

// --- SEDMS × SGW Integration Catalog & Bidirectional Webhook ---
app.get('/api/integrations/sedms/catalog', requireAuth, (_req, res) => {
  res.json({ menus: SEDMS_MENU_CATALOG });
});

app.post(
  '/api/integrations/sgw-sedms/webhook',
  webhookLimiter,
  requireWebhookOrUserAuth,
  (req: AuthenticatedRequest, res) => {
    const {
      system,
      menuKey,
      title,
      description,
      actionLabel,
      payload,
      userId,
      email,
      roomId,
      target,
    } = req.body ?? {};

    const resolvedUserId =
      typeof userId === 'string' && userId.trim() ? userId.trim() : req.authUserId;

    const result = store.receiveSgwSedmsWebhook({
      system: system === 'SGW' ? 'SGW' : 'SEDMS',
      menuKey: (menuKey as SedmsMenuKey) || 'dashboard',
      title: String(title ?? ''),
      description: description ? String(description) : undefined,
      actionLabel: actionLabel ? String(actionLabel) : undefined,
      payload:
        payload && typeof payload === 'object' && !Array.isArray(payload)
          ? (payload as Record<string, string>)
          : undefined,
      userId: resolvedUserId,
      email: email ? String(email) : undefined,
      roomId: roomId ? String(roomId) : undefined,
      target: target === 'room' ? 'room' : 'self',
    });

    if (result.error || !result.message || !result.room) {
      res.status(400).json({ error: result.error ?? 'SEDMS/SGW 웹훅 처리 실패' });
      return;
    }

    broadcastToUsers(result.room.memberIds, 'message:created', {
      message: result.message,
      room: result.room,
    });
    if (result.notification) {
      broadcastToUsers([result.notification.userId], 'notification:new', {
        notification: result.notification,
      });
    }

    res.status(201).json({
      ok: true,
      message: result.message,
      room: result.room,
    });
  },
);

// --- External bmail (In-house Outlook) Webhook Integration ---
app.post(
  '/api/bmail/webhook',
  webhookLimiter,
  requireWebhookOrUserAuth,
  (req: AuthenticatedRequest, res) => {
    const {
      senderId,
      senderEmail,
      senderName,
      recipientIds,
      recipientEmails,
      subject,
      preview,
      body,
      category,
      externalMailId,
    } = req.body ?? {};
    const result = store.receiveBmailWebhook({
      senderId: senderId ? String(senderId) : req.authUserId,
      senderEmail: senderEmail ? String(senderEmail) : undefined,
      senderName: senderName ? String(senderName) : undefined,
      recipientIds: Array.isArray(recipientIds) ? recipientIds.map(String) : undefined,
      recipientEmails: Array.isArray(recipientEmails) ? recipientEmails.map(String) : undefined,
      subject: String(subject ?? ''),
      preview: preview ? String(preview) : undefined,
      body: body ? String(body) : undefined,
      category: (category as MailCategory) || '일반',
      externalMailId: externalMailId ? String(externalMailId) : undefined,
    });

    if (result.error || !result.mail) {
      res.status(400).json({ error: result.error ?? 'bmail 웹훅 처리 실패' });
      return;
    }

    const targetAndSender = Array.from(new Set([result.mail.senderId, ...result.mail.recipientIds]));
    broadcastToUsers(targetAndSender, 'mail:received', {
      mail: result.mail,
      message: result.alertMessage,
      room: result.botRoom,
    });

    for (const notif of result.notifications) {
      broadcastToUsers([notif.userId], 'notification:new', { notification: notif });
    }

    res.status(201).json({
      ok: true,
      mailId: result.mail.id,
      notificationsCount: result.notifications.length,
    });
  },
);

app.post('/api/mail/send', requireAuth, async (req: AuthenticatedRequest, res) => {
  const senderId = req.authUserId!;
  const {
    recipientIds,
    subject,
    body,
    category,
    provider,
    nasShare,
    existingAttachmentIds,
    inReplyToMailId,
    syncToRoomId,
  } = req.body ?? {};
  const mailProvider: MailProvider = provider === 'bigmail' ? 'bigmail' : 'bmail';

  const attachments: MailAttachmentItem[] = [];
  if (Array.isArray(existingAttachmentIds)) {
    for (const rawId of existingAttachmentIds) {
      const f = store.getSharedFileById(String(rawId));
      if (f && !f.revoked) {
        attachments.push({
          id: f.id,
          filename: f.filename,
          size: f.size,
          mimeType: f.mimeType,
          downloadUrl: f.url,
          shareUrl: f.shareUrl,
          shareExpiresAt: f.shareExpiresAt,
          isLargeFile: f.isLargeFile,
          isExternalLink: f.isExternalLink,
          shareProvider: f.shareProvider,
          storageLocation: f.storageLocation,
          nasFolder: f.nasFolder,
          nasRelativePath: f.nasRelativePath,
          nasExternalAccessUrl: f.nasExternalAccessUrl,
          hasPasscode: f.hasPasscode,
          maxDownloads: f.maxDownloads,
          downloadCount: f.downloadCount,
          revoked: f.revoked,
        });
      }
    }
  }

  if (nasShare && typeof nasShare === 'object' && String(nasShare.filename ?? '').trim()) {
    const validated = validateNasShareRequest({
      nasFolder: String(nasShare.nasFolder ?? '전사-공유'),
      filename: String(nasShare.filename ?? ''),
      externalNasUrl:
        typeof nasShare.externalNasUrl === 'string' ? nasShare.externalNasUrl : undefined,
      sizeValue: typeof nasShare.sizeValue === 'number' ? nasShare.sizeValue : Number(nasShare.sizeValue || 100),
      sizeUnit:
        nasShare.sizeUnit === 'MB' || nasShare.sizeUnit === 'GB' || nasShare.sizeUnit === 'TB'
          ? nasShare.sizeUnit
          : 'GB',
      expiresDays:
        typeof nasShare.expiresDays === 'number'
          ? nasShare.expiresDays
          : Number(nasShare.expiresDays || 7),
      passcode: typeof nasShare.passcode === 'string' ? nasShare.passcode : undefined,
      maxDownloads:
        nasShare.maxDownloads !== undefined &&
        nasShare.maxDownloads !== null &&
        nasShare.maxDownloads !== ''
          ? Number(nasShare.maxDownloads)
          : undefined,
    });
    if (!validated.ok) {
      res.status(400).json({ error: validated.error });
      return;
    }

    const staged = ensureNasPackageFile({
      targetFolder: validated.nasFolder,
      filename: validated.filename,
      sourceNasRelativePath:
        typeof nasShare.sourceNasRelativePath === 'string'
          ? nasShare.sourceNasRelativePath
          : undefined,
      declaredSizeBytes: validated.sizeBytes,
    });
    if (!staged) {
      res.status(400).json({ error: 'bmail 첨부용 NAS 폴더 복사에 실패했습니다.' });
      return;
    }

    const fileId = `nasmail-${crypto.randomUUID().slice(0, 8)}`;
    const signedShare = signFileShareToken(
      fileId,
      'room-bot',
      validated.expiresDays * 24 * 60 * 60 * 1000,
    );
    const sharePath = `/api/files/shared/${signedShare.token}`;
    const configuredExt = getConfiguredNasExternalBaseUrl();
    const nasExternalAccessUrl =
      validated.externalNasUrl || (configuredExt ? `${configuredExt}${sharePath}` : sharePath);
    const passcodeHash = validated.passcode ? hashSharePasscode(validated.passcode) : undefined;

    const registered = store.registerMailNasAttachment({
      fileId,
      senderId,
      filename: staged.filename,
      sizeBytes: validated.sizeBytes,
      shareUrl: sharePath,
      expiresAt: signedShare.expiresAt,
      passcodeHash,
      maxDownloads: validated.maxDownloads,
      shareProvider: 'nas',
      storageLocation: 'internal-nas',
      nasFolder: staged.folder,
      nasRelativePath: staged.relativePath,
      nasExternalAccessUrl,
      externalUrl: validated.externalNasUrl || `/api/files/${fileId}/download`,
      isExternalLink: Boolean(validated.externalNasUrl),
    });

    attachments.push({
      id: registered.id,
      filename: registered.filename,
      size: registered.size,
      mimeType: registered.mimeType,
      downloadUrl: registered.url,
      shareUrl: registered.shareUrl,
      shareExpiresAt: registered.shareExpiresAt,
      isLargeFile: true,
      isExternalLink: registered.isExternalLink,
      shareProvider: 'nas',
      storageLocation: 'internal-nas',
      nasFolder: registered.nasFolder,
      nasRelativePath: registered.nasRelativePath,
      nasExternalAccessUrl: registered.nasExternalAccessUrl,
      hasPasscode: registered.hasPasscode,
      maxDownloads: registered.maxDownloads,
      downloadCount: 0,
      revoked: false,
    });
  }

  const result = store.sendMail({
    senderId,
    recipientIds: Array.isArray(recipientIds) ? recipientIds.map(String) : [],
    subject: String(subject ?? ''),
    body: String(body ?? ''),
    provider: mailProvider,
    attachments,
    category: (category as MailCategory) || '일반',
    inReplyToMailId: inReplyToMailId ? String(inReplyToMailId) : null,
    syncToRoomId: syncToRoomId ? String(syncToRoomId) : null,
  });

  if (result.error || !result.mail) {
    res.status(400).json({ error: result.error ?? '메일 발송 실패' });
    return;
  }

  const targetAndSender = Array.from(new Set([result.mail.senderId, ...result.mail.recipientIds]));
  broadcastToUsers(targetAndSender, 'mail:received', {
    mail: result.mail,
    message: result.alertMessage,
    room: result.botRoom,
  });

  if (result.syncedRoomMessage && result.syncedRoom) {
    broadcastToUsers(result.syncedRoom.memberIds, 'message:created', {
      message: result.syncedRoomMessage,
      room: result.syncedRoom,
    });
  }

  for (const notif of result.notifications) {
    broadcastToUsers([notif.userId], 'notification:new', { notification: notif });
  }

  let remoteSync: { ok: boolean; remoteMailId?: string; error?: string } | undefined;
  const bridgeStatus = getBmailBridgeConfigStatus();
  if (bridgeStatus.embedSupported) {
    const sender = store.getUsers().find((u) => u.id === senderId);
    const allUsersById = Object.fromEntries(store.getUsers().map((u) => [u.id, u]));
    if (sender) {
      remoteSync = await pushMailToBmailGateway(sender, {
        recipients: result.mail.recipientIds.map((rid) => ({
          sub: rid,
          name: allUsersById[rid]?.name,
        })),
        subject: result.mail.subject,
        body: result.mail.body,
        threadId: result.mail.inReplyToMailId ?? null,
      }).catch(() => undefined);
    }
  }

  res.status(201).json({
    mail: result.mail,
    syncedRoomMessage: result.syncedRoomMessage,
    notificationsCount: result.notifications.length,
    ...(remoteSync ? { remoteSync } : {}),
  });
});

// --- byjay/bmail SGW Gateway & SgwChatBridge Compatibility Routes ---
const handleSgwAuthMe = (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUserId!;
  const user = store.getUsers().find((u) => u.id === userId);
  if (!user) {
    res.status(404).json({ ok: false, error: '사용자를 찾을 수 없습니다.' });
    return;
  }
  res.json({
    ok: true,
    sub: user.id,
    id: user.id,
    name: user.name,
    department: user.department,
    email: user.email,
    role: user.role,
    position: user.position,
    user: { ...user, sub: user.id },
  });
};
app.get('/auth/me', requireAuth, handleSgwAuthMe);
app.get('/api/auth/me', requireAuth, handleSgwAuthMe);

app.get('/api/employees', requireAuth, (_req: AuthenticatedRequest, res) => {
  const employees = store
    .getUsers()
    .filter((u) => u.role !== 'bot')
    .map(buildSgwEmployeeDto);
  res.json({ ok: true, employees });
});

function saveBridgeBase64FileAttachment(
  fileNameRaw: string,
  fileDataRaw: string,
  roomId: string,
): { fileId: string; filename: string; size: number; mimeType: string; isImage: boolean; url: string; shareUrl: string; shareExpiresAt: string; isLargeFile: boolean } | null {
  const safeName = sanitizeNasFilename(fileNameRaw || 'attachment.bin');
  const b64 = fileDataRaw.includes(',') ? fileDataRaw.split(',').pop() || '' : fileDataRaw;
  if (!b64) return null;
  const buf = Buffer.from(b64, 'base64');
  if (buf.length === 0 || buf.length > 5 * 1024 * 1024) return null;

  const fileId = `file-${crypto.randomUUID().slice(0, 8)}`;
  const diskName = `${fileId}-${safeName}`;
  const fullPath = path.resolve(getUploadDir(), diskName);
  if (!isPathInsideDir(fullPath, getUploadDir())) return null;
  fs.writeFileSync(fullPath, buf);
  store.registerUploadedDiskName(fileId, diskName);

  const ext = path.extname(safeName).toLowerCase();
  const mimeType =
    ext === '.png'
      ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.gif'
          ? 'image/gif'
          : ext === '.webp'
            ? 'image/webp'
            : ext === '.pdf'
              ? 'application/pdf'
              : 'application/octet-stream';
  const isImage = isSafeInlineImageMime(mimeType);
  const signedShare = signFileShareToken(fileId, roomId);
  return {
    fileId,
    filename: safeName,
    size: buf.length,
    mimeType,
    isImage,
    url: `/api/files/${fileId}/download`,
    shareUrl: `/api/files/shared/${signedShare.token}`,
    shareExpiresAt: signedShare.expiresAt,
    isLargeFile: buf.length >= 5 * 1024 * 1024,
  };
}

app.get('/api/chat', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const requestedRoomId = typeof req.query.roomId === 'string' ? req.query.roomId.trim() : '';
  const msgIdFilter = typeof req.query.msgId === 'string' ? req.query.msgId.trim() : '';
  const allMessages = store.getMessagesForUser(userId);

  if (requestedRoomId) {
    const room = store.getRoomById(requestedRoomId);
    if (!room || !room.memberIds.includes(userId)) {
      res.status(403).json({ ok: false, error: '채팅방 접근 권한이 없습니다.' });
      return;
    }
    let roomMsgs = allMessages
      .filter((m) => m.roomId === requestedRoomId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    if (msgIdFilter) {
      roomMsgs = roomMsgs.filter((m) => m.id === msgIdFilter);
    }
    const notices = store.getNoticesForUser(userId).filter((n) => n.roomId === requestedRoomId);
    res.json({
      ok: true,
      roomId: requestedRoomId,
      messages: roomMsgs.map((m) =>
        buildSgwChatMessageDto(maskViewOnceMessageForUser(m, userId)),
      ),
      notices,
    });
    return;
  }

  const bootstrap = store.getBootstrap(userId);
  const rooms = (bootstrap?.rooms ?? [])
    .map((room) =>
      buildSgwChatRoomDto(
        room,
        allMessages.filter((m) => m.roomId === room.id),
        userId,
      ),
    )
    .sort((a, b) => b.lastMessageTime - a.lastMessageTime);

  res.json({ ok: true, rooms });
});

app.post('/api/chat', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const action = typeof req.query.action === 'string' ? req.query.action.trim() : '';
  const body = req.body ?? {};

  if (action === 'room') {
    const rawMembers = Array.isArray(body.memberIds)
      ? body.memberIds.map(String)
      : body.targetUserId
        ? [String(body.targetUserId)]
        : [];
    if (rawMembers.length === 0) {
      res.status(400).json({ ok: false, error: '대화 상대를 선택해주세요.' });
      return;
    }
    const created = store.createOrFindRoom({
      creatorId: userId,
      memberIds: rawMembers,
      name: typeof body.name === 'string' ? body.name : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
    });
    if (created.created) {
      broadcastToUsers(created.room.memberIds, 'room:created', { room: created.room });
    }
    const roomMsgs = store.getMessagesForUser(userId).filter((m) => m.roomId === created.room.id);
    res.status(created.created ? 201 : 200).json({
      ok: true,
      room: buildSgwChatRoomDto(created.room, roomMsgs, userId),
    });
    return;
  }

  if (action === 'read') {
    const roomId = String(req.query.roomId ?? body.roomId ?? '').trim();
    const room = store.getRoomById(roomId);
    if (!room || !room.memberIds.includes(userId)) {
      res.status(403).json({ ok: false, error: '채팅방 멤버가 아닙니다.' });
      return;
    }
    const result = store.markRoomRead(roomId, userId);
    if (result.updatedMessageIds.length > 0) {
      broadcastToUsers(room.memberIds, 'room:read', {
        roomId,
        userId,
        messageIds: result.updatedMessageIds,
      });
    }
    res.json({ ok: true, updatedCount: result.updatedMessageIds.length });
    return;
  }

  if (action === 'react') {
    const messageId = String(body.messageId ?? req.query.messageId ?? '').trim();
    const emoji = String(body.emoji ?? '').trim();
    const hasExplicitOn = typeof body.on === 'boolean';
    const updated = hasExplicitOn
      ? store.setReactionExplicit(messageId, emoji, userId, Boolean(body.on))
      : store.toggleReaction(messageId, emoji, userId);
    if (!updated) {
      res.status(404).json({ ok: false, error: '메시지를 찾을 수 없습니다.' });
      return;
    }
    const room = store.getRoomById(updated.roomId);
    if (room) {
      broadcastToUsers(room.memberIds, 'message:updated', { message: updated });
    }
    res.json({ ok: true, message: buildSgwChatMessageDto(updated) });
    return;
  }

  const roomId = String(body.roomId ?? req.query.roomId ?? '').trim();
  const content = String(body.content ?? '').trim();
  const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
  const fileData = typeof body.fileData === 'string' ? body.fileData : '';
  const storedFile =
    fileName && fileData ? saveBridgeBase64FileAttachment(fileName, fileData, roomId) : null;

  const added = store.addMessage({
    roomId,
    senderId: userId,
    type: storedFile ? (storedFile.isImage ? 'image' : 'file') : 'text',
    content: content || (storedFile ? storedFile.filename : ''),
    replyToId: body.replyToId ? String(body.replyToId) : null,
    ...(storedFile
      ? {
          file: {
            id: storedFile.fileId,
            filename: storedFile.filename,
            mimeType: storedFile.mimeType,
            size: storedFile.size,
            url: storedFile.url,
            isImage: storedFile.isImage,
            shareUrl: storedFile.shareUrl,
            shareExpiresAt: storedFile.shareExpiresAt,
            isLargeFile: storedFile.isLargeFile,
            isExternalLink: false,
          },
        }
      : {}),
  });

  if (added.error || !added.message || !added.room) {
    res.status(400).json({ ok: false, error: added.error ?? '메시지 전송 실패' });
    return;
  }
  broadcastToUsers(added.room.memberIds, 'message:created', {
    message: added.message,
    room: added.room,
  });
  res.status(201).json({ ok: true, message: buildSgwChatMessageDto(added.message) });
});

app.get('/api/messages', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const sinceMs = Number(req.query.since || 0) || 0;
  const idFilter = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  const otherId = typeof req.query.otherId === 'string' ? req.query.otherId.trim() : '';

  const usersById: Record<string, User> = Object.fromEntries(
    store.getUsers().map((u) => [u.id, u]),
  );
  const bootstrap = store.getBootstrap(userId);
  const dmRooms = (bootstrap?.rooms ?? []).filter((r) => {
    if (r.type !== 'direct') return false;
    if (otherId && !r.memberIds.includes(otherId)) return false;
    return true;
  });
  const dmRoomsById = new Map(dmRooms.map((r) => [r.id, r]));

  const msgs = store
    .getMessagesForUser(userId)
    .filter((m) => {
      if (!dmRoomsById.has(m.roomId)) return false;
      if (idFilter && m.id !== idFilter) return false;
      if (sinceMs > 0 && new Date(m.createdAt).getTime() <= sinceMs) return false;
      return true;
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((m) =>
      buildSgwDirectMessageDto(
        maskViewOnceMessageForUser(m, userId),
        dmRoomsById.get(m.roomId)!,
        usersById,
      ),
    );

  res.json({ ok: true, messages: msgs, serverNow: Date.now() });
});

app.post('/api/messages', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const action = typeof req.query.action === 'string' ? req.query.action.trim() : '';
  const body = req.body ?? {};

  if (action === 'read') {
    const otherId = String(req.query.otherId ?? body.otherId ?? '').trim();
    if (!otherId) {
      res.status(400).json({ ok: false, error: 'otherId가 필요합니다.' });
      return;
    }
    const found = store.createOrFindRoom({ creatorId: userId, memberIds: [otherId] });
    const resRead = store.markRoomRead(found.room.id, userId);
    if (resRead.updatedMessageIds.length > 0) {
      broadcastToUsers(found.room.memberIds, 'room:read', {
        roomId: found.room.id,
        userId,
        messageIds: resRead.updatedMessageIds,
      });
    }
    res.json({ ok: true, updatedCount: resRead.updatedMessageIds.length });
    return;
  }

  const receiverId = String(body.receiverId ?? body.toUserId ?? '').trim();
  if (!receiverId) {
    res.status(400).json({ ok: false, error: 'receiverId가 필요합니다.' });
    return;
  }
  const dm = store.createOrFindRoom({ creatorId: userId, memberIds: [receiverId] });
  if (dm.created) {
    broadcastToUsers(dm.room.memberIds, 'room:created', { room: dm.room });
  }

  const content = String(body.content ?? '').trim();
  const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
  const fileData = typeof body.fileData === 'string' ? body.fileData : '';
  const storedFile =
    fileName && fileData ? saveBridgeBase64FileAttachment(fileName, fileData, dm.room.id) : null;

  const added = store.addMessage({
    roomId: dm.room.id,
    senderId: userId,
    type: storedFile ? (storedFile.isImage ? 'image' : 'file') : 'text',
    content: content || (storedFile ? storedFile.filename : ''),
    replyToId: body.replyToId ? String(body.replyToId) : null,
    ...(storedFile
      ? {
          file: {
            id: storedFile.fileId,
            filename: storedFile.filename,
            mimeType: storedFile.mimeType,
            size: storedFile.size,
            url: storedFile.url,
            isImage: storedFile.isImage,
            shareUrl: storedFile.shareUrl,
            shareExpiresAt: storedFile.shareExpiresAt,
            isLargeFile: storedFile.isLargeFile,
            isExternalLink: false,
          },
        }
      : {}),
  });

  if (added.error || !added.message || !added.room) {
    res.status(400).json({ ok: false, error: added.error ?? '1:1 메시지 전송 실패' });
    return;
  }

  broadcastToUsers(added.room.memberIds, 'message:created', {
    message: added.message,
    room: added.room,
  });

  const usersById: Record<string, User> = Object.fromEntries(
    store.getUsers().map((u) => [u.id, u]),
  );
  res.status(201).json({
    ok: true,
    message: buildSgwDirectMessageDto(added.message, added.room, usersById),
  });
});

app.get('/api/bmail-ledger', requireAuth, (req: AuthenticatedRequest, res) => {
  const items = store.listBmailLedger({
    project: typeof req.query.project === 'string' ? req.query.project : undefined,
    direction: typeof req.query.direction === 'string' ? req.query.direction : undefined,
    q: typeof req.query.q === 'string' ? req.query.q : undefined,
  });
  res.json({ ok: true, items });
});

app.post('/api/bmail-ledger', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const body = req.body ?? {};
  const action = String(body.action || 'ingest').trim();

  if (action === 'push-to-weekly') {
    const logDate = String(body.log_date || new Date().toISOString().slice(0, 10));
    const pushed = store.pushBmailWeeklyLog(logDate, userId);
    res.json(pushed);
    return;
  }

  const ingested = store.ingestBmailLedger(body.items, userId);
  for (const mail of ingested.createdMails) {
    broadcastToUsers([userId], 'mail:received', { mail });
  }
  for (const notif of ingested.notifications) {
    broadcastToUsers([notif.userId], 'notification:new', { notification: notif });
  }
  res.json({
    ok: true,
    inserted: ingested.inserted,
    touched_dates: ingested.touchedDates,
  });
});

app.get('/api/bmail/bridge/status', requireAuth, (_req: AuthenticatedRequest, res) => {
  res.json({ ok: true, ...getBmailBridgeConfigStatus() });
});

app.post('/api/bmail/bridge/sso-url', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const user = store.getUsers().find((u) => u.id === userId);
  if (!user) {
    res.status(404).json({ ok: false, error: '사용자를 찾을 수 없습니다.' });
    return;
  }
  const launched = createBmailLaunchUrlForUser(user);
  if (!launched.ok) {
    res.status(400).json({ ok: false, error: launched.error });
    return;
  }
  res.json({ ok: true, launchUrl: launched.launchUrl });
});

app.post('/api/bmail/bridge/sync', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const user = store.getUsers().find((u) => u.id === userId);
  if (!user) {
    res.status(404).json({ ok: false, error: '사용자를 찾을 수 없습니다.' });
    return;
  }
  const fetched = await fetchBmailRemoteInbox(user);
  if (!fetched.ok) {
    res.status(400).json({
      ok: false,
      error: fetched.error,
      bridgeStatus: getBmailBridgeConfigStatus(),
    });
    return;
  }
  const added = store.importRemoteBmailItems(fetched.items, userId);
  for (const mail of added) {
    broadcastToUsers([userId], 'mail:received', { mail });
  }
  res.json({
    ok: true,
    importedCount: added.length,
    mails: store.getMailsForUser(userId),
  });
});

app.post('/api/mail/:mailId/attachments/:attId/copy-to-nas', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const mail = store.getMailById(req.params.mailId, userId);
  if (!mail) {
    res.status(404).json({ error: '메일을 찾을 수 없습니다.' });
    return;
  }
  const att = (mail.attachments ?? []).find((a) => a.id === req.params.attId);
  if (!att) {
    res.status(404).json({ error: '메일 첨부 파일을 찾을 수 없습니다.' });
    return;
  }
  const targetFolder = sanitizeNasFolder(String(req.body?.nasFolder ?? '전사-공유'));
  const diskFound = store.getDiskPathForFile(att.id);
  let copiedRel = '';
  let copiedFolder = targetFolder;
  let copiedName = att.filename;
  if (diskFound) {
    const copied = copyExistingFileToNasFolder({
      sourceAbsPath: diskFound.filePath,
      allowedSourceRoots: [getUploadDir(), getNasRootDir()],
      targetFolder,
      targetFilename: att.filename,
    });
    if (copied) {
      copiedRel = copied.relativePath;
      copiedFolder = copied.folder;
      copiedName = copied.filename;
    }
  }
  if (!copiedRel) {
    const staged = ensureNasPackageFile({
      targetFolder,
      filename: att.filename,
      sourceNasRelativePath: att.nasRelativePath,
      declaredSizeBytes: att.size,
    });
    if (!staged) {
      res.status(400).json({ error: 'NAS 폴더 복사에 실패했습니다.' });
      return;
    }
    copiedRel = staged.relativePath;
    copiedFolder = staged.folder;
    copiedName = staged.filename;
  }

  const copyFileId = `nascopy-${crypto.randomUUID().slice(0, 8)}`;
  const signedShare = signFileShareToken(copyFileId, 'room-bot');
  const shareUrl = `/api/files/shared/${signedShare.token}`;
  const configuredExt = getConfiguredNasExternalBaseUrl();
  const nasExternalAccessUrl = configuredExt ? `${configuredExt}${shareUrl}` : shareUrl;

  const copiedRecord = store.registerMailNasAttachment({
    fileId: copyFileId,
    senderId: userId,
    filename: copiedName,
    sizeBytes: att.size,
    shareUrl,
    expiresAt: signedShare.expiresAt,
    shareProvider: 'nas',
    storageLocation: 'internal-nas',
    nasFolder: copiedFolder,
    nasRelativePath: copiedRel,
    nasExternalAccessUrl,
    externalUrl: `/api/files/${copyFileId}/download`,
    isExternalLink: false,
  });

  res.status(201).json({
    ok: true,
    nasFolder: copiedFolder,
    nasRelativePath: copiedRel,
    shareUrl,
    nasExternalAccessUrl,
    file: copiedRecord,
  });
});

app.patch('/api/mail/:mailId/read', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const mail = store.markMailRead(req.params.mailId, userId);
  if (!mail) {
    res.status(404).json({ error: '메일을 찾을 수 없습니다.' });
    return;
  }
  broadcastToUsers([userId], 'mail:updated', { mail });
  res.json({ mail });
});

app.patch('/api/notifications/:id/read', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const notif = store.markNotificationRead(req.params.id, userId);
  if (!notif) {
    res.status(404).json({ error: '알림을 찾을 수 없습니다.' });
    return;
  }
  broadcastToUsers([userId], 'notification:updated', { notification: notif });
  res.json({ notification: notif });
});

app.post('/api/notifications/read-all', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  store.markAllNotificationsRead(userId);
  broadcastToUsers([userId], 'notification:read_all', { userId });
  res.json({ ok: true });
});

// --- Kakao Developers Free APIs & Autonomous SGW EGO Agent ---
app.get('/api/ego/status', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json(getKakaoFreeApiStatusForUser(req.authUserId!));
});

app.post('/api/ego/run', requireAuth, egoLimiter, async (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const goal = String(req.body?.goal ?? '');
  const recordInSelfChat = req.body?.recordInSelfChat !== false;

  const outcome = await runAutonomousEgoAgent({
    userId,
    goal,
    recordInSelfChat,
  });

  if (!outcome.ok) {
    res.status(outcome.statusCode).json({ error: outcome.error });
    return;
  }

  if (outcome.result.selfRoomMessage) {
    broadcastToUsers([userId], 'message:created', {
      message: outcome.result.selfRoomMessage,
    });
  }

  res.json(outcome.result);
});

app.post('/api/kakao/search', requireAuth, egoLimiter, async (req, res) => {
  const mode = String(req.body?.mode ?? 'local');
  const query = String(req.body?.query ?? '');
  const size = typeof req.body?.size === 'number' ? req.body.size : 5;

  if (mode === 'web' || mode === 'blog' || mode === 'book') {
    const out = await searchKakaoDaum(query, mode, size);
    res.json(out);
    return;
  }

  const out = await searchKakaoLocalPlaces(query, size);
  res.json(out);
});

// --- Voice STT + AI Analysis, Chat Quick Translate/Summary, Scheduled Send ---
app.post('/api/voice/analyze', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const { audioDataUrl, mimeType, transcript, durationSec, messageId } = req.body ?? {};
  const result = await analyzeVoicePayload({
    audioDataUrl: typeof audioDataUrl === 'string' ? audioDataUrl : undefined,
    mimeType: typeof mimeType === 'string' ? mimeType : undefined,
    transcript: typeof transcript === 'string' ? transcript : undefined,
    durationSec: typeof durationSec === 'number' ? durationSec : undefined,
  });

  let updatedMessage = null;
  if (typeof messageId === 'string' && messageId.trim()) {
    const existing = store.getMessageById(messageId.trim());
    const room = existing ? store.getRoomById(existing.roomId) : undefined;
    if (existing && room && room.memberIds.includes(userId)) {
      updatedMessage = store.updateMessageVoiceAnalysis(existing.id, {
        transcript: result.transcript,
        analysis: result.analysis,
      });
      if (updatedMessage) {
        broadcastToUsers(room.memberIds, 'message:updated', { message: updatedMessage });
      }
    }
  }

  res.json({
    transcript: result.transcript,
    analysis: result.analysis,
    sttUsed: result.sttUsed,
    ...(updatedMessage ? { message: updatedMessage } : {}),
  });
});

app.post('/api/messages/:messageId/analyze', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const msg = store.getMessageById(req.params.messageId);
  if (!msg) {
    res.status(404).json({ error: '메시지를 찾을 수 없습니다.' });
    return;
  }
  const room = store.getRoomById(msg.roomId);
  if (!room || !room.memberIds.includes(userId)) {
    res.status(403).json({ error: '채팅방 멤버만 메시지를 분석할 수 있습니다.' });
    return;
  }
  const mode = req.body?.mode === 'translate' ? 'translate' : 'summary';
  const sourceText =
    msg.type === 'voice'
      ? msg.voice?.transcript || msg.content
      : msg.content;
  const out = await analyzeChatMessageQuick({ content: sourceText, mode });
  res.json({ messageId: msg.id, ...out });
});

app.post('/api/rooms/:roomId/summarize', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const room = store.getRoomById(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: '채팅방을 찾을 수 없습니다.' });
    return;
  }
  if (!room.memberIds.includes(userId)) {
    res.status(403).json({ error: '채팅방 멤버만 대화를 요약할 수 있습니다.' });
    return;
  }
  const roomMessages = store.getMessagesForUser(userId).filter((m) => m.roomId === room.id);
  const usersById = Object.fromEntries(store.getUsers().map((u) => [u.id, u]));
  const result = summarizeRoomMessagesPure(room.name, roomMessages, usersById);
  res.json({ roomId: room.id, ...result });
});

app.get('/api/rooms/:roomId/scheduled', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const items = store.getScheduledMessagesForUser(userId, req.params.roomId);
  res.json({ scheduledMessages: items });
});

app.post('/api/rooms/:roomId/scheduled', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const { content, scheduledAt } = req.body ?? {};
  const result = store.addScheduledMessage({
    roomId: req.params.roomId,
    senderId: userId,
    content: String(content ?? ''),
    scheduledAt: String(scheduledAt ?? ''),
  });
  if (result.error || !result.item) {
    res.status(400).json({ error: result.error ?? '예약 전송 등록 실패' });
    return;
  }
  broadcastToUsers([userId], 'scheduled:updated', {
    scheduledMessages: store.getScheduledMessagesForUser(userId),
  });
  res.status(201).json({ scheduledMessage: result.item });
});

app.delete('/api/scheduled/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const cancelled = store.cancelScheduledMessage(req.params.id, userId);
  if (!cancelled) {
    res.status(404).json({ error: '예약 전송 항목을 찾을 수 없습니다.' });
    return;
  }
  broadcastToUsers([userId], 'scheduled:updated', {
    scheduledMessages: store.getScheduledMessagesForUser(userId),
  });
  res.json({ ok: true, id: cancelled.id });
});

// --- Scoped Notices (Global Work / Personal), BigMail & BMail Simulation/Summary, and SGW Voice Assistant ---
app.post('/api/notices/scoped', requireAuth, (req: AuthenticatedRequest, res) => {
  const authorId = req.authUserId!;
  const scope = req.body?.scope === 'personal' ? 'personal' : 'global';
  const title = String(req.body?.title ?? '');
  const content = String(req.body?.content ?? '');
  const priority = normalizeNoticePriority({
    priority: req.body?.priority,
    isUrgent: req.body?.isUrgent,
  });
  const isUrgent = Boolean(req.body?.isUrgent || priority === 'urgent');
  const pushAllMembers = Boolean(req.body?.pushAllMembers || isUrgent);

  const result = store.createScopedNotice({
    scope,
    authorId,
    title,
    content,
    pinned: req.body?.pinned !== false,
    priority,
    isUrgent,
    pushAllMembers,
  });

  if (result.error || !result.notice) {
    res.status(400).json({ error: result.error ?? '공지 등록 실패' });
    return;
  }

  broadcastToUsers(result.targetUserIds, 'notice:created', {
    notice: result.notice,
    room: result.room,
    message: result.alertMessage,
  });
  for (const notif of result.notifications) {
    broadcastToUsers([notif.userId], 'notification:new', { notification: notif });
  }
  if (result.notice.isUrgent) {
    const author = store.getUsers().find((u) => u.id === authorId);
    broadcastAll('notification:urgent', {
      notice: result.notice,
      room: result.room,
      authorName: author ? `${author.name} ${author.position}` : '관리자',
      title: `[긴급재난문자] ${result.notice.title}`,
      body: result.notice.content,
      roomId: result.room?.id ?? result.notice.roomId,
      noticeId: result.notice.id,
      createdAt: result.notice.createdAt,
    });
  }
  res.status(201).json({
    notice: result.notice,
    room: result.room,
    message: result.alertMessage,
    notificationsCount: result.notifications.length,
  });
});

app.post('/api/mail/simulate-incoming', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const provider: MailProvider = req.body?.provider === 'bigmail' ? 'bigmail' : 'bmail';
  const defaultSubject =
    provider === 'bigmail'
      ? `[빅메일] 대용량 릴리즈 패키지 및 QA 리포트 송부 (${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })})`
      : `[비메일] 긴급 협업 리뷰 및 일정 조율 요청 (${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })})`;
  const defaultBody =
    provider === 'bigmail'
      ? '안녕하세요, 대용량 배포 산출물(빌드 아카이브 및 통합 테스트 리포트)을 빅메일로 발송합니다.\n핵심 변경사항 요약과 첨부 파일 2건을 메일앱에서 상세히 확인 후 회신 부탁드립니다.'
      : '안녕하세요, 금일 오후 리뷰 회의 전까지 API 스펙 변경사항 확인 및 회신 부탁드립니다.\n상세 내용은 비메일 첨부 문서를 참고해 주세요.';

  const attachments =
    provider === 'bigmail'
      ? [
          {
            id: `att-${crypto.randomUUID().slice(0, 6)}`,
            filename: 'SGW_릴리즈_빌드_v4.zip',
            size: 92_274_688,
            mimeType: 'application/zip',
            downloadUrl: '/api/files/file-guide-01/download',
          },
          {
            id: `att-${crypto.randomUUID().slice(0, 6)}`,
            filename: '통합_QA_체크리스트.pdf',
            size: 6_815_744,
            mimeType: 'application/pdf',
            downloadUrl: '/api/files/file-guide-01/download',
          },
        ]
      : [
          {
            id: `att-${crypto.randomUUID().slice(0, 6)}`,
            filename: 'API_변경안_메모.txt',
            size: 64_512,
            mimeType: 'text/plain',
            downloadUrl: '/api/files/file-guide-01/download',
          },
        ];

  const result = store.simulateOrReceiveMail({
    provider,
    senderId: typeof req.body?.senderId === 'string' ? req.body.senderId : 'u-seoyeon',
    recipientIds: [userId],
    subject: String(req.body?.subject ?? '').trim() || defaultSubject,
    body: String(req.body?.body ?? '').trim() || defaultBody,
    attachments,
    category: '일반',
  });

  if (result.error || !result.mail) {
    res.status(400).json({ error: result.error ?? '메일 수신 시뮬레이션 실패' });
    return;
  }

  broadcastToUsers([userId, result.mail.senderId], 'mail:received', {
    mail: result.mail,
    message: result.alertMessage,
    room: result.botRoom,
  });
  for (const notif of result.notifications) {
    broadcastToUsers([notif.userId], 'notification:new', { notification: notif });
  }

  res.status(201).json({ mail: result.mail, notifications: result.notifications });
});

app.post('/api/mail/:mailId/summarize', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const mail = store.getMailById(req.params.mailId, userId);
  if (!mail) {
    res.status(404).json({ error: '메일을 찾을 수 없습니다.' });
    return;
  }
  const users = store.getUsers();
  const sender = users.find((u) => u.id === mail.senderId);
  const senderName = sender ? `${sender.name} ${sender.position}` : '사내 임직원';
  const digest = buildConciseMailDigest(mail, senderName);
  const summary = await summarizeMailContent({ mail, senderName });

  res.json({
    mailId: mail.id,
    digest,
    bullets: summary.bullets,
    engine: summary.engine,
  });
});

app.post('/api/control-tower/command', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId!;
  const commandText = String(req.body?.command ?? '').trim();
  if (!commandText) {
    res.status(400).json({ error: '음성 또는 텍스트 명령을 입력해 주세요.' });
    return;
  }

  const users = store.getUsers();
  const currentUser = users.find((u) => u.id === userId);
  const intent = parseControlTowerCommand(commandText, new Date().toISOString().slice(0, 10));
  const mails = store.getMailsForUser(userId);
  const notices = store.getNoticesForUser(userId);
  const notifications = store.getNotificationsForUser(userId);

  const senderNameOf = (uid: string) => {
    const u = users.find((x) => x.id === uid);
    return u ? `${u.name} ${u.position}` : '임직원';
  };

  if (intent.kind === 'mail_summarize' || intent.kind === 'mail_open' || intent.kind === 'mail_list') {
    const filteredMails = intent.provider
      ? mails.filter((m) => (m.provider ?? 'bmail') === intent.provider)
      : mails;
    const targetMail = filteredMails[0] ?? mails[0];
    if (!targetMail) {
      res.json({
        intent: intent.kind,
        spokenReply: '수신된 빅메일이나 비메일이 아직 없습니다.',
        cards: [],
        suggestedActions: ['새 빅메일 수신 테스트', '전체 업무 공지 보기'],
      });
      return;
    }
    const digest = buildConciseMailDigest(targetMail, senderNameOf(targetMail.senderId));
    const summarized = await summarizeMailContent({
      mail: targetMail,
      senderName: senderNameOf(targetMail.senderId),
    });

    const isOpen = intent.kind === 'mail_open';
    const spokenReply = isOpen
      ? `${digest.providerLabel} 메일을 상세히 열어드립니다. 발신자 ${digest.senderName}, 제목은 "${digest.subject}", 첨부는 ${digest.attachmentLabel}입니다.`
      : `최근 ${digest.providerLabel} 브리핑입니다. ${digest.senderName}님이 보낸 "${digest.subject}" 메일이 도착했고, 핵심 요약은 ${digest.shortSummary}, 첨부는 ${digest.attachmentLabel}입니다.`;

    res.json({
      intent: intent.kind,
      spokenReply,
      openedMailId: isOpen ? targetMail.id : undefined,
      cards: filteredMails.slice(0, 3).map((m) => {
        const d = buildConciseMailDigest(m, senderNameOf(m.senderId));
        return {
          kind: 'mail',
          id: m.id,
          title: d.alertTitle,
          subtitle: d.alertBody,
          bullets: m.id === targetMail.id ? summarized.bullets : undefined,
          actionLabel: '상세히 보기 (이메일 앱)',
          mailId: m.id,
        };
      }),
      suggestedActions: ['상세히 보기 (이메일 앱)', '전체 알람 브리핑', '개인 공지로 저장'],
    });
    return;
  }

  if (intent.kind === 'notice_create_global' || intent.kind === 'notice_create_personal') {
    const scope = intent.kind === 'notice_create_personal' ? 'personal' : 'global';
    const created = store.createScopedNotice({
      scope,
      authorId: userId,
      title: intent.title,
      content: intent.content,
      pinned: true,
    });
    if (created.notice) {
      broadcastToUsers(created.targetUserIds, 'notice:created', {
        notice: created.notice,
        room: created.room,
        message: created.alertMessage,
      });
      for (const notif of created.notifications) {
        broadcastToUsers([notif.userId], 'notification:new', { notification: notif });
      }
    }
    const label = scope === 'global' ? '전체 업무 공지' : '개인 공지';
    res.json({
      intent: intent.kind,
      spokenReply: `${label}가 등록되었습니다. 내용: ${intent.content}`,
      createdNotice: created.notice,
      cards: created.notice
        ? [
            {
              kind: 'notice',
              id: created.notice.id,
              title: created.notice.title,
              subtitle: created.notice.content,
              actionLabel: scope === 'global' ? '전사 공지방 보기' : '나와의 채팅 보기',
              roomId: created.room?.id,
            },
          ]
        : [],
      suggestedActions: ['전체 업무 공지 목록', '개인 공지 목록', '전체 알람 브리핑'],
    });
    return;
  }

  if (intent.kind === 'notice_list') {
    const scoped = filterNoticesByScope(notices, userId, intent.scope);
    const label = intent.scope === 'personal' ? '개인 공지사항' : '전체 업무 공지사항';
    res.json({
      intent: intent.kind,
      spokenReply:
        scoped.length > 0
          ? `${label} ${scoped.length}건이 있습니다. 가장 최근 공지는 "${scoped[0].title}"입니다.`
          : `등록된 ${label}이 없습니다.`,
      cards: scoped.slice(0, 4).map((n) => ({
        kind: 'notice',
        id: n.id,
        title: n.title,
        subtitle: n.content,
        roomId: n.roomId,
        actionLabel: '채팅방에서 보기',
      })),
      suggestedActions: ['개인 공지 등록: 오늘 5시 코드리뷰', '전체 알람 브리핑'],
    });
    return;
  }

  if (intent.kind === 'alerts_briefing') {
    const unreadNotifs = notifications.filter((n) => !n.read);
    const unreadMails = mails.filter((m) => !m.readByUserIds.includes(userId));
    const globalNotices = filterNoticesByScope(notices, userId, 'global');
    const personalNotices = filterNoticesByScope(notices, userId, 'personal');

    const latestMail = unreadMails[0] ?? mails[0];
    const latestMailDigest = latestMail
      ? buildConciseMailDigest(latestMail, senderNameOf(latestMail.senderId))
      : null;

    const spokenReply = [
      `SGW 통합 브리핑입니다.`,
      `미확인 알람 ${unreadNotifs.length}건, 미확인 메일 ${unreadMails.length}건, 전체 업무 공지 ${globalNotices.length}건, 개인 공지 ${personalNotices.length}건이 있습니다.`,
      latestMailDigest
        ? `최신 메일은 ${latestMailDigest.providerLabel}로 온 "${latestMailDigest.subject}"이며, ${latestMailDigest.attachmentLabel} 상태입니다.`
        : '',
    ]
      .filter(Boolean)
      .join(' ');

    res.json({
      intent: intent.kind,
      spokenReply,
      cards: [
        ...unreadNotifs.slice(0, 4).map((n) => ({
          kind: n.type === 'mail' ? 'mail' : n.type === 'notice' ? 'notice' : 'alert',
          id: n.id,
          title: n.title,
          subtitle: n.body,
          mailId: n.mailId ?? undefined,
          roomId: n.roomId ?? undefined,
          actionLabel: n.mailId ? '상세히 보기 (이메일 앱)' : '해당 방 열기',
        })),
      ],
      suggestedActions: ['최근 빅메일 요약해줘', '전체 업무 공지 보여줘', '미확인 채팅 알려줘'],
    });
    return;
  }

  if (intent.kind === 'chat_briefing') {
    const msgs = store.getMessagesForUser(userId);
    const unreadMsgs = msgs.filter(
      (m) => m.senderId !== userId && m.type !== 'system' && !m.readBy.includes(userId),
    );
    const bootstrap = store.getBootstrap(userId);
    const roomsById = new Map((bootstrap?.rooms ?? []).map((r) => [r.id, r]));

    res.json({
      intent: intent.kind,
      spokenReply:
        unreadMsgs.length > 0
          ? `읽지 않은 채팅 메시지가 총 ${unreadMsgs.length}건 있습니다. 가장 최근 메시지는 ${senderNameOf(unreadMsgs[unreadMsgs.length - 1].senderId)}님의 "${unreadMsgs[unreadMsgs.length - 1].content.slice(0, 50)}"입니다.`
          : '모든 채팅방 메시지를 확인하셨습니다.',
      cards: unreadMsgs
        .slice(-4)
        .reverse()
        .map((m) => ({
          kind: 'chat',
          id: m.id,
          title: `${roomsById.get(m.roomId)?.name ?? '대화방'} · ${senderNameOf(m.senderId)}`,
          subtitle: m.content.slice(0, 100),
          roomId: m.roomId,
          actionLabel: '대화방 이동',
        })),
      suggestedActions: ['전사 공지방 열기', '최근 빅메일 요약해줘'],
    });
    return;
  }

  if (intent.kind === 'large_link_open') {
    res.json({
      intent: intent.kind,
      spokenReply: '현재 대화방의 대용량 파일 및 보안 링크 공유 패널을 열어드립니다. 최대 500MB 분할 업로드 또는 100GB 단위 외부 공유 링크 전송이 가능합니다.',
      uiAction: 'open_large_link',
      cards: [],
      suggestedActions: ['전체 알람 브리핑', '최근 빅메일 요약해줘'],
    });
    return;
  }

  if (intent.kind === 'leave_info' && currentUser) {
    const remaining = Number((currentUser.totalLeaveDays - currentUser.usedLeaveDays).toFixed(1));
    res.json({
      intent: intent.kind,
      spokenReply: `${currentUser.name} ${currentUser.position}님의 총 연차는 ${currentUser.totalLeaveDays}일, 사용 ${currentUser.usedLeaveDays}일, 잔여 연차는 ${remaining}일입니다.`,
      uiAction: 'open_leave',
      cards: [
        {
          kind: 'leave',
          id: 'leave-balance-card',
          title: `잔여 연차 ${remaining}일 / 총 ${currentUser.totalLeaveDays}일`,
          subtitle: '내 연차 정보 및 과거 기록 차트에서 월별 사용 내역을 확인할 수 있습니다.',
          actionLabel: '내 연차 화면 열기',
        },
      ],
      suggestedActions: ['내일 오전반차 신청해줘', '전체 알람 브리핑'],
    });
    return;
  }

  // Fallback / SEDMS / Kakao Free APIs -> delegate to autonomous SGW EGO Agent
  const egoOut = await runAutonomousEgoAgent({
    userId,
    goal: commandText,
    recordInSelfChat: false,
  });

  if (!egoOut.ok) {
    res.json({
      intent: 'general_briefing',
      spokenReply: `요청하신 "${commandText}" 명령을 처리했습니다.`,
      cards: [],
      suggestedActions: ['최근 빅메일 요약해줘', '전체 알람 브리핑'],
    });
    return;
  }

  res.json({
    intent: intent.kind,
    spokenReply: egoOut.result.finalAnswer,
    cards: egoOut.result.integrationActions.map((act, idx) => ({
      kind: 'sedms',
      id: `sedms-${idx}`,
      title: `${act.system} · ${act.title}`,
      subtitle: act.description,
      menuKey: act.menuKey,
      actionLabel: act.actionLabel,
    })),
    suggestedActions: egoOut.result.nextSuggestions,
  });
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: '요청하신 API 엔드포인트를 찾을 수 없습니다.' });
});

// Centralized JSON error handler (Multer file-size/limit errors, malformed JSON body, unexpected exceptions)
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  if (err instanceof multer.MulterError) {
    const msg =
      err.code === 'LIMIT_FILE_SIZE'
        ? '업로드 허용 용량(20MB)을 초과했습니다. 20MB 초과 파일은 분할 업로드 또는 NAS 대용량 링크를 이용해 주세요.'
        : `파일 업로드 오류 (${err.code})`;
    res.status(400).json({ error: msg });
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: '잘못된 JSON 요청 형식입니다.' });
    return;
  }
  if (req.path.startsWith('/api')) {
    res.status(500).json({ error: '서버 내부 요청 처리 중 오류가 발생했습니다.' });
    return;
  }
  res.status(500).send('Internal Server Error');
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/mobile.html', (_req, res) => {
      res.sendFile(path.join(distDir, 'mobile.html'));
    });
    app.get('/extension.html', (_req, res) => {
      res.sendFile(path.join(distDir, 'extension.html'));
    });
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  // Deliver due scheduled messages every 5 seconds
  setInterval(() => {
    const delivered = store.collectDueScheduledMessages(Date.now());
    for (const item of delivered) {
      broadcastToUsers(item.room.memberIds, 'message:created', {
        message: item.message,
        room: item.room,
      });
      broadcastToUsers([item.scheduledItem.senderId], 'scheduled:updated', {
        scheduledMessages: store.getScheduledMessagesForUser(item.scheduledItem.senderId),
      });
    }
  }, 5000);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`SG Talk Server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
