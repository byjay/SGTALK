import {
  GoogleGenAI,
  ThinkingLevel,
  Type,
  type Content,
  type FunctionDeclaration,
} from '@google/genai';
import { planDeterministicEgoWorkflow } from '../src/shared/egoPlanner';
import { SEDMS_MENU_CATALOG } from '../src/shared/chatLogic';
import type {
  EgoRunResult,
  EgoToolExecution,
  IntegrationActionSummary,
  LeaveType,
  SedmsMenuKey,
} from '../src/shared/types';
import {
  getKakaoFreeApiStatusForUser,
  manageKakaoCalendar,
  searchKakaoDaum,
  searchKakaoLocalPlaces,
  sendKakaoTalkMemoToMe,
} from './kakaoFreeApis';
import { store } from './store';

function getTodayDateString(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const EGO_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'kakao_local_search',
    description:
      'Search real places, restaurants, cafes, offices, or addresses in South Korea using Kakao Developers Local Free API.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Korean place or keyword query, e.g. 판교 회식 식당' },
        size: { type: Type.NUMBER, description: 'Number of results (1-8)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'kakao_daum_search',
    description:
      'Search real web pages, blogs, or books using Kakao Developers Daum Search Free API.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Search query' },
        kind: {
          type: Type.STRING,
          description: 'One of web, blog, or book',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'kakao_talk_send_memo',
    description:
      'Send a briefing memo to the authenticated user in KakaoTalk ("나에게 보내기") using Kakao Talk Message Free API.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: 'Short memo title' },
        text: { type: Type.STRING, description: 'Concise memo content to deliver' },
      },
      required: ['title', 'text'],
    },
  },
  {
    name: 'kakao_calendar_manage',
    description:
      'List upcoming events or create an event in the user Kakao Talk Calendar using Kakao Calendar Free API.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: 'Either list or create' },
        title: { type: Type.STRING, description: 'Event title when action is create' },
        date: { type: Type.STRING, description: 'ISO YYYY-MM-DD date when action is create' },
        description: { type: Type.STRING, description: 'Optional event description' },
      },
      required: ['action'],
    },
  },
  {
    name: 'sgw_meeting_memo',
    description: 'Create or open an SGW Meeting Memo (미팅메모 / 회의록) synced with the SGW host workspace.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: 'create or view' },
        title: { type: Type.STRING, description: 'Meeting memo title' },
        content: { type: Type.STRING, description: 'Meeting memo body text' },
      },
      required: ['action', 'title'],
    },
  },
  {
    name: 'sgw_project_calendar',
    description: 'Open or schedule an item on the SGW Project Calendar (프로젝트 달력).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: 'create or view' },
        title: { type: Type.STRING, description: 'Calendar event title' },
        date: { type: Type.STRING, description: 'ISO YYYY-MM-DD date' },
      },
      required: ['action', 'title'],
    },
  },
  {
    name: 'sgw_sedms_open',
    description:
      'Open or bridge any SEDMS/SGW menu: leave, approval, document, project, attendance, meeting, bmail, dashboard.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        menuKey: {
          type: Type.STRING,
          description: 'Menu key: leave, approval, document, project, attendance, meeting, bmail, dashboard',
        },
        reason: { type: Type.STRING, description: 'Brief explanation for opening this menu' },
      },
      required: ['menuKey'],
    },
  },
  {
    name: 'sgw_leave_action',
    description:
      'Register or prepare a leave request (연차/오전반차/오후반차/병가/공가) for the authenticated user in SEDMS.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        type: { type: Type.STRING, description: '연차, 오전반차, 오후반차, 병가, or 공가' },
        startDate: { type: Type.STRING, description: 'YYYY-MM-DD' },
        endDate: { type: Type.STRING, description: 'YYYY-MM-DD' },
        reason: { type: Type.STRING, description: 'Leave reason' },
        autoExecute: {
          type: Type.BOOLEAN,
          description: 'True only if user explicitly asked to submit immediately',
        },
      },
      required: ['type', 'startDate', 'endDate'],
    },
  },
  {
    name: 'sgw_colleague_lookup',
    description:
      'Look up authenticated internal SGW colleagues, departments, and online/leave status (only for signed-in users).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Optional name or department keyword' },
      },
    },
  },
  {
    name: 'sgw_leave_history',
    description:
      'Check the authenticated user leave balance (total/used/remaining days) and query past or current leave schedule records conversationally.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Natural Korean query such as 내 연차 정보, 지난달 내 연차 기록, 과거 연차 내역',
        },
      },
      required: ['query'],
    },
  },
];

