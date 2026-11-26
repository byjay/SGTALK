# SGW 메신저 · SGW EGO 프로젝트 핸드오프 (HANDOFF)

작성일: 2026-11-22  
대상 저장소: `https://github.com/byjay/SGW_V0`  
개발 프리뷰 URL: `https://ais-dev-dd6u7da3qpp5txkixdkxir-261255021621.asia-east1.run.app`  
공유 앱 URL: `https://ais-pre-dd6u7da3qpp5txkixdkxir-261255021621.asia-east1.run.app`

---

## 1. AI 에이전트가 완료한 작업 (즉시 사용 가능)

1. **SGW 사내 전용 자산 로그인 게이트 (Zero-Exposure)**
   - 로그인 전 외부 화면 및 API(`/api/users/public` 완전 삭제)에서 모든 직원 PII(성명·이메일·부서·비밀번호 힌트) 제거
   - `GET /api/auth/config` 비개인정보 설정 API, 카카오 본인인증 + 회사 이메일 6자리 OTP + 비밀번호 2단계 로그인 구현 (모바일 1화면 최적화)
   - 테스트/프리뷰 환경에서는 `POST /api/auth/test-session`을 통해 로그인 화면 없이 즉시 입장하며(`?login=1`로 로그인 창 확인 가능), 실운영 배포 시 `SGW_REQUIRE_LOGIN=true` 설정으로 2단계 로그인 게이트를 강제 적용할 수 있음
   - 로그인 5회 실패 시 60초 일시 잠금(`HTTP 429`), 상수 형태 scrypt 검증 및 단일 통합 오류 메시지 적용
2. **위챗 × 카카오톡 × 왓츠앱 3×3 채팅 기능 & 드롭인 모듈 (`src/chat/`)**
   - 위챗(음성녹음/STT, 회수·재편집, `@멘션`), 카톡(공지 배너, 실시간 투표, 이모티콘, 나와의 채팅), 왓츠앱(답장 인용/점프, 책갈피/다중 전달, 사라지는 메시지, 읽음 상세), 입력 초안 자동저장(`localStorage`) 구현
   - `extension.html` / `mobile.html` / `extension/` Chrome MV3 확장앱 및 PWA 분리 빌드 완료
3. **SEDMS · SGW · bmail 양방향 연동**
   - 자체 메일 `bmail` 웹훅(`/api/bmail/webhook`) 및 SEDMS 전체 메뉴(`/연차`, `/달력`, `/미팅메모`, `/회의`, `/결재`, `/문서`, `/프로젝트`, `/근태`, `/대시보드`) 연동 브리지(`postMessage` + `/api/integrations/sgw-sedms/webhook`) 구축
4. **SGW EGO 자율 AI 에이전트 × Kakao Developers 무료 API**
   - 서버 사이드 전용 Kakao 무료 API 래퍼 (`server/kakaoFreeApis.ts`): 로컬 장소검색, 다음 웹/블로그/도서 검색, 카카오톡 나에게 보내기, 톡캘린더 조회/생성
   - `server/egoAgent.ts`: `GEMINI_API_KEY` 설정 시 `gemini-4-hydrogen` 함수 호출 루프, 미설정 시 결정적 자율 워크플로 엔진(`sgw-rule-engine`) 동작 (가짜 데이터 미생성)
   - UI: **나와의 채팅** 상단 `EgoAgentPanel` (목표 입력, 한국어 음성 명령, `@ego` / `/ego` 채팅 명령, 카톡·캘린더 동의 팝업 버튼)
