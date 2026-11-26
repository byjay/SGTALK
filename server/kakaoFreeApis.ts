import { getUserKakaoGrant } from './security';
import type { KakaoFreeApiStatus } from '../src/shared/types';

export interface KakaoPlaceItem {
  id: string;
  placeName: string;
  categoryName: string;
  phone: string;
  addressName: string;
  roadAddressName: string;
  placeUrl: string;
  x: string;
  y: string;
}

export interface KakaoSearchDocItem {
  title: string;
  contents: string;
  url: string;
  subtitle?: string;
  datetime?: string;
}

export interface KakaoApiResult<T> {
  status: 'executed' | 'needs_config' | 'error';
  data?: T;
  message: string;
}

function stripHtmlTags(raw: string): string {
  return String(raw ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

export function getKakaoRestApiKey(): string {
  return (process.env.KAKAO_REST_API_KEY || '').trim();
}

export function getKakaoFreeApiStatusForUser(userId?: string): KakaoFreeApiStatus {
  const grant = userId ? getUserKakaoGrant(userId) : null;
  return {
    restApiConfigured: Boolean(getKakaoRestApiKey()),
    kakaoTalkLinked: Boolean(grant),
    linkedScopes: grant?.scopes ?? [],
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
  };
}

export async function searchKakaoLocalPlaces(
  rawQuery: string,
  size = 5,
): Promise<KakaoApiResult<KakaoPlaceItem[]>> {
  const apiKey = getKakaoRestApiKey();
  if (!apiKey) {
    return {
      status: 'needs_config',
      message:
        '카카오 로컬 무료 API 사용을 위해 Secrets에 KAKAO_REST_API_KEY(카카오 개발자센터 REST API 키)를 설정해 주세요.',
    };
  }

  const query = String(rawQuery ?? '').trim().slice(0, 120);
  if (!query) {
    return { status: 'error', message: '검색할 장소 또는 키워드를 입력해 주세요.' };
  }

  const safeSize = Math.max(1, Math.min(10, Math.round(size)));
  const url = new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
  url.searchParams.set('query', query);
  url.searchParams.set('size', String(safeSize));

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `KakaoAK ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return {
        status: 'error',
        message: `카카오 로컬 검색 API 응답 오류 (HTTP ${res.status})`,
      };
    }
    const json = (await res.json()) as {
      documents?: Array<{
        id?: string;
        place_name?: string;
        category_name?: string;
        phone?: string;
        address_name?: string;
        road_address_name?: string;
        place_url?: string;
        x?: string;
        y?: string;
      }>;
    };
    const items: KakaoPlaceItem[] = (json.documents ?? []).map((d) => ({
      id: String(d.id ?? ''),
      placeName: String(d.place_name ?? ''),
      categoryName: String(d.category_name ?? ''),
      phone: String(d.phone ?? ''),
      addressName: String(d.address_name ?? ''),
      roadAddressName: String(d.road_address_name ?? ''),
      placeUrl: String(d.place_url ?? ''),
      x: String(d.x ?? ''),
      y: String(d.y ?? ''),
    }));
    return {
      status: 'executed',
      data: items,
      message:
        items.length > 0
          ? `카카오 로컬 무료 API로 "${query}" 장소 ${items.length}건을 찾았습니다.`
          : `"${query}"에 일치하는 카카오 로컬 장소 결과가 없습니다.`,
    };
  } catch {
    return { status: 'error', message: '카카오 로컬 검색 API 연결에 실패했습니다.' };
  }
}

export async function searchKakaoDaum(
  rawQuery: string,
  kind: 'web' | 'blog' | 'book' = 'web',
  size = 5,
): Promise<KakaoApiResult<KakaoSearchDocItem[]>> {
  const apiKey = getKakaoRestApiKey();
  if (!apiKey) {
    return {
      status: 'needs_config',
      message:
        '카카오 다음 무료 검색 API(웹·블로그·도서) 사용을 위해 Secrets에 KAKAO_REST_API_KEY를 설정해 주세요.',
    };
  }

  const query = String(rawQuery ?? '').trim().slice(0, 120);
  if (!query) {
    return { status: 'error', message: '검색할 키워드를 입력해 주세요.' };
  }

  const safeSize = Math.max(1, Math.min(10, Math.round(size)));
  const endpoint =
    kind === 'book'
      ? 'https://dapi.kakao.com/v3/search/book'
      : kind === 'blog'
        ? 'https://dapi.kakao.com/v2/search/blog'
        : 'https://dapi.kakao.com/v2/search/web';

  const url = new URL(endpoint);
  url.searchParams.set('query', query);
  url.searchParams.set('size', String(safeSize));

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `KakaoAK ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return {
        status: 'error',
        message: `카카오 다음(${kind}) 검색 API 응답 오류 (HTTP ${res.status})`,
      };
    }
    const json = (await res.json()) as {
      documents?: Array<{
        title?: string;
        contents?: string;
        url?: string;
        blogname?: string;
        authors?: string[];
        publisher?: string;
        datetime?: string;
      }>;
    };
    const items: KakaoSearchDocItem[] = (json.documents ?? []).map((d) => ({
      title: stripHtmlTags(d.title ?? ''),
      contents: stripHtmlTags(d.contents ?? '').slice(0, 160),
      url: String(d.url ?? ''),
      subtitle:
        kind === 'book'
          ? [d.authors?.join(', '), d.publisher].filter(Boolean).join(' · ')
          : d.blogname || undefined,
      datetime: d.datetime,
    }));
    return {
      status: 'executed',
      data: items,
      message:
        items.length > 0
          ? `카카오 다음 ${kind === 'book' ? '도서' : kind === 'blog' ? '블로그' : '웹'} 무료 API로 ${items.length}건을 조회했습니다.`
          : `"${query}"에 대한 다음 검색 결과가 없습니다.`,
    };
  } catch {
    return { status: 'error', message: '카카오 다음 검색 API 연결에 실패했습니다.' };
  }
}

