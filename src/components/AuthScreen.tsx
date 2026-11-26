import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  LogIn,
  MailCheck,
  MessageCircle,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import type { AuthPublicConfig, User } from '../types/client';

interface AuthScreenProps {
  onAuthenticated: (payload: { user: User; token: string; fileToken: string }) => void;
  onQuickTestEnter?: () => void;
}

const DEPARTMENTS = [
  '프로덕트 개발팀',
  'UX 디자인팀',
  '경영지원·HR팀',
  '그로스 마케팅팀',
  '영업·파트너십팀',
];

const POSITIONS = ['사원', '선임', '매니저', '팀장', '실장'];

export function AuthScreen({ onAuthenticated, onQuickTestEnter }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [portalConfig, setPortalConfig] = useState<AuthPublicConfig | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [department, setDepartment] = useState(DEPARTMENTS[0]);
  const [position, setPosition] = useState(POSITIONS[2]);
  const [phone, setPhone] = useState('');

  // ① Kakao identity verification state
  const [kakaoToken, setKakaoToken] = useState<string | null>(null);
  const [kakaoProfile, setKakaoProfile] = useState<{
    kakaoId: string;
    nickname: string;
    sandbox: boolean;
  } | null>(null);
  const [kakaoCallbackHint, setKakaoCallbackHint] = useState<string | null>(null);
  const [kakaoPopupFallbackUrl, setKakaoPopupFallbackUrl] = useState<string | null>(null);
  const [kakaoLoading, setKakaoLoading] = useState(false);

  // ② Company email 6-digit security code state
  const [emailCodeInput, setEmailCodeInput] = useState('');
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [emailPreviewCode, setEmailPreviewCode] = useState<string | null>(null);
  const [emailVerifiedToken, setEmailVerifiedToken] = useState<string | null>(null);
  const [emailVerifiedFor, setEmailVerifiedFor] = useState<string>('');
  const [emailCodeLoading, setEmailCodeLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/auth/config')
      .then((res) => res.json())
      .then((data: AuthPublicConfig) => {
        if (data && data.companyDomain) {
          setPortalConfig(data);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handleKakaoPopupMessage = (evt: MessageEvent) => {
      if (evt.origin !== window.location.origin) return;
      const data = evt.data as {
        type?: string;
        kakaoVerificationToken?: string;
        kakaoProfile?: { kakaoId: string; nickname: string; sandbox: boolean };
        error?: string;
      } | null;
      if (!data) return;
      if (data.type === 'KAKAO_AUTH_SUCCESS' && data.kakaoVerificationToken && data.kakaoProfile) {
        setKakaoToken(data.kakaoVerificationToken);
        setKakaoProfile(data.kakaoProfile);
        setKakaoPopupFallbackUrl(null);
        setKakaoLoading(false);
        setError(null);
      } else if (data.type === 'KAKAO_AUTH_ERROR') {
        setError(data.error || '카카오 본인인증에 실패했습니다.');
        setKakaoLoading(false);
      }
    };

    window.addEventListener('message', handleKakaoPopupMessage);
    return () => window.removeEventListener('message', handleKakaoPopupMessage);
  }, []);

  const normalizedEmail = email.trim().toLowerCase();
  const isEmailVerified = Boolean(emailVerifiedToken && emailVerifiedFor === normalizedEmail);

  const handleEmailChange = (nextEmail: string) => {
    setEmail(nextEmail);
    if (nextEmail.trim().toLowerCase() !== emailVerifiedFor) {
      setEmailVerifiedToken(null);
      setEmailVerifiedFor('');
      setEmailCodeSent(false);
      setEmailPreviewCode(null);
      setEmailCodeInput('');
    }
  };

  const handleVerifyKakao = async () => {
    setError(null);
    setKakaoLoading(true);
    try {
      const res = await fetch('/api/auth/kakao/url');
      const data = (await res.json()) as {
        configured?: boolean;
        url?: string;
        state?: string;
        callbackUrl?: string;
      };
      if (data.configured && data.url) {
        setKakaoPopupFallbackUrl(null);
        const popup = window.open(
          data.url,
          'kakao_identity_auth',
          'width=480,height=680,menubar=no,toolbar=no',
        );
        if (!popup) {
          setKakaoPopupFallbackUrl(data.url);
          setError('카카오 인증 팝업이 차단되었습니다. 아래 새 탭 버튼을 눌러 인증을 진행하세요.');
          setKakaoLoading(false);
        }
        return;
      }

      // Non-production preview fallback when KAKAO_CLIENT_ID is not yet configured in Secrets
      if (data.callbackUrl) {
        setKakaoCallbackHint(data.callbackUrl);
      }
      const sandboxRes = await fetch('/api/auth/kakao/sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: data.state,
          nickname: mode === 'register' && name.trim() ? name.trim() : undefined,
        }),
      });
      const sandboxData = await sandboxRes.json();
      if (!sandboxRes.ok) {
        setError(sandboxData.error || '카카오 본인인증 처리에 실패했습니다.');
      } else {
        setKakaoToken(sandboxData.kakaoVerificationToken);
        setKakaoProfile(sandboxData.kakaoProfile);
      }
    } catch {
      setError('카카오 본인인증 서버와 통신할 수 없습니다.');
    } finally {
      setKakaoLoading(false);
    }
  };

  const handleSendEmailCode = async () => {
    setError(null);
    if (!normalizedEmail) {
      setError('먼저 SGW 회사 이메일을 입력해주세요.');
      return;
    }
    setEmailCodeLoading(true);
    try {
      const res = await fetch('/api/auth/email-code/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '보안코드 발송에 실패했습니다.');
      } else {
        setEmailCodeSent(true);
        setEmailPreviewCode(data.previewCode ?? null);
        setEmailVerifiedToken(null);
        setEmailVerifiedFor('');
      }
    } catch {
      setError('이메일 보안코드 발송 요청 중 오류가 발생했습니다.');
    } finally {
      setEmailCodeLoading(false);
    }
  };

  const handleVerifyEmailCode = async () => {
    setError(null);
    if (!emailCodeInput.trim()) {
      setError('수신한 6자리 보안코드를 입력해주세요.');
      return;
    }
    setEmailCodeLoading(true);
    try {
      const res = await fetch('/api/auth/email-code/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, code: emailCodeInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '보안코드 인증에 실패했습니다.');
      } else if (data.emailVerificationToken) {
        setEmailVerifiedToken(data.emailVerificationToken);
        setEmailVerifiedFor(normalizedEmail);
        setEmailPreviewCode(null);
      }
    } catch {
      setError('보안코드 검증 중 오류가 발생했습니다.');
    } finally {
      setEmailCodeLoading(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!kakaoToken) {
      setError('① 카카오 본인인증을 먼저 완료해주세요.');
      return;
    }
    if (!isEmailVerified || !emailVerifiedToken) {
      setError('② 회사 이메일 6자리 보안코드 인증을 완료해주세요.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: normalizedEmail,
          password,
          kakaoVerificationToken: kakaoToken,
          emailVerificationToken: emailVerifiedToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '로그인에 실패했습니다.');
      } else if (data.user && data.token && data.fileToken) {
        onAuthenticated({ user: data.user, token: data.token, fileToken: data.fileToken });
      }
    } catch {
      setError('서버와 연결할 수 없습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !normalizedEmail || !password.trim()) {
      setError('이름, 회사 이메일, 비밀번호를 모두 입력해주세요.');
      return;
    }
    if (!kakaoToken) {
      setError('① 카카오 본인인증을 먼저 완료해주세요.');
      return;
    }
    if (!isEmailVerified || !emailVerifiedToken) {
      setError('② 회사 이메일 6자리 보안코드 인증을 완료해주세요.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email: normalizedEmail,
          department,
          position,
          phone,
          password,
          kakaoVerificationToken: kakaoToken,
          emailVerificationToken: emailVerifiedToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '사원 가입에 실패했습니다.');
      } else if (data.user && data.token && data.fileToken) {
        onAuthenticated({ user: data.user, token: data.token, fileToken: data.fileToken });
      }
    } catch {
      setError('서버와 연결할 수 없습니다.');
    } finally {
      setLoading(false);
    }
  };

  const securityReady = Boolean(kakaoToken && isEmailVerified);

  return (
    <div className="min-h-screen w-full bg-neutral-100 dark:bg-neutral-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl overflow-hidden shadow-sm p-6 md:p-7">
        {/* Compact Brand Header */}
        <div className="flex items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-[#FEE500] text-[#1C2924] flex items-center justify-center shadow-xs shrink-0">
              <MessageCircle className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-bold tracking-tight text-neutral-900 dark:text-white truncate">
                {portalConfig?.companyAssetName || 'SG Talk'}
              </h1>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                사내 계정 본인인증 로그인
              </p>
            </div>
          </div>

          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#008069] dark:text-[#07C160] shrink-0">
            <ShieldCheck className="h-4 w-4" />
            <span>2단계 보안</span>
          </span>
        </div>

        {/* Mode Switch */}
        <div className="flex items-center gap-1 p-1 bg-neutral-100 dark:bg-neutral-800 rounded-xl w-full mb-4">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setError(null);
            }}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              mode === 'login'
                ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-sm'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
            }`}
          >
            회사 계정 로그인
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setError(null);
            }}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              mode === 'register'
                ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-sm'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
            }`}
          >
            신규 사원 가입
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-4 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-sm text-red-700 dark:text-red-300"
          >
            {error}
          </div>
        )}

          {/* Mandatory Step 1: Kakao Identity Verification */}
          <div className="mb-4 p-3.5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-800/40 space-y-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <span className="h-5 w-5 rounded-full bg-[#FEE500] text-[#1C2924] text-[11px] font-bold flex items-center justify-center shrink-0">
                  1
                </span>
                <span className="text-xs font-bold text-neutral-900 dark:text-white whitespace-nowrap">
                  카카오 본인인증 (필수)
                </span>
              </div>
              {kakaoProfile ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-[#008069] dark:text-[#07C160] whitespace-nowrap">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>
                    {kakaoProfile.nickname} {kakaoProfile.sandbox ? '(프리뷰)' : '인증됨'}
                  </span>
                </span>
              ) : (
                <button
                  type="button"
                  disabled={kakaoLoading}
                  onClick={handleVerifyKakao}
                  className="h-8 px-3 rounded-xl bg-[#FEE500] hover:bg-[#f5dc00] text-[#1C2924] text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                >
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                  <span>{kakaoLoading ? '인증 중...' : '카카오 본인인증'}</span>
                </button>
              )}
            </div>
            {kakaoPopupFallbackUrl && !kakaoProfile && (
              <div className="pt-1 flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[11px] text-amber-700 dark:text-amber-300">
                  팝업 차단이 감지되었습니다:
                </span>
                <a
                  href={kakaoPopupFallbackUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setKakaoLoading(true)}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#FEE500] text-[#1C2924] text-[11px] font-bold hover:bg-[#f5dc00]"
                >
                  <ExternalLink className="h-3 w-3" />
                  <span>새 탭에서 카카오 인증 열기</span>
                </a>
              </div>
            )}
            {kakaoCallbackHint && (
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed">
                Kakao Developers 앱 설정 시 Redirect URI: <code>{kakaoCallbackHint}</code>
              </p>
            )}
          </div>

          <form
            onSubmit={mode === 'login' ? handleLoginSubmit : handleRegisterSubmit}
            className="space-y-4"
          >
            {mode === 'register' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label
                    htmlFor="reg-name"
                    className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1"
                  >
                    이름
                  </label>
                  <input
                    id="reg-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="홍길동"
                    className="w-full h-10 px-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-sm focus:outline-none focus:ring-2 focus:ring-[#07C160]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="reg-dept"
                    className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1"
                  >
                    소속 부서
                  </label>
                  <select
                    id="reg-dept"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-sm"
                  >
                    {DEPARTMENTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="reg-pos"
                    className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1"
                  >
                    직책 / 직급
                  </label>
                  <select
                    id="reg-pos"
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-sm"
                  >
                    {POSITIONS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Mandatory Step 2: Company Email + 6-Digit Security Code */}
            <div className="p-3.5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-800/40 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="h-5 w-5 rounded-full bg-[#008069] text-white text-[11px] font-bold flex items-center justify-center">
                    2
                  </span>
                  <span className="text-xs font-bold text-neutral-900 dark:text-white">
                    회사 이메일 보안코드 인증 (필수)
                  </span>
                </div>
                {isEmailVerified && (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-[#008069] dark:text-[#07C160]">
                    <MailCheck className="h-4 w-4" />
                    <span>이메일 인증 완료</span>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="auth-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => handleEmailChange(e.target.value)}
                  placeholder="name@sgw.co.kr"
                  aria-label="SGW 회사 이메일"
                  className="min-w-0 flex-1 h-10 px-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-sm focus:outline-none focus:ring-2 focus:ring-[#07C160]"
                />
                <button
                  type="button"
                  disabled={emailCodeLoading || !normalizedEmail}
                  onClick={handleSendEmailCode}
                  className="h-10 px-3 rounded-xl bg-[#1C2924] hover:bg-[#263831] text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  {emailCodeSent ? '코드 재발송' : '보안코드 발송'}
                </button>
              </div>

              {emailCodeSent && !isEmailVerified && (
                <div className="space-y-2 pt-1">
                  {emailPreviewCode && (
                    <div className="px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-center justify-between gap-2">
                      <span>
                        테스트 프리뷰 보안코드:{' '}
                        <strong className="font-mono text-sm tracking-wider">
                          {emailPreviewCode}
                        </strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => setEmailCodeInput(emailPreviewCode)}
                        className="text-[11px] font-bold underline cursor-pointer shrink-0"
                      >
                        자동 입력
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1 min-w-0">
                      <KeyRound className="h-4 w-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={emailCodeInput}
                        onChange={(e) => setEmailCodeInput(e.target.value)}
                        placeholder="6자리 보안코드"
                        aria-label="이메일 6자리 보안코드"
                        className="w-full h-10 pl-9 pr-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-[#07C160]"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={emailCodeLoading || emailCodeInput.trim().length !== 6}
                      onClick={handleVerifyEmailCode}
                      className="h-10 px-3.5 rounded-xl bg-[#008069] hover:bg-[#006B58] text-white text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                    >
                      코드 확인
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className={mode === 'register' ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : ''}>
              {mode === 'register' && (
                <div>
                  <label
                    htmlFor="reg-phone"
                    className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1"
                  >
                    연락처 (선택)
                  </label>
                  <input
                    id="reg-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="010-1234-5678"
                    className="w-full h-10 px-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-sm"
                  />
                </div>
              )}
              <div>
                <label
                  htmlFor="auth-password"
                  className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1"
                >
                  계정 비밀번호
                </label>
                <input
                  id="auth-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="사내 계정 비밀번호 입력"
                  className="w-full h-10 px-3.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-sm focus:outline-none focus:ring-2 focus:ring-[#07C160]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !securityReady}
              className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-[#008069] hover:bg-[#006B58] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
            >
              {mode === 'login' ? (
                <LogIn className="h-4 w-4 shrink-0" />
              ) : (
                <UserPlus className="h-4 w-4 shrink-0" />
              )}
              <span className="text-center">
                {loading
                  ? '보안 검증 및 접속 중...'
                  : securityReady
                    ? mode === 'login'
                      ? '보안 검증 완료 · SG Talk 접속'
                      : '보안 검증 완료 · 사원 가입 및 입장'
                    : '① 카카오 · ② 이메일 인증 후 접속 가능'}
              </span>
            </button>
          </form>

          {portalConfig?.testBypassLogin && onQuickTestEnter && (
            <button
              type="button"
              onClick={onQuickTestEnter}
              className="mt-3 w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-700 text-xs font-semibold text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
            >
              테스트 모드로 바로 입장
            </button>
          )}
      </div>
    </div>
  );
}