5. **보안 강화 및 차단 해제(직접 링크 다운로드 & iframe 임베드)**
   - SVG 인라인 업로드/다운로드 Stored XSS 차단(`isSafeInlineImageMime` + `sandbox` CSP)
   - OAuth `window.opener.postMessage` 타깃 오리진 고정, 서버 전용 Kakao 토큰 볼트 격리
   - HTTPS 사내 포털(`SGW_V0`) iframe 임베드 허용(`frame-ancestors 'self' https: http://localhost:* http://127.0.0.1:*`)
   - **상시 전체 소스 다운로드 링크 개방 (`GET /api/download/source.zip`)**: 로그인 없이 링크만으로 깨끗한 전체 소스 코드(`.env`·`node_modules`·`dist`·런타임 DB 제외) 즉시 다운로드 가능 + CORS 허용

---

## 2. AI 에이전트가 직접 수행할 수 없는 작업 (담당자 인수인계 필수)

아래 항목은 샌드박스 외부 인증·계정 권한·콘솔 설정이 필요하므로 담당자께서 직접 진행하셔야 합니다.

### ① GitHub 저장소(`byjay/SGW_V0`) 푸시 및 코드 병합
현재 실행 컨테이너에는 GitHub 개인 인증 토큰(PAT) 및 SSH 키가 존재하지 않아 `git push`를 직접 실행할 수 없습니다.

**진행 방법:**
```bash
# 1) 상시 다운로드 주소에서 전체 소스를 내려받습니다.
curl -L -o sgw-messenger-source.zip \
  https://ais-pre-dd6u7da3qpp5txkixdkxir-261255021621.asia-east1.run.app/api/download/source.zip

unzip sgw-messenger-source.zip -d sgw-messenger-source

# 2) 기존 SGW_V0 저장소를 클론한 뒤 채팅/서버/확장앱 모듈을 반영합니다.
git clone https://github.com/byjay/SGW_V0.git
cd SGW_V0

# 예시: 새 브랜치 생성 후 모듈 복사 및 푸시
git checkout -b feat/sgw-messenger-ego
cp -r ../sgw-messenger-source/src/chat ./src/
cp -r ../sgw-messenger-source/src/components ./src/
cp -r ../sgw-messenger-source/src/shared ./src/
cp -r ../sgw-messenger-source/extension ./extension
# (서버 백엔드도 함께 쓰는 경우 server.ts, server/, package.json 병합)

git add .
git commit -m "feat: integrate SGW messenger, zero-PII auth gate, Kakao Free APIs, and EGO agent"
git push -u origin feat/sgw-messenger-ego
```

### ② AI Studio Secrets / 운영 서버 환경변수 등록
`.env.example`을 참고하여 아래 비밀키를 AI Studio Secrets 또는 배포 환경(Cloud Run 등)에 등록하세요.
- `KAKAO_CLIENT_ID` : 카카오 개발자센터 앱의 **REST API 키** (카카오 로그인 본인인증 및 `talk_message`·`talk_calendar` OAuth용)
- `KAKAO_CLIENT_SECRET` : 카카오 로그인 → 보안 → Client Secret 활성화 시 발급되는 시크릿
- `KAKAO_REST_API_KEY` : 카카오 로컬(장소검색) 및 다음 검색(웹·블로그·도서) API 호출용 **REST API 키** (보통 `KAKAO_CLIENT_ID`와 동일 값 사용 가능)
- `GEMINI_API_KEY` : SGW EGO가 `gemini-4-hydrogen` 자율 추론 루프를 실행하기 위한 Gemini API 키
- `SMTP_WEBHOOK_URL` : 실제 사내 `@sgw.co.kr` 이메일로 6자리 보안코드를 발송할 사내 메일 게이트웨이 URL (미설정 시 비프로덕션 프리뷰 모드로 동작)
- `SESSION_SECRET` : 다중 인스턴스 또는 재시작 후에도 JWT 세션을 유지하기 위한 32바이트 이상 랜덤 문자열
- `SGW_WEBHOOK_SECRET` : `bmail` / SEDMS 외부 시스템에서 웹훅(`x-sgw-webhook-secret`)을 보낼 때 검증할 공유 시크릿
- `VITE_SGW_ALLOWED_ORIGINS` : `SGW_V0` 프로덕션 호스트 도메인 (예: `https://sgw.yourcompany.co.kr`) — `SGW_AUTH_SYNC` 부모-자식 창 인증 동기화 시 필요
- `APP_URL` : 리버스 프록시 뒤에서 카카오 OAuth `redirect_uri`를 고정할 기준 URL (예: `https://ais-pre-dd6u7da3qpp5txkixdkxir-261255021621.asia-east1.run.app`)

