import { useState } from 'react';
import {
  BookOpen,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  FileText,
  Puzzle,
  Smartphone,
  WifiOff,
  X,
} from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="fixed bottom-20 md:bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-600 px-3 py-2 text-xs font-semibold text-white shadow-lg">
      <WifiOff className="h-3.5 w-3.5" />
      <span>오프라인 모드 — 네트워크 연결을 확인해 주세요</span>
    </div>
  );
}

export function PWAInstallButton({ compact = false }: { compact?: boolean }) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="h-8 px-2.5 rounded-xl bg-[#07C160] hover:bg-[#06ad56] text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap cursor-pointer shadow-xs"
      >
        <Download className="h-3.5 w-3.5" />
        <span>{compact ? '앱 설치' : '모바일 앱 설치'}</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="h-8 px-2.5 rounded-xl border border-[#008069] text-[#008069] dark:text-[#07C160] text-xs font-bold flex items-center gap-1 whitespace-nowrap cursor-pointer"
        >
          <Smartphone className="h-3.5 w-3.5" />
          <span>홈 화면 설치</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-neutral-900 p-5 shadow-2xl space-y-3 border border-neutral-200 dark:border-neutral-800">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-neutral-900 dark:text-white">
                  iPhone / iPad 홈 화면에 설치
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="닫기"
                  className="text-neutral-400 hover:text-neutral-700 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ol className="text-xs text-neutral-600 dark:text-neutral-300 space-y-1.5 list-decimal pl-4">
                <li>Safari 하단 또는 상단의 <strong>공유</strong> 아이콘을 누릅니다.</li>
                <li>메뉴를 내려 <strong>홈 화면에 추가</strong>를 선택하면 독립 앱으로 실행됩니다.</li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full h-9 rounded-xl bg-[#008069] text-white text-xs font-bold cursor-pointer"
              >
                확인
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}

interface InstallTargetsModalProps {
  onClose: () => void;
}

const DEV_APP_ORIGIN =
  'https://ais-dev-dd6u7da3qpp5txkixdkxir-261255021621.asia-east1.run.app';
const SHARED_APP_ORIGIN =
  'https://ais-pre-dd6u7da3qpp5txkixdkxir-261255021621.asia-east1.run.app';