export async function sendKakaoTalkMemoToMe(
  userId: string,
  input: { title: string; text: string; webUrl?: string },
): Promise<KakaoApiResult<{ resultCode: number }>> {
  const grant = getUserKakaoGrant(userId);
  if (!grant) {
    return {
      status: 'needs_config',
      message:
        '카카오톡 "나에게 보내기"를 실행하려면 상단 [카톡·캘린더 연동] 버튼으로 Kakao talk_message 동의를 연결해 주세요.',
    };
  }

  const safeText = `${input.title ? `${input.title}\n` : ''}${input.text}`.trim().slice(0, 1000);
  const templateObject = {
    object_type: 'text',
    text: safeText,
    link: {
      web_url: input.webUrl || process.env.APP_URL?.trim() || 'https://developers.kakao.com',
      mobile_web_url: input.webUrl || process.env.APP_URL?.trim() || 'https://developers.kakao.com',
    },
    button_title: 'SG Talk 열기',
  };

  try {
    const body = new URLSearchParams({
      template_object: JSON.stringify(templateObject),
    });
    const res = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${grant.accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        status: res.status === 401 || res.status === 403 ? 'needs_config' : 'error',
        message:
          res.status === 403
            ? '카카오 개발자센터에서 talk_message(카카오톡 메시지 전송) 동의항목을 활성화한 뒤 다시 연동해 주세요.'
            : `카카오톡 나에게 보내기 실패 (HTTP ${res.status})${errText ? `: ${errText.slice(0, 80)}` : ''}`,
      };
    }
    const json = (await res.json()) as { result_code?: number };
    return {
      status: 'executed',
      data: { resultCode: json.result_code ?? 0 },
      message: '내 카카오톡("나에게 보내기")으로 브리핑 메시지를 전송했습니다.',
    };
  } catch {
    return { status: 'error', message: '카카오톡 메시지 전송 서버와 통신하지 못했습니다.' };
  }
}

export async function manageKakaoCalendar(
  userId: string,
  action: 'list' | 'create',
  payload?: { title?: string; date?: string; description?: string },
): Promise<KakaoApiResult<Array<{ id: string; title: string; startAt?: string }>>> {
  const grant = getUserKakaoGrant(userId);
  if (!grant) {
    return {
      status: 'needs_config',
      message:
        '카카오 톡캘린더 무료 API를 사용하려면 상단 [카톡·캘린더 연동] 버튼으로 talk_calendar 동의를 연결해 주세요.',
    };
  }

  try {
    if (action === 'list') {
      const now = new Date();
      const from = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const to = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
      const url = new URL('https://kapi.kakao.com/v2/api/calendar/events');
      url.searchParams.set('from', from);
      url.searchParams.set('to', to);
      url.searchParams.set('limit', '10');

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${grant.accessToken}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        return {
          status: res.status === 401 || res.status === 403 ? 'needs_config' : 'error',
          message:
            res.status === 403
              ? '카카오 개발자센터에서 talk_calendar(톡캘린더) 동의항목 활성화 후 다시 연동해 주세요.'
              : `톡캘린더 조회 실패 (HTTP ${res.status})`,
        };
      }
      const json = (await res.json()) as {
        events?: Array<{ id?: string; title?: string; time?: { start_at?: string } }>;
      };
      const events = (json.events ?? []).map((ev) => ({
        id: String(ev.id ?? ''),
        title: String(ev.title ?? '일정'),
        startAt: ev.time?.start_at,
      }));
      return {
        status: 'executed',
        data: events,
        message: `카카오 톡캘린더에서 일정 ${events.length}건을 조회했습니다.`,
      };
    }

    const baseDate = payload?.date || new Date().toISOString().slice(0, 10);
    const startAt = `${baseDate}T09:00:00Z`;
    const endAt = `${baseDate}T10:00:00Z`;
    const eventObj = {
      title: (payload?.title || 'SGW EGO 일정').slice(0, 50),
      time: {
        start_at: startAt,
        end_at: endAt,
        time_zone: 'Asia/Seoul',
        all_day: false,
      },
      description: (payload?.description || 'SGW EGO 에이전트 자동 등록').slice(0, 300),
    };
    const body = new URLSearchParams({
      calendar_id: 'primary',
      event: JSON.stringify(eventObj),
    });
    const res = await fetch('https://kapi.kakao.com/v2/api/calendar/create/event', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${grant.accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return {
        status: res.status === 401 || res.status === 403 ? 'needs_config' : 'error',
        message:
          res.status === 403
            ? '카카오 개발자센터에서 talk_calendar 쓰기 권한을 활성화해 주세요.'
            : `톡캘린더 일정 생성 실패 (HTTP ${res.status})`,
      };
    }
    const created = (await res.json()) as { event_id?: string };
    return {
      status: 'executed',
      data: [{ id: String(created.event_id ?? ''), title: eventObj.title, startAt }],
      message: `카카오 톡캘린더에 "${eventObj.title}" 일정을 등록했습니다.`,
    };
  } catch {
    return { status: 'error', message: '카카오 톡캘린더 API 통신 중 오류가 발생했습니다.' };
  }
}