### ③ Kakao Developers 콘솔 설정 (개발자 포털 직접 작업 필요)
1. **내 애플리케이션 → 앱 설정 → 플랫폼 → Web 사이트 도메인**에 아래 주소 등록:
   - `https://ais-dev-dd6u7da3qpp5txkixdkxir-261255021621.asia-east1.run.app`
   - `https://ais-pre-dd6u7da3qpp5txkixdkxir-261255021621.asia-east1.run.app`
   - (사내 운영 도메인이 별도 있으면 함께 추가)
2. **제품 설정 → 카카오 로그인 → 활성화 ON** 후 **Redirect URI**에 아래 두 주소를 모두 등록:
   - `https://ais-dev-dd6u7da3qpp5txkixdkxir-261255021621.asia-east1.run.app/api/auth/kakao/callback`
   - `https://ais-pre-dd6u7da3qpp5txkixdkxir-261255021621.asia-east1.run.app/api/auth/kakao/callback`
3. **제품 설정 → 카카오 로그인 → 동의항목**에서 아래 항목 활성화:
   - `profile_nickname` (닉네임 — 필수/선택 동의)
   - `talk_message` (카카오톡 메시지 전송 — `나에게 보내기` 기능에 필요)
   - `talk_calendar` (톡캘린더 — 일정 조회·생성 기능에 필요, 비즈앱/검수 여부는 카카오 콘솔 정책 확인)

### ④ 영구 데이터베이스 전환 (운영 트래픽 확장 시)
- 현재 `server/store.ts`는 빠른 프리뷰 및 단일 노드 구동용 인메모리 저장소(및 `uploads/` 로컬 디스크)를 사용합니다.
- 실제 전사 운영·다중 서버(Cloud Run 다중 인스턴스) 배포 시에는 사용자/방/메시지/연차 데이터를 PostgreSQL(Cloud SQL) 또는 Firestore로 이관하고, `pendingKakaoGrants` / `userKakaoGrants` / `emailOtpStore`를 Redis 또는 암호화된 DB 세션 테이블로 전환하는 것을 권장합니다.

### ⑤ 브라우저 확장앱 스토어/사내 배포
- `.../api/install/extension.zip` 파일을 다운로드해 Chrome 웹 스토어 개발자 대시보드에 업로드하거나, 사내 Google Workspace 관리 콘솔의 확장 프로그램 강제 설치 정책으로 배포하세요.
- `extension/extension-frame.js`는 `https:` 또는 `http://localhost` 오리진만 허용하므로 배포 시 운영 서버 주소를 `https://...`로 지정하세요.

---

## 3. 상시 다운로드 · 테스트 엔드포인트 체크리스트

| 용도 | 주소 (도메인 뒤에 경로 연결) | 비인증 접근 |
| --- | --- | --- |
| **전체 소스 코드 (.zip)** | `/api/download/source.zip` | 가능 (링크만으로 항상 다운로드) |
| **사용자·연동 매뉴얼** | `/api/download/manual.md` (`?inline=1` 열람) | 가능 |
| **인수인계 핸드오프** | `/api/download/handoff.md` (`?inline=1` 열람) | 가능 |
| **크롬/엣지 확장앱 (.zip)** | `/api/install/extension.zip` | 가능 |
| **모바일 PWA 진입점** | `/mobile.html` | 가능 |
| **확장앱 임베드 진입점** | `/extension.html` | 가능 |
