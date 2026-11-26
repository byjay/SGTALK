import type { SedmsMenuKey } from './types';
import { parseChatLeaveCommand, type ParsedChatLeaveCommand } from './logic';
import { parseSgwIntegrationCommand } from './chatLogic';
import type { User } from './types';

export interface PlannedEgoAction {
  id: string;
  kind:
    | 'kakao_local_search'
    | 'kakao_web_search'
    | 'kakao_blog_search'
    | 'kakao_book_search'
    | 'kakao_talk_memo'
    | 'kakao_calendar_list'
    | 'kakao_calendar_create'
    | 'sgw_meeting_memo'
    | 'sgw_project_calendar'
    | 'sgw_leave_action'
    | 'sgw_leave_history'
    | 'sgw_sedms_menu'
    | 'sgw_colleague_lookup';
  label: string;
  query?: string;
  menuKey?: SedmsMenuKey;
  title?: string;
  content?: string;
  date?: string;
  autoExecuteLeave?: boolean;
  leaveParsed?: ParsedChatLeaveCommand;
}

export interface DeterministicEgoPlan {
  normalizedGoal: string;
  planSteps: string[];
  actions: PlannedEgoAction[];
  nextSuggestions: string[];
}

export function normalizeEgoGoal(raw: string): string {
  return String(raw ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

export function extractSearchSubject(goal: string): string {
  const stripped = goal
    .replace(
      /(카카오\s*(로컬|지도|맵|웹|블로그|도서|책|검색|톡|캘린더)|다음\s*검색|나에게\s*보내줘|내\s*카톡으로\s*보내줘|카톡으로\s*보내줘|카톡\s*보내줘|미팅\s*메모|회의록|프로젝트\s*달력|달력|캘린더|연차\s*등록|전자\s*결재|문서\s*관리|회의\s*시작|찾아서|검색해서|조회해서|알아봐줘|찾아줘|알려줘|정리해서|정리해줘|만들어줘|작성해서|작성하고|작성해줘|작성|요약하고|요약해서|요약해줘|확인하고|확인해서|확인해줘|연결해서|연결해줘|준비하고|준비해줘|보내줘|저장해줘|열어줘|연동해줘|해줘)/gi,
      ' ',
    )
    .replace(/[.,!?'"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.slice(0, 80) || goal.slice(0, 60);
}

export function sanitizeSafeHttpUrl(rawUrl: string | undefined): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Pure deterministic multi-step planner for SGW EGO when planning local/rule workflows
 * or pre-analyzing user goals into chained Kakao Free APIs + SGW/SEDMS actions.
 */
export function planDeterministicEgoWorkflow(input: {
  goal: string;
  todayDate: string;
  colleagues: User[];
}): DeterministicEgoPlan {
  const goal = normalizeEgoGoal(input.goal);
  const actions: PlannedEgoAction[] = [];
  const planSteps: string[] = [];
  const suggestions = new Set<string>();

  if (!goal) {
    return {
      normalizedGoal: '',
      planSteps: ['실행할 목표를 입력해 주세요.'],
      actions: [],
      nextSuggestions: [
        '판교 회식 장소 찾아서 미팅메모 작성하고 내 카톡으로 보내줘',
        '이번 주 프로젝트 달력 확인하고 회의 바로 시작해줘',
      ],
    };
  }

  const wantsPlace =
    /(맛집|식당|카페|장소|위치|회식|회의실|오피스|주소|지도|근처|주변|카카오\s*로컬|카카오맵|어디)/.test(
      goal,
    );
  const wantsBook = /(책|도서|교재|추천\s*도서|서적)/.test(goal);
  const wantsBlog = /(블로그|후기|리뷰)/.test(goal);
  const wantsWebSearch =
    wantsBlog ||
    /(검색|조사|찾아|알아봐|동향|트렌드|자료|가이드|뉴스|레퍼런스|다음)/.test(goal);
  const wantsKakaoMemo =
    /(카톡|카카오톡|나에게\s*보내|나한테\s*보내|메모\s*보내)/.test(goal);
  const wantsKakaoCalendar = /(카카오\s*캘린더|톡\s*캘린더)/.test(goal);
  const wantsMeetingMemo = /(미팅\s*메모|회의록|회의\s*메모)/.test(goal);
  const wantsLeaveHistory =
    /(내\s*연차|남은\s*연차|잔여\s*연차|연차\s*(정보|기록|내역|조회|현황|요약|몇\s*일|몇일)|과거\s*(연차|휴가|일정|기록)|지난\s*달.*(연차|휴가|스케줄)|휴가\s*(기록|내역|이력))/.test(
      goal,
    );
  const wantsProjectCal =
    !wantsKakaoCalendar &&
    (/(프로젝트\s*달력|마일스톤)/.test(goal) || (!wantsLeaveHistory && /(달력|일정|캘린더)/.test(goal)));
  const wantsColleague = /(동료|직원|팀원|사원|연락처|누구|연차자|부서)/.test(goal);
  const leaveParsed = parseChatLeaveCommand(goal, input.todayDate, input.colleagues);

  if (wantsPlace) {
    const q = extractSearchSubject(goal);
    planSteps.push(`카카오 로컬 무료 API로 "${q}" 장소·주소 실시간 조회`);
    actions.push({
      id: 'act-kakao-local',
      kind: 'kakao_local_search',
      label: '카카오 로컬·지도 장소 검색',
      query: q,
    });
    suggestions.add(`"${q}" 검색 결과를 SGW 미팅메모로 저장해줘`);
  }

  if (wantsBook) {
    const q = extractSearchSubject(goal);
    planSteps.push(`카카오 다음 도서 검색 API로 "${q}" 참고 도서 조회`);
    actions.push({
      id: 'act-kakao-book',
      kind: 'kakao_book_search',
      label: '카카오 다음 도서 무료 검색',
      query: q,
    });
  } else if (wantsBlog) {
    const q = extractSearchSubject(goal);
    planSteps.push(`카카오 다음 블로그 검색 API로 "${q}" 후기·사례 조회`);
    actions.push({
      id: 'act-kakao-blog',
      kind: 'kakao_blog_search',
      label: '카카오 다음 블로그 무료 검색',
      query: q,
    });
  } else if (wantsWebSearch && !wantsPlace) {
    const q = extractSearchSubject(goal);
    planSteps.push(`카카오 다음 웹 검색 API로 "${q}" 자료 조사`);
    actions.push({
      id: 'act-kakao-web',
      kind: 'kakao_web_search',
      label: '카카오 다음 웹 무료 검색',
      query: q,
    });
    suggestions.add(`"${q}" 조사 내용을 SEDMS 문서관리와 연결해줘`);
  }

  if (wantsColleague) {
    planSteps.push('인증된 사내 직원·오늘 연차 현황 조회');
    actions.push({
      id: 'act-sgw-colleague',
      kind: 'sgw_colleague_lookup',
      label: '사내 동료·근태 현황 조회',
      query: extractSearchSubject(goal),
    });
  }

  if (wantsLeaveHistory && !leaveParsed.matched) {
    planSteps.push('내 연차 잔여 일수 및 과거 휴가·스케줄 기록 조회');
    actions.push({
      id: 'act-sgw-leave-history',
      kind: 'sgw_leave_history',
      label: '연차 정보 · 과거 기록 대화형 조회',
      query: goal,
    });
    suggestions.add('지난달 전사 연차 일정도 보여줘');
  }

  if (leaveParsed.matched) {
    const autoExecute = /(바로|즉시|자동|확정)/.test(goal);
    planSteps.push(
      autoExecute
        ? `SEDMS 연차(${leaveParsed.type}, ${leaveParsed.startDate}) 즉시 등록 및 전 사원 알림`
        : `SEDMS 연차(${leaveParsed.type}, ${leaveParsed.startDate}) 신청 연동 카드 준비`,
    );
    actions.push({
      id: 'act-sgw-leave',
      kind: 'sgw_leave_action',
      label: autoExecute ? 'SEDMS 연차 즉시 등록' : 'SEDMS 연차 연동 준비',
      autoExecuteLeave: autoExecute,
      leaveParsed,
    });
    suggestions.add('연차 일정을 프로젝트 달력에 반영해줘');
  }

  if (wantsProjectCal) {
    const isoDate = goal.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? input.todayDate;
    const isCreate = /(등록|추가|생성|반영|기록)/.test(goal);
    planSteps.push(`SGW 프로젝트 달력 ${isCreate ? '일정 등록' : '조회'} 브리지 실행`);
    actions.push({
      id: 'act-sgw-cal',
      kind: 'sgw_project_calendar',
      label: isCreate ? 'SGW 프로젝트 달력 일정 등록' : 'SGW 프로젝트 달력 열기',
      title: goal.slice(0, 60),
      date: isoDate,
    });
  }

  if (wantsMeetingMemo) {
    planSteps.push('수집된 결과와 요약을 SGW 미팅메모로 자동 기록');
    actions.push({
      id: 'act-sgw-memo',
      kind: 'sgw_meeting_memo',
      label: 'SGW 미팅메모 생성 연동',
      title: `EGO 자율 브리핑 · ${goal.slice(0, 40)}`,
      content: goal,
    });
  }

  const integration = parseSgwIntegrationCommand(goal);
  if (
    integration.matched &&
    integration.summary.menuKey !== 'project-calendar' &&
    integration.summary.menuKey !== 'meeting-memo'
  ) {
    planSteps.push(`${integration.summary.system} · ${integration.summary.title} 연동`);
    actions.push({
      id: `act-sedms-${integration.summary.menuKey}`,
      kind: 'sgw_sedms_menu',
      label: integration.summary.title,
      menuKey: integration.summary.menuKey,
      title: integration.summary.title,
      content: goal,
    });
  }

  if (wantsKakaoCalendar) {
    const isCreate = /(등록|추가|생성)/.test(goal);
    planSteps.push(
      isCreate
        ? '카카오 톡캘린더 무료 API로 일정 생성'
        : '카카오 톡캘린더 무료 API로 다가오는 일정 조회',
    );
    actions.push({
      id: 'act-kakao-cal',
      kind: isCreate ? 'kakao_calendar_create' : 'kakao_calendar_list',
      label: isCreate ? '카카오 톡캘린더 일정 생성' : '카카오 톡캘린더 일정 조회',
      title: extractSearchSubject(goal),
      date: input.todayDate,
    });
  }

  if (wantsKakaoMemo) {
    planSteps.push('카카오톡 나에게 보내기 무료 API로 브리핑 전송');
    actions.push({
      id: 'act-kakao-memo',
      kind: 'kakao_talk_memo',
      label: '카카오톡 나에게 보내기',
      title: `[SGW EGO] ${goal.slice(0, 40)}`,
      content: goal,
    });
  }

  if (actions.length === 0) {
    // Autonomous default multi-step research + memo synthesis when goal is open-ended
    const q = extractSearchSubject(goal);
    planSteps.push(`카카오 다음 웹 검색으로 "${q}" 핵심 정보 수집`);
    planSteps.push('SEDMS·SGW 업무 맥락에 맞춰 브리핑 및 후속 실행 제안 생성');
    actions.push({
      id: 'act-kakao-web-default',
      kind: 'kakao_web_search',
      label: '카카오 다음 웹 무료 검색',
      query: q,
    });
    suggestions.add(`"${q}" 내용으로 SGW 미팅메모 작성해줘`);
    suggestions.add('SEDMS 전자결재 확인하고 프로젝트 달력 열어줘');
  } else {
    if (!wantsMeetingMemo) {
      suggestions.add('방금 결과를 SGW 미팅메모에 정리해줘');
    }
    if (!wantsKakaoMemo) {
      suggestions.add('이 요약을 내 카카오톡으로 보내줘');
    }
  }

  return {
    normalizedGoal: goal,
    planSteps,
    actions,
    nextSuggestions: Array.from(suggestions).slice(0, 3),
  };
}
