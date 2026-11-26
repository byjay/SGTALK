# SGW 메신저 · SGW EGO 사용 및 연동 매뉴얼

> **전체 소스 및 문서 상시 다운로드 주소 (링크만으로 즉시 다운로드 가능 · 인증 불필요)**
> - **개발 프리뷰 전체 소스(.zip)**: `https://ais-dev-dd6u7da3qpp5txkixdkxir-261255021621.asia-east1.run.app/api/download/source.zip`
> - **공유 앱 전체 소스(.zip)**: `https://ais-pre-dd6u7da3qpp5txkixdkxir-261255021621.asia-east1.run.app/api/download/source.zip`
> - **브라우저 확장앱(.zip)**: `.../api/install/extension.zip`
> - **매뉴얼(MANUAL.md)**: `.../api/download/manual.md` (`?inline=1` 추가 시 브라우저에서 바로 열람)
> - **인수인계서(HANDOFF.md)**: `.../api/download/handoff.md` (`?inline=1` 추가 시 브라우저에서 바로 열람)

---

## 목차
1. [사내 보안 로그인 포털 이용 방법](#1-사내-보안-로그인-포털-이용-방법)
2. [화면 모드 (앱 스타일 vs 웹 확장앱)](#2-화면-모드-앱-스타일-vs-웹-확장앱)
3. [채팅 핵심 기능 (위챗 × 카카오톡 × 왓츠앱 3×3)](#3-채팅-핵심-기능-위챗--카카오톡--왓츠앱-33)
4. [나와의 채팅 × SEDMS · SGW 통합 연동](#4-나와의-채팅--sedms--sgw-통합-연동)
5. [SGW EGO 자율 AI 에이전트 × Kakao 무료 API 활용](#5-sgw-ego-자율-ai-에이전트--kakao-무료-api-활용)
6. [확장앱 · 모바일 앱(PWA) 별도 설치](#6-확장앱--모바일-앱pwa-별도-설치)
7. [개발자·관리자용: SGW_V0 채팅 교체 및 서버 실행 가이드](#7-개발자관리자용-sgw_v0-채팅-교체-및-서버-실행-가이드)

---

## 1. 사내 보안 로그인 포털 이용 방법

- **테스트/프리뷰 모드 (기본 동작)**: 개발·테스트 환경에서는 로그인 화면을 건너뛰고 즉시 메신저 화면으로 입장합니다. (로그인 화면 테스트가 필요할 때는 URL 끝에 `?login=1`을 붙이거나 우측/하단 `로그아웃` 버튼을 누르세요.)
- **운영 모드 (`SGW_REQUIRE_LOGIN=true` 또는 프로덕션 배포)**: 외부 접근 시 임직원 이름·부서·이메일 등 내부 인사 정보를 일절 노출하지 않는 **Zero-Exposure 2단계 보안 로그인**이 강제됩니다.

1. **① 카카오 본인인증 (필수)**
   - `[카카오 본인인증 하기]` 버튼을 눌러 카카오 계정 인증 팝업을 완료합니다.
   - `KAKAO_CLIENT_ID`가 미설정된 개발 프리뷰 환경에서는 자동으로 프리뷰 본인인증 토큰이 발급됩니다.
2. **② 회사 이메일 보안코드 인증 (필수)**
   - 사내 이메일(`name@sgw.co.kr`)을 입력하고 `[보안코드 발송]`을 누릅니다.
   - 수신한 6자리 숫자를 입력해 `[보안코드 확인]`을 완료합니다. (개발 프리뷰에서는 화면 상단에 테스트 코드가 함께 표시됩니다.)
3. **계정 비밀번호 입력 및 접속**
   - 사내 계정 비밀번호를 입력한 뒤 `[보안 검증 완료 · SGW 메신저 접속]`을 클릭합니다.
   - 5회 연속 비밀번호가 틀릴 경우 보안을 위해 계정이 60초간 일시 잠금(`HTTP 429`)됩니다.
   - 신규 입사자는 상단 `[신규 사원 가입]` 탭에서 동일한 2단계 인증 후 즉시 사내 계정을 생성할 수 있습니다.

---

## 2. 화면 모드 (앱 스타일 vs 웹 확장앱)

상단 우측 전환 버튼으로 두 가지 화면을 즉시 오갈 수 있습니다.
- **앱 스타일 (`/mobile.html` 또는 앱 모드)**: 카카오톡 × 위챗 × 왓츠앱 스타일의 좌측 아이콘 레일 + 채팅 목록 + 대화창 + 하단 모바일 탭 구성
- **웹 확장앱 (`/extension.html` 또는 확장앱 모드)**: SGW 그룹웨어 서브앱에 최적화된 3단 레이아웃(좌측 접속자/채널 사이드바 · 중앙 대화창 · 우측 공지/책갈피/파일/멤버 서랍)

---

## 3. 채팅 핵심 기능 (위챗 × 카카오톡 × 왓츠앱 3×3)

- **위챗(WeChat) 계열**
  1. **음성 메시지 녹음 & STT 변환**: 마이크 버튼으로 음성 메모를 녹음·전송하고 `문자로 변환` 버튼으로 텍스트 확인
  2. **메시지 회수(Recall) & 재편집**: 전송한 메시지를 회수하고 필요 시 `다시 편집`으로 입력창에 복원
  3. **`@멘션` 자동완성 & 안 읽은 멘션 배지**: `@이름` 입력 시 방 멤버 멘션 팝업 및 채팅방 목록 `@멘션` 강조 표시
- **카카오톡(KakaoTalk) 계열**
  1. **채팅방 상단 공지 접기/펼치기**: 중요한 메시지를 공지로 등록해 상단 고정 배너로 관리
  2. **실시간 팀 투표(Poll)**: 복수 선택 가능한 실시간 투표를 생성하고 즉시 득표 현황 확인
  3. **업무용 이모티콘 + 나와의 채팅**: 원클릭 업무 스티커와 개인 메모·명령 허브(`나와의 채팅`)
- **왓츠앱(WhatsApp) 계열**
  1. **스와이프/버튼 답장 인용 & 클릭 점프**: 특정 메시지에 답장(Reply)하고 인용 박스를 누르면 원본 메시지로 스크롤 이동
  2. **중요 메시지 책갈피(Star) & 다중 전달(Forward)**: 메시지를 책갈피로 보관하고 여러 대화를 묶어 다른 방/동료에게 전달
  3. **사라지는 메시지(Disappearing) & 읽음 확인 상세**: `24시간`/`7일` 자동 만료 타이머 및 메시지별 읽음/안읽음 인원 상세 팝오버
- **작성 중 임시저장(Auto-Save)**: 입력 중인 초안은 방별로 자동 저장(`localStorage`)되어 새로고침 후에도 유지됩니다.

---

## 4. 나와의 채팅 × SEDMS · SGW 통합 연동

**나와의 채팅** 상단 허브 바와 슬래시(`/`) 명령어로 모든 SEDMS·SGW 업무 메뉴를 바로 호출할 수 있습니다.
- **상단 빠른 연동 버튼**: `EGO 자율 AI` · `연차등록` · `프로젝트 달력` · `SGW 미팅메모` · `회의 바로 연동` · `SEDMS 전체메뉴`
- **지원 슬래시 명령어**:
  - `/연차` (대화형 본인 연차 등록 — 완료 시 전 사원 메신저 & `bmail` 알림 자동 발송)
  - `/달력` (SGW 프로젝트 달력 열기/등록)
  - `/미팅메모` (SGW 미팅메모 생성/열기)
  - `/회의` (SGW 실시간 회의실 즉시 시작)
  - `/결재` · `/문서` · `/프로젝트` · `/근태` · `/대시보드` · `/bmail`
- **음성 명령**: 입력창 하단 `[음성 명령]` 버튼(또는 EGO 패널의 마이크 버튼)을 눌러 한국어로 말하면 자동 인식 후 연동이 실행됩니다.

---

## 5. SGW EGO 자율 AI 에이전트 × Kakao 무료 API 활용

**나와의 채팅**에서 `[EGO 자율 AI]` 패널에 목표를 입력하면, **SGW EGO**가 스스로 단계별 계획을 수립해 Kakao Developers 무료 API와 SGW·SEDMS 브리지를 연쇄 실행합니다.

### 사용 예시
- `"판교 회식 장소 찾아서 미팅메모 작성하고 내 카톡으로 보내줘"`
  → ① 카카오 로컬 장소 검색 → ② SGW 미팅메모 생성 브리지 실행 → ③ 내 카카오톡(`나에게 보내기`) 브리핑 전송
- `"최신 TypeScript 보안 동향 검색해서 문서관리 열어줘"`
  → ① 다음 웹 검색 API 조회 → ② SEDMS 문서관리 화면 연동
- `"프로젝트 달력 확인하고 회의 바로 시작해줘"`
  → ① SGW 프로젝트 달력 조회 → ② SGW 회의실 연동 실행
- `"오늘 접속 중인 팀원 확인하고 내일 연차 신청 준비해줘"`
  → ① 인증 사내 조직/접속자 조회 → ② SEDMS 연차 신청 연동 카드 준비
- 채팅창에 직접 `@ego 판교 카페 추천해줘` 또는 `/ego 이번 주 일정 확인해줘`로도 실행할 수 있습니다.

### 카카오톡 나에게 보내기 · 톡캘린더 연동하기
1. EGO 패널 우측 상단의 `[카톡·캘린더 연동]` 버튼을 클릭합니다.
2. 카카오 동의 화면에서 `talk_message`(나에게 메시지 보내기) 및 `talk_calendar`(톡캘린더) 권한에 동의합니다.
3. 발급된 토큰은 브라우저에 저장되지 않고 서버 메모리에만 안전하게 보관되어 EGO 호출 시 사용됩니다.

---

## 6. 확장앱 · 모바일 앱(PWA) 별도 설치

로그인 후 상단 우측 `[확장앱·모바일 설치]` 버튼을 열면 다음 4가지를 바로 사용할 수 있습니다.
1. **웹 확장앱 패키지 (`.zip`) 다운로드**: 압축 해제 후 `chrome://extensions` → `개발자 모드 ON` → `압축해제된 확장 프로그램을 로드합니다` 선택
2. **모바일 앱 (PWA)**: 모바일 브라우저에서 `/mobile.html` 접속 후 `[모바일 앱 지금 설치]` 또는 Safari `공유 → 홈 화면에 추가`
3. **SGW_V0 iframe 임베드 코드 복사**: 기존 SGW 포털에 `/extension.html`을 바로 삽입
4. **전체 소스코드(`.zip`) · 매뉴얼 · 핸드오프 링크 복사 및 다운로드**

---

## 7. 개발자·관리자용: SGW_V0 채팅 교체 및 서버 실행 가이드

### A. 전체 소스 다운로드 및 로컬 실행
```bash
# 1. 어디서든 링크만으로 전체 소스 다운로드
curl -L -o sgw-messenger-source.zip \
  https://ais-pre-dd6u7da3qpp5txkixdkxir-261255021621.asia-east1.run.app/api/download/source.zip

# 2. 압축 해제 및 패키지 설치
unzip sgw-messenger-source.zip -d sgw-messenger
cd sgw-messenger
npm install   # 또는 bun install

# 3. 환경 변수 설정 (.env.example 참고)
cp .env.example .env

# 4. 개발 서버 실행 (포트 3000) / 프로덕션 빌드
npm run dev
npm run build
```

### B. `SGW_V0` 프로젝트에 채팅 기능만 교체 연동
1. **React Drop-In 모듈 방식**: `src/chat/` (`SGWChatModule.tsx`, `adapter.ts`)와 `src/components/`, `src/shared/`를 `SGW_V0`에 통합하고 `<SGWChatModule currentUser={...} adapter={createRestChatAdapter(apiBase, getToken)} />`로 기존 채팅 뷰를 교체합니다.
2. **iframe 서브앱 방식**: `SGW_V0` 내 채팅 영역에 `<iframe src="https://<서버주소>/extension.html" allow="microphone" />`을 마운트합니다.
   - **수신 가능한 부모 창 이벤트 (`window.addEventListener('message', ...)`)**:
     `SGW_CHAT_READY`, `SGW_UNREAD_CHANGED`, `SGW_LEAVE_REGISTERED`, `BMAIL_OPEN`, `SEDMS_OPEN_MENU`, `SGW_PROJECT_CALENDAR_OPEN`, `SGW_MEETING_MEMO_OPEN`, `SGW_MEETING_OPEN`
   - **외부 시스템 푸시 웹훅**: `POST /api/integrations/sgw-sedms/webhook`, `POST /api/bmail/webhook` (`x-sgw-webhook-secret` 헤더 또는 사용자 Bearer JWT 사용)

### C. 주요 API 엔드포인트
- `GET /api/download/source.zip` : 전체 소스 코드 ZIP (비인증 공개 링크)
- `GET /api/download/manual.md` / `GET /api/download/handoff.md` : 매뉴얼 및 인수인계서
- `GET /api/install/extension.zip` : Chrome/Edge 확장앱 패키지 ZIP
- `GET /api/auth/config` : 비개인정보 포털 설정 조회
- `GET /api/auth/kakao/url`, `GET /api/auth/kakao/link-url`, `POST /api/auth/email-code/send`, `POST /api/auth/login` : 2단계 인증
- `GET /api/ego/status`, `POST /api/ego/run`, `POST /api/kakao/search` : SGW EGO & Kakao 무료 API 실행 (Bearer 인증 필수)