export function InstallTargetsModal({ onClose }: InstallTargetsModalProps) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [copiedSnippet, setCopiedSnippet] = useState<
    'embed' | 'mobile' | 'source' | 'shared-source' | null
  >(null);
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const mobileUrl = `${origin}/mobile.html`;
  const extensionUrl = `${origin}/extension.html`;
  const sourceZipUrl = `${origin}/api/download/source.zip`;
  const sharedSourceZipUrl = `${SHARED_APP_ORIGIN}/api/download/source.zip`;
  const devSourceZipUrl = `${DEV_APP_ORIGIN}/api/download/source.zip`;
  const embedSnippet = `<iframe src="${extensionUrl}" title="SG Talk 확장앱" style="width:100%;height:100%;border:0" allow="microphone"></iframe>`;

  const copyText = (
    kind: 'embed' | 'mobile' | 'source' | 'shared-source',
    value: string,
  ) => {
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopiedSnippet(kind);
    window.setTimeout(() => setCopiedSnippet(null), 1600);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="확장앱 및 모바일 별도 설치"
    >
      <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 bg-[#1C2924] text-white flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold">SG Talk · 확장앱 &amp; 모바일 별도 설치</h3>
            <p className="text-xs text-neutral-300 mt-0.5">
              브라우저 확장앱(Chrome/Edge/SGW 포털)과 모바일 앱(PWA)을 각각 독립 설치할 수 있습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="설치 창 닫기"
            className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-white/10 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto chat-scroll">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Card 1: Chrome / Edge Extension + SGW Embed */}
            <div className="p-4 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-800/40 flex flex-col justify-between gap-4">
              <div className="space-y-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="h-10 w-10 rounded-xl bg-[#008069] text-white flex items-center justify-center shrink-0">
                    <Puzzle className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-neutral-900 dark:text-white">
                      1. 웹 확장앱 별도 설치
                    </h4>
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      Chrome / Edge 사이드패널 &amp; SGW 서브앱
                    </p>
                  </div>
                </div>

                <ol className="text-xs text-neutral-600 dark:text-neutral-300 space-y-1 list-decimal pl-4 leading-relaxed">
                  <li>아래 <strong>확장앱 패키지(.zip)</strong>를 다운로드해 압축을 풉니다.</li>
                  <li>Chrome/Edge 주소창에 <code>chrome://extensions</code> 입력 후 <strong>개발자 모드</strong>를 켭니다.</li>
                  <li><strong>압축해제된 확장 프로그램을 로드합니다</strong>에서 폴더를 선택합니다.</li>
                </ol>

                <div className="p-2.5 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-neutral-500">
                    <span>SGW 포털 임베드 코드</span>
                    <button
                      type="button"
                      onClick={() => copyText('embed', embedSnippet)}
                      className="inline-flex items-center gap-1 text-[#008069] dark:text-[#07C160] hover:underline cursor-pointer"
                    >
                      {copiedSnippet === 'embed' ? (
                        <>
                          <Check className="h-3 w-3" />
                          <span>복사됨</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>코드 복사</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="text-[10px] font-mono text-neutral-700 dark:text-neutral-300 overflow-x-auto whitespace-pre-wrap break-all">
                    {embedSnippet}
                  </pre>
                </div>
              </div>

              <div className="space-y-2">
                <a
                  href="/api/install/extension.zip"
                  download="sgw-messenger-extension.zip"
                  className="w-full h-9 rounded-xl bg-[#008069] hover:bg-[#006B58] text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Download className="h-4 w-4" />
                  <span>확장앱 패키지 (.zip) 다운로드</span>
                </a>
                <a
                  href="/extension.html"
                  target="_self"
                  className="w-full h-8 rounded-xl border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>확장앱 전용 화면 (/extension.html)</span>
                </a>
              </div>
            </div>

            {/* Card 2: Standalone Mobile PWA */}
            <div className="p-4 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-800/40 flex flex-col justify-between gap-4">
              <div className="space-y-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="h-10 w-10 rounded-xl bg-[#FEE500] text-[#1C2924] flex items-center justify-center shrink-0">
                    <Smartphone className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-neutral-900 dark:text-white">
                      2. 모바일 앱 별도 설치 (PWA)
                    </h4>
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      Android · iOS 홈 화면 독립 앱 실행
                    </p>
                  </div>
                </div>

                <ol className="text-xs text-neutral-600 dark:text-neutral-300 space-y-1 list-decimal pl-4 leading-relaxed">
                  <li>모바일 브라우저로 <code>/mobile.html</code> 전용 주소에 접속합니다.</li>
                  <li>
                    {isIOS
                      ? 'Safari 공유 버튼 → "홈 화면에 추가"를 눌러 설치합니다.'
                      : '하단 "모바일 앱 지금 설치" 버튼 또는 브라우저 메뉴 "앱 설치"를 누릅니다.'}
                  </li>
                  <li>앱 아이콘이 홈 화면에 생성되며 전체화면 독립 앱으로 동작합니다.</li>
                </ol>

                <div className="p-2.5 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-neutral-500">
                    <span>모바일 전용 URL</span>
                    <button
                      type="button"
                      onClick={() => copyText('mobile', mobileUrl)}
                      className="inline-flex items-center gap-1 text-[#008069] dark:text-[#07C160] hover:underline cursor-pointer"
                    >
                      {copiedSnippet === 'mobile' ? (
                        <>
                          <Check className="h-3 w-3" />
                          <span>복사됨</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>링크 복사</span>
                        </>
                      )}
                    </button>
                  </div>
                  <p className="text-[11px] font-mono text-neutral-700 dark:text-neutral-300 break-all">
                    {mobileUrl}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                {isInstalled ? (
                  <div className="w-full h-9 rounded-xl bg-[#07C160]/15 text-[#075E54] dark:text-[#07C160] text-xs font-bold flex items-center justify-center gap-1.5">
                    <Check className="h-4 w-4" />
                    <span>현재 독립 앱(PWA)으로 실행 중</span>
                  </div>
                ) : isInstallable ? (
                  <button
                    type="button"
                    onClick={install}
                    className="w-full h-9 rounded-xl bg-[#07C160] hover:bg-[#06ad56] text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Download className="h-4 w-4" />
                    <span>모바일 앱 지금 설치 (PWA)</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => copyText('mobile', mobileUrl)}
                    className="w-full h-9 rounded-xl bg-[#1C2924] hover:bg-[#263831] text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Copy className="h-4 w-4" />
                    <span>모바일 설치 URL 복사하기</span>
                  </button>
                )}
                <a
                  href="/mobile.html"
                  target="_self"
                  className="w-full h-8 rounded-xl border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>모바일 앱 화면 열기 (/mobile.html)</span>
                </a>
              </div>
            </div>
          </div>

          {/* Card 3: SGW_V0 Chat-Only Replacement Bridge */}
          <div className="p-4 rounded-2xl border border-[#008069]/30 bg-[#07C160]/5 dark:bg-[#07C160]/10 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-bold text-[#075E54] dark:text-[#07C160]">
                3. SGW_V0 기존 앱에 채팅 기능만 교체 연동 (Drop-In Module &amp; postMessage 브리지)
              </h4>
              <button
                type="button"
                onClick={() =>
                  copyText(
                    'embed',
                    `<SGWChatModule currentUser={sgwUser} adapter={sgwAdapter} onUnreadCountChange={setUnread} />`,
                  )
                }
                className="text-[11px] font-semibold text-[#008069] dark:text-[#07C160] hover:underline cursor-pointer"
              >
                컴포넌트 코드 복사
              </button>
            </div>
            <p className="text-[11px] text-neutral-600 dark:text-neutral-300 leading-relaxed">
              <code>SGW_V0</code>의 메신저 탭에서 <code>&lt;SGWChatModule /&gt;</code>로 채팅만 교체하거나,{' '}
              <code>/extension.html</code>·<code>/mobile.html</code>을 iframe으로 마운트하면{' '}
              <code>SGW_UNREAD_CHANGED</code> · <code>SGW_LEAVE_REGISTERED</code> · <code>SEDMS_OPEN_MENU</code> ·{' '}
              <code>SGW_PROJECT_CALENDAR_OPEN</code> · <code>SGW_MEETING_MEMO_OPEN</code> ·{' '}
              <code>SGW_MEETING_OPEN</code> · <code>BMAIL_OPEN</code> 이벤트가 부모 창으로 자동 전송되며,{' '}
              외부 시스템은 <code>/api/integrations/sgw-sedms/webhook</code>으로 양방향 알림을 푸시할 수 있습니다.
            </p>
          </div>

          {/* Card 4: Full Source Code + Manual + Handoff Direct Download */}
          <div className="p-4 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/80 dark:bg-neutral-800/50 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2.5">
                <div className="h-10 w-10 rounded-xl bg-[#1C2924] text-[#FEE500] flex items-center justify-center shrink-0">
                  <FileCode2 className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-neutral-900 dark:text-white">
                    4. 전체 소스 코드 · 매뉴얼 · 핸드오프 상시 다운로드
                  </h4>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                    링크만으로 누구나 즉시 내려받을 수 있습니다 (.env·빌드 산출물·운영 DB 제외)
                  </p>
                </div>
              </div>
              <a
                href="/api/download/source.zip"
                download="sgw-messenger-source.zip"
                className="h-9 px-3.5 rounded-xl bg-[#1C2924] hover:bg-[#263831] text-white text-xs font-bold inline-flex items-center gap-1.5 shrink-0"
              >
                <Download className="h-4 w-4 text-[#FEE500]" />
                <span>전체 소스 (.zip) 받기</span>
              </a>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              <div className="p-2.5 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 space-y-1">
                <div className="flex items-center justify-between text-[11px] font-semibold text-neutral-500">
                  <span>현재 접속 주소 소스 링크</span>
                  <button
                    type="button"
                    onClick={() => copyText('source', sourceZipUrl)}
                    className="inline-flex items-center gap-1 text-[#008069] dark:text-[#07C160] hover:underline cursor-pointer"
                  >
                    {copiedSnippet === 'source' ? (
                      <>
                        <Check className="h-3 w-3" />
                        <span>복사됨</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        <span>링크 복사</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="text-[10px] font-mono text-neutral-700 dark:text-neutral-300 break-all">
                  {sourceZipUrl}
                </p>
              </div>

              <div className="p-2.5 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 space-y-1">
                <div className="flex items-center justify-between text-[11px] font-semibold text-neutral-500">
                  <span>공유 앱 고정 소스 링크</span>
                  <button
                    type="button"
                    onClick={() => copyText('shared-source', sharedSourceZipUrl)}
                    className="inline-flex items-center gap-1 text-[#008069] dark:text-[#07C160] hover:underline cursor-pointer"
                  >
                    {copiedSnippet === 'shared-source' ? (
                      <>
                        <Check className="h-3 w-3" />
                        <span>복사됨</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        <span>링크 복사</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="text-[10px] font-mono text-neutral-700 dark:text-neutral-300 break-all">
                  {sharedSourceZipUrl}
                </p>
                <p className="text-[10px] font-mono text-neutral-500 dark:text-neutral-400 break-all">
                  개발: {devSourceZipUrl}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <a
                href="/api/download/manual.md?inline=1"
                target="_blank"
                rel="noopener noreferrer"
                className="h-8 px-2.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-[11px] font-semibold inline-flex items-center justify-center gap-1"
              >
                <BookOpen className="h-3.5 w-3.5 text-[#008069]" />
                <span>매뉴얼 열기</span>
              </a>
              <a
                href="/api/download/manual.md"
                download="SGW_MANUAL.md"
                className="h-8 px-2.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-[11px] font-semibold inline-flex items-center justify-center gap-1"
              >
                <Download className="h-3.5 w-3.5 text-[#008069]" />
                <span>매뉴얼 저장</span>
              </a>
              <a
                href="/api/download/handoff.md?inline=1"
                target="_blank"
                rel="noopener noreferrer"
                className="h-8 px-2.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-[11px] font-semibold inline-flex items-center justify-center gap-1"
              >
                <FileText className="h-3.5 w-3.5 text-[#008069]" />
                <span>핸드오프 열기</span>
              </a>
              <a
                href="/api/download/handoff.md"
                download="SGW_HANDOFF.md"
                className="h-8 px-2.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-[11px] font-semibold inline-flex items-center justify-center gap-1"
              >
                <Download className="h-3.5 w-3.5 text-[#008069]" />
                <span>핸드오프 저장</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