async function executeSingleTool(
  userId: string,
  toolName: string,
  args: Record<string, unknown>,
  integrationActions: IntegrationActionSummary[],
  todayDate: string,
): Promise<{
  execution: EgoToolExecution;
  modelPayload: Record<string, unknown>;
}> {
  const execId = `ego-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  if (toolName === 'kakao_local_search') {
    const query = String(args.query ?? '').trim();
    const size = typeof args.size === 'number' ? args.size : 5;
    const res = await searchKakaoLocalPlaces(query, size);
    const items = (res.data ?? []).map((p) => ({
      title: p.placeName,
      subtitle: p.roadAddressName || p.addressName,
      url: p.placeUrl,
      meta: [p.categoryName.split('>').pop()?.trim(), p.phone].filter(Boolean).join(' · '),
    }));
    return {
      execution: {
        id: execId,
        toolName,
        label: `카카오 로컬 검색 · "${query}"`,
        provider: 'KAKAO_LOCAL',
        status: res.status,
        summary: res.message,
        items,
      },
      modelPayload: { status: res.status, message: res.message, places: items },
    };
  }

  if (toolName === 'kakao_daum_search') {
    const query = String(args.query ?? '').trim();
    const rawKind = String(args.kind ?? 'web');
    const kind: 'web' | 'blog' | 'book' =
      rawKind === 'blog' || rawKind === 'book' ? rawKind : 'web';
    const res = await searchKakaoDaum(query, kind, 5);
    const items = (res.data ?? []).map((d) => ({
      title: d.title,
      subtitle: d.contents,
      url: d.url,
      meta: d.subtitle,
    }));
    return {
      execution: {
        id: execId,
        toolName,
        label: `카카오 다음 ${kind === 'book' ? '도서' : kind === 'blog' ? '블로그' : '웹'} 검색 · "${query}"`,
        provider: 'KAKAO_SEARCH',
        status: res.status,
        summary: res.message,
        items,
      },
      modelPayload: { status: res.status, message: res.message, documents: items },
    };
  }

  if (toolName === 'kakao_talk_send_memo') {
    const title = String(args.title ?? 'SGW EGO 브리핑').trim();
    const text = String(args.text ?? '').trim();
    const res = await sendKakaoTalkMemoToMe(userId, { title, text });
    return {
      execution: {
        id: execId,
        toolName,
        label: '카카오톡 나에게 보내기',
        provider: 'KAKAO_TALK',
        status: res.status,
        summary: res.message,
      },
      modelPayload: { status: res.status, message: res.message },
    };
  }

  if (toolName === 'kakao_calendar_manage') {
    const action = args.action === 'create' ? 'create' : 'list';
    const res = await manageKakaoCalendar(userId, action, {
      title: typeof args.title === 'string' ? args.title : undefined,
      date: typeof args.date === 'string' ? args.date : todayDate,
      description: typeof args.description === 'string' ? args.description : undefined,
    });
    const items = (res.data ?? []).map((ev) => ({
      title: ev.title,
      subtitle: ev.startAt || '',
    }));
    return {
      execution: {
        id: execId,
        toolName,
        label: action === 'create' ? '카카오 톡캘린더 일정 생성' : '카카오 톡캘린더 일정 조회',
        provider: 'KAKAO_CALENDAR',
        status: res.status,
        summary: res.message,
        items,
      },
      modelPayload: { status: res.status, message: res.message, events: items },
    };
  }

  if (toolName === 'sgw_meeting_memo') {
    const action = args.action === 'view' ? 'view' : 'create';
    const title = String(args.title ?? 'SGW EGO 미팅메모').trim();
    const content = String(args.content ?? '').trim();
    const summary: IntegrationActionSummary = {
      system: 'SGW',
      menuKey: 'meeting-memo',
      title: action === 'create' ? `SGW 미팅메모 생성 · ${title}` : 'SGW 미팅메모 열기',
      description: content || 'EGO 에이전트가 미팅메모 연동을 준비했습니다.',
      actionLabel: 'SGW 미팅메모 열기',
      payload: {
        action,
        title,
        content,
        source: 'sgw-ego',
      },
    };
    integrationActions.push(summary);
    return {
      execution: {
        id: execId,
        toolName,
        label: summary.title,
        provider: 'SGW',
        status: 'executed',
        summary: 'SGW 미팅메모 브리지 연동을 실행했습니다.',
      },
      modelPayload: { status: 'executed', summary },
    };
  }

  if (toolName === 'sgw_project_calendar') {
    const action = args.action === 'create' ? 'create' : 'view';
    const title = String(args.title ?? 'SGW 프로젝트 일정').trim();
    const date = String(args.date ?? todayDate).trim();
    const summary: IntegrationActionSummary = {
      system: 'SGW',
      menuKey: 'project-calendar',
      title: action === 'create' ? `프로젝트 달력 일정 연동 · ${title}` : 'SGW 프로젝트 달력 열기',
      description: `기준일: ${date}`,
      actionLabel: '프로젝트 달력 열기',
      payload: {
        action,
        title,
        date,
        source: 'sgw-ego',
      },
    };
    integrationActions.push(summary);
    return {
      execution: {
        id: execId,
        toolName,
        label: summary.title,
        provider: 'SGW',
        status: 'executed',
        summary: `SGW 프로젝트 달력(${date}) 브리지 연동을 실행했습니다.`,
      },
      modelPayload: { status: 'executed', summary },
    };
  }

  if (toolName === 'sgw_leave_action') {
    const allowedTypes: LeaveType[] = ['연차', '오전반차', '오후반차', '병가', '공가'];
    const rawType = String(args.type ?? '연차') as LeaveType;
    const type: LeaveType = allowedTypes.includes(rawType) ? rawType : '연차';
    const startDate = String(args.startDate ?? todayDate).slice(0, 10);
    const endDate = String(args.endDate ?? startDate).slice(0, 10);
    const reason = String(args.reason ?? 'EGO 에이전트 요청').trim();
    const autoExecute = Boolean(args.autoExecute);

    if (autoExecute) {
      const reg = store.registerLeave({
        userId,
        type,
        startDate,
        endDate,
        substituteId: null,
        reason,
      });
      if (reg.error || !reg.leave) {
        return {
          execution: {
            id: execId,
            toolName,
            label: 'SEDMS 연차 자동 등록',
            provider: 'SEDMS',
            status: 'error',
            summary: reg.error ?? '연차 등록에 실패했습니다.',
          },
          modelPayload: { status: 'error', error: reg.error ?? '연차 등록 실패' },
        };
      }
      const summary: IntegrationActionSummary = {
        system: 'SEDMS',
        menuKey: 'leave',
        title: `SEDMS ${type} 등록 완료 (${startDate})`,
        description: `사유: ${reason} · 전 사원 bmail·메신저 알림 발송 완료`,
        actionLabel: '연차 내역 확인',
        payload: { leaveId: reg.leave.id, startDate, endDate },
      };
      integrationActions.push(summary);
      return {
        execution: {
          id: execId,
          toolName,
          label: summary.title,
          provider: 'SEDMS',
          status: 'executed',
          summary: `${startDate} ${type}(${reg.leave.daysCount}일)가 등록되었습니다.`,
        },
        modelPayload: { status: 'executed', leave: reg.leave },
      };
    }

    const summary: IntegrationActionSummary = {
      system: 'SEDMS',
      menuKey: 'leave',
      title: `SEDMS ${type} 신청 준비 (${startDate})`,
      description: `기간: ${startDate} ~ ${endDate} · 사유: ${reason}`,
      actionLabel: '연차 등록 열기',
      payload: { type, startDate, endDate, reason },
    };
    integrationActions.push(summary);
    return {
      execution: {
        id: execId,
        toolName,
        label: summary.title,
        provider: 'SEDMS',
        status: 'executed',
        summary: `연차 신청(${type}, ${startDate}) 연동을 준비했습니다.`,
      },
      modelPayload: { status: 'executed', summary },
    };
  }

  if (toolName === 'sgw_colleague_lookup') {
    const query = String(args.query ?? '').trim().toLowerCase();
    const all = store.getUsers().filter((u) => u.role !== 'bot');
    const matched = query
      ? all.filter(
          (u) =>
            u.name.toLowerCase().includes(query) ||
            u.department.toLowerCase().includes(query) ||
            u.position.toLowerCase().includes(query),
        )
      : all;
    const items = matched.slice(0, 6).map((u) => ({
      title: `${u.name} ${u.position}`,
      subtitle: `${u.department} · ${u.statusMessage || u.presenceStatus}`,
      meta: u.online ? '접속 중' : '오프라인',
    }));
    return {
      execution: {
        id: execId,
        toolName,
        label: '인증 사내 조직·접속자 조회',
        provider: 'SGW',
        status: 'executed',
        summary: `사내 임직원 ${items.length}명의 상태를 확인했습니다.`,
        items,
      },
      modelPayload: { status: 'executed', colleagues: items },
    };
  }

  if (toolName === 'sgw_leave_history') {
    const queryText = String(args.query ?? '내 연차 정보 및 과거 기록').trim();
    const res = store.queryLeaves(userId, { q: queryText });
    if ('matchedLeaves' in res) {
      const items = res.matchedLeaves.slice(0, 6).map((l) => ({
        title: `${l.startDate === l.endDate ? l.startDate : `${l.startDate} ~ ${l.endDate}`} · ${l.type} (${l.daysCount}일)`,
        subtitle: l.reason || '개인 사유',
        meta: l.endDate < todayDate ? '사용완료' : l.startDate <= todayDate ? '오늘휴무' : '예정',
      }));
      return {
        execution: {
          id: execId,
          toolName,
          label: `연차 정보·과거 기록 조회 · "${queryText}"`,
          provider: 'SEDMS',
          status: 'executed',
          summary: res.summaryText,
          items,
        },
        modelPayload: {
          status: 'executed',
          summaryText: res.summaryText,
          remainingDays: res.balanceSummary.remainingDays,
          usedDays: res.balanceSummary.usedDays,
          totalDays: res.balanceSummary.totalDays,
          matchedCount: res.matchedLeaves.length,
          items,
        },
      };
    }
  }

  // Fallback: sgw_sedms_open
  const menuKey = String(args.menuKey ?? 'dashboard') as SedmsMenuKey;
  const cat = SEDMS_MENU_CATALOG.find((c) => c.menuKey === menuKey) ?? SEDMS_MENU_CATALOG[SEDMS_MENU_CATALOG.length - 1];
  const reason = String(args.reason ?? cat.description).trim();
  const summary: IntegrationActionSummary = {
    system: cat.system,
    menuKey: cat.menuKey,
    title: cat.label,
    description: reason,
    actionLabel: cat.actionLabel,
    payload: { action: 'view', source: 'sgw-ego' },
  };
  integrationActions.push(summary);
  return {
    execution: {
      id: execId,
      toolName: 'sgw_sedms_open',
      label: cat.label,
      provider: cat.system,
      status: 'executed',
      summary: `${cat.system} · ${cat.shortLabel} 화면 연동을 실행했습니다.`,
    },
    modelPayload: { status: 'executed', summary },
  };
}

export async function runAutonomousEgoAgent(input: {
  userId: string;
  goal: string;
  recordInSelfChat?: boolean;
}): Promise<{ ok: true; result: EgoRunResult } | { ok: false; statusCode: number; error: string }> {
  const goal = String(input.goal ?? '').trim().slice(0, 600);
  if (!goal) {
    return { ok: false, statusCode: 400, error: 'EGO 에이전트에게 전달할 목표나 명령을 입력해 주세요.' };
  }

  const user = store.getUsers().find((u) => u.id === input.userId);
  if (!user) {
    return { ok: false, statusCode: 404, error: '인증된 사용자를 찾을 수 없습니다.' };
  }

  const todayDate = getTodayDateString();
  const colleagues = store.getUsers().filter((u) => u.id !== user.id && u.role !== 'bot');
  const integrationActions: IntegrationActionSummary[] = [];
  const toolExecutions: EgoToolExecution[] = [];

  const geminiApiKey = process.env.GEMINI_API_KEY?.trim();

  if (geminiApiKey) {
    const ai = new GoogleGenAI({
      apiKey: geminiApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const systemInstruction = [
      `당신은 SGW 사내 그룹웨어의 자율 실행 AI 에이전트 'SGW EGO'입니다.`,
      `현재 사용자: ${user.name} ${user.position} (${user.department}), 오늘 날짜: ${todayDate}.`,
      `목표가 주어지면 스스로 단계별 계획을 세우고, Kakao Developers 무료 API(로컬 장소검색, 다음 웹/블로그/도서 검색, 카카오톡 나에게 보내기, 톡캘린더)와 SGW·SEDMS 도구(미팅메모, 프로젝트 달력, 연차등록, 전자결재, 문서관리, 회의)를 필요한 순서대로 연쇄 호출해 완수하세요.`,
      `예: 장소 검색이 필요하면 kakao_local_search를 먼저 호출하고, 그 실제 결과를 바탕으로 sgw_meeting_memo나 kakao_talk_send_memo에 구체적으로 담아 전달하세요.`,
      `도구 실행 결과에서 status가 'needs_config'로 반환되면 절대 가짜 결과를 지어내지 말고, 해당 API 키 또는 Kakao 연동이 필요함을 정직하게 안내하세요.`,
      `최종 답변은 한국어로 간결하고 명확하게 브리핑하세요.`,
    ].join('\n');

    const contents: Content[] = [{ role: 'user', parts: [{ text: goal }] }];
    const planSteps: string[] = [];
    let finalText = '';

    try {
      for (let turn = 0; turn < 4; turn += 1) {
        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents,
          config: {
            systemInstruction,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            tools: [{ functionDeclarations: EGO_FUNCTION_DECLARATIONS }],
          },
        });

        const candidateContent = response.candidates?.[0]?.content;
        const calls = response.functionCalls ?? [];

        if (calls.length === 0) {
          finalText = (response.text ?? '').trim();
          break;
        }

        if (candidateContent) {
          contents.push(candidateContent);
        }

        const responseParts: NonNullable<Content['parts']> = [];
        for (const call of calls) {
          const callName = call.name || 'sgw_sedms_open';
          const callArgs = (call.args ?? {}) as Record<string, unknown>;
          const outcome = await executeSingleTool(
            input.userId,
            callName,
            callArgs,
            integrationActions,
            todayDate,
          );
          toolExecutions.push(outcome.execution);
          planSteps.push(outcome.execution.label);
          responseParts.push({
            functionResponse: {
              id: call.id,
              name: callName,
              response: outcome.modelPayload,
            },
          });
        }

        contents.push({ role: 'user', parts: responseParts });

        // Capture any interim text if final turn
        if (turn === 3) {
          const wrapUp = await ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents,
            config: {
              systemInstruction,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          });
          finalText = (wrapUp.text ?? '').trim();
        }
      }

      if (!finalText) {
        finalText = toolExecutions.map((t) => `• ${t.label}: ${t.summary}`).join('\n');
      }

      const selfMsg =
        input.recordInSelfChat !== false
          ? postEgoSummaryToSelfRoom(input.userId, goal, finalText)
          : undefined;

      return {
        ok: true,
        result: {
          goal,
          engine: 'gemini-4-hydrogen',
          planSteps:
            planSteps.length > 0 ? planSteps : ['목표 분석 및 브리핑 완료'],
          toolExecutions,
          finalAnswer: finalText,
          integrationActions,
          nextSuggestions: [
            '방금 브리핑을 SGW 미팅메모로 저장해줘',
            '내 카카오톡으로 요약 보내줘',
            '프로젝트 달력 열어줘',
          ],
          selfRoomMessage: selfMsg,
          statusSnapshot: getKakaoFreeApiStatusForUser(input.userId),
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gemini EGO 실행 중 오류가 발생했습니다.';
      return {
        ok: false,
        statusCode: 502,
        error: `Gemini EGO 모델 호출 오류: ${msg}`,
      };
    }
  }

  // Transparent Deterministic Local EGO Rule Engine when GEMINI_API_KEY is not configured
  const plan = planDeterministicEgoWorkflow({ goal, todayDate, colleagues });
  let collectedDigestLines: string[] = [];

  for (const act of plan.actions) {
    if (act.kind === 'kakao_local_search') {
      const out = await executeSingleTool(
        input.userId,
        'kakao_local_search',
        { query: act.query ?? goal },
        integrationActions,
        todayDate,
      );
      toolExecutions.push(out.execution);
      if (out.execution.items && out.execution.items.length > 0) {
        collectedDigestLines.push(
          `[장소 검색] ` +
            out.execution.items
              .slice(0, 3)
              .map((i) => `${i.title}(${i.subtitle})`)
              .join(', '),
        );
      }
    } else if (
      act.kind === 'kakao_web_search' ||
      act.kind === 'kakao_blog_search' ||
      act.kind === 'kakao_book_search'
    ) {
      const kind =
        act.kind === 'kakao_book_search'
          ? 'book'
          : act.kind === 'kakao_blog_search'
            ? 'blog'
            : 'web';
      const out = await executeSingleTool(
        input.userId,
        'kakao_daum_search',
        { query: act.query ?? goal, kind },
        integrationActions,
        todayDate,
      );
      toolExecutions.push(out.execution);
      if (out.execution.items && out.execution.items.length > 0) {
        collectedDigestLines.push(
          `[다음 ${kind} 검색] ` +
            out.execution.items
              .slice(0, 3)
              .map((i) => i.title)
              .join(' / '),
        );
      }
    } else if (act.kind === 'sgw_colleague_lookup') {
      const out = await executeSingleTool(
        input.userId,
        'sgw_colleague_lookup',
        { query: act.query ?? '' },
        integrationActions,
        todayDate,
      );
      toolExecutions.push(out.execution);
    } else if (act.kind === 'sgw_leave_history') {
      const out = await executeSingleTool(
        input.userId,
        'sgw_leave_history',
        { query: act.query ?? goal },
        integrationActions,
        todayDate,
      );
      toolExecutions.push(out.execution);
    } else if (act.kind === 'sgw_leave_action' && act.leaveParsed) {
      const out = await executeSingleTool(
        input.userId,
        'sgw_leave_action',
        {
          type: act.leaveParsed.type,
          startDate: act.leaveParsed.startDate,
          endDate: act.leaveParsed.endDate,
          reason: act.leaveParsed.reason,
          autoExecute: Boolean(act.autoExecuteLeave),
        },
        integrationActions,
        todayDate,
      );
      toolExecutions.push(out.execution);
    } else if (act.kind === 'sgw_project_calendar') {
      const out = await executeSingleTool(
        input.userId,
        'sgw_project_calendar',
        {
          action: act.label.includes('등록') ? 'create' : 'view',
          title: act.title ?? goal,
          date: act.date ?? todayDate,
        },
        integrationActions,
        todayDate,
      );
      toolExecutions.push(out.execution);
    } else if (act.kind === 'sgw_meeting_memo') {
      const digest =
        collectedDigestLines.length > 0
          ? `${goal}\n\n${collectedDigestLines.join('\n')}`
          : act.content ?? goal;
      const out = await executeSingleTool(
        input.userId,
        'sgw_meeting_memo',
        {
          action: 'create',
          title: act.title ?? 'SGW EGO 미팅메모',
          content: digest,
        },
        integrationActions,
        todayDate,
      );
      toolExecutions.push(out.execution);
    } else if (act.kind === 'sgw_sedms_menu') {
      const out = await executeSingleTool(
        input.userId,
        'sgw_sedms_open',
        { menuKey: act.menuKey ?? 'dashboard', reason: act.content ?? goal },
        integrationActions,
        todayDate,
      );
      toolExecutions.push(out.execution);
    } else if (act.kind === 'kakao_calendar_list' || act.kind === 'kakao_calendar_create') {
      const out = await executeSingleTool(
        input.userId,
        'kakao_calendar_manage',
        {
          action: act.kind === 'kakao_calendar_create' ? 'create' : 'list',
          title: act.title,
          date: act.date,
        },
        integrationActions,
        todayDate,
      );
      toolExecutions.push(out.execution);
    } else if (act.kind === 'kakao_talk_memo') {
      const digest =
        collectedDigestLines.length > 0
          ? collectedDigestLines.join('\n')
          : toolExecutions.map((t) => `• ${t.label}: ${t.summary}`).join('\n') || goal;
      const out = await executeSingleTool(
        input.userId,
        'kakao_talk_send_memo',
        {
          title: act.title ?? `[SGW EGO] ${goal.slice(0, 30)}`,
          text: digest,
        },
        integrationActions,
        todayDate,
      );
      toolExecutions.push(out.execution);
    }
  }

  const summaryLines = toolExecutions.map((t) => {
    const badge = t.status === 'executed' ? '완료' : t.status === 'needs_config' ? '설정 필요' : '오류';
    return `[${badge}] ${t.label} — ${t.summary}`;
  });
  const finalAnswer =
    summaryLines.join('\n') ||
    '요청하신 목표에 대한 실행 계획을 완료했습니다.';

  const selfMsg =
    input.recordInSelfChat !== false
      ? postEgoSummaryToSelfRoom(input.userId, goal, finalAnswer)
      : undefined;

  return {
    ok: true,
    result: {
      goal,
      engine: 'sgw-rule-engine',
      planSteps: plan.planSteps,
      toolExecutions,
      finalAnswer,
      integrationActions,
      nextSuggestions: plan.nextSuggestions,
      selfRoomMessage: selfMsg,
      statusSnapshot: getKakaoFreeApiStatusForUser(input.userId),
    },
  };
}

function postEgoSummaryToSelfRoom(userId: string, goal: string, finalAnswer: string) {
  const selfRes = store.ensureSelfRoom(userId);
  if (!selfRes.room) return undefined;
  const added = store.addMessage({
    roomId: selfRes.room.id,
    senderId: 'u-bot',
    type: 'text',
    content: `🤖 [SGW EGO 자율 실행]\n목표: ${goal}\n\n${finalAnswer}`,
  });
  return added.message;
}
