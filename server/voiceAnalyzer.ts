import { GoogleGenAI, Type } from '@google/genai';
import {
  analyzeVoiceTranscriptPure,
  buildFallbackMessageTranslationOrSummary,
} from '../src/shared/voiceAnalysis';
import { summarizeMailBodyPure } from '../src/shared/controlTower';
import type { MailMessage, SedmsMenuKey, VoiceAnalysisResult } from '../src/shared/types';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function parseDataUrlAudio(dataUrl: string): { mimeType: string; base64: string } | null {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:([^,;]+)(?:;[^,]*)?;base64,(.+)$/i);
  if (!match) return null;
  const mimeType = match[1].split(';')[0].trim().toLowerCase();
  const base64 = match[2].trim();
  if (!base64 || base64.length < 32) return null;
  return { mimeType, base64 };
}

export async function analyzeVoicePayload(input: {
  audioDataUrl?: string;
  mimeType?: string;
  transcript?: string;
  durationSec?: number;
}): Promise<{
  transcript: string;
  analysis: VoiceAnalysisResult;
  sttUsed: 'gemini-3.5-transcribe' | 'browser-or-transcript';
}> {
  const ai = getGeminiClient();
  let transcript = String(input.transcript ?? '').replace(/\s+/g, ' ').trim();
  let sttUsed: 'gemini-3.5-transcribe' | 'browser-or-transcript' = 'browser-or-transcript';

  // 1. Server-side STT via gemini-3.5-transcribe when audioDataUrl is provided & Gemini is configured
  const parsedAudio = input.audioDataUrl ? parseDataUrlAudio(input.audioDataUrl) : null;
  if (ai && parsedAudio && (!transcript || transcript === '(음성 녹음)' || transcript.length < 4)) {
    const cleanMime = (input.mimeType || parsedAudio.mimeType || 'audio/webm').split(';')[0].trim().toLowerCase();
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: [
          {
            inlineData: {
              mimeType: cleanMime || 'audio/webm',
              data: parsedAudio.base64,
            },
          },
          {
            text: '이 한국어/영어 업무 음성 메시지의 발화 내용을 구두점 포함하여 정확히 그대로 받아 적어 주세요. 설명 없이 전사 문장만 출력하세요.',
          },
        ],
      });
      const sttText = response.text?.trim();
      if (sttText && sttText.length > 0) {
        transcript = sttText;
        sttUsed = 'gemini-3.5-transcribe';
      }
    } catch {
      // Fall back gracefully to client transcript
    }
  }

  // 2. Structured Voice Analysis via gemini-4-hydrogen (fallback to pure deterministic analyzer)
  const fallback = analyzeVoiceTranscriptPure(transcript, input.durationSec ?? 3);

  if (!ai || !transcript) {
    return {
      transcript,
      analysis: fallback,
      sttUsed,
    };
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `다음 사내 메신저 음성 전사 내용을 분석해 요약, 핵심 키워드(최대 4개), 후속 실행 항목(최대 3개), 업무 의도를 JSON으로 반환하세요.\n\n음성 전사:\n"${transcript}"`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
            actionItems: { type: Type.ARRAY, items: { type: Type.STRING } },
            detectedIntent: { type: Type.STRING },
            suggestedMenuKey: { type: Type.STRING },
          },
          required: ['summary', 'keywords', 'actionItems', 'detectedIntent'],
        },
      },
    });

    const json = JSON.parse(response.text || '{}') as Partial<VoiceAnalysisResult>;
    const allowedIntents = new Set([
      'leave',
      'calendar',
      'meeting_memo',
      'meeting',
      'mail',
      'notice',
      'general',
    ]);
    const allowedMenus = new Set<SedmsMenuKey>([
      'dashboard',
      'leave',
      'approval',
      'document',
      'project',
      'project-calendar',
      'meeting-memo',
      'meeting',
      'attendance',
      'bmail',
      'directory',
    ]);

    const analysis: VoiceAnalysisResult = {
      summary: typeof json.summary === 'string' && json.summary.trim() ? json.summary.trim() : fallback.summary,
      keywords:
        Array.isArray(json.keywords) && json.keywords.length > 0
          ? json.keywords.map(String).slice(0, 5)
          : fallback.keywords,
      actionItems:
        Array.isArray(json.actionItems) && json.actionItems.length > 0
          ? json.actionItems.map(String).slice(0, 3)
          : fallback.actionItems,
      detectedIntent:
        json.detectedIntent && allowedIntents.has(json.detectedIntent)
          ? json.detectedIntent
          : fallback.detectedIntent,
      suggestedMenuKey:
        json.suggestedMenuKey && allowedMenus.has(json.suggestedMenuKey as SedmsMenuKey)
          ? (json.suggestedMenuKey as SedmsMenuKey)
          : fallback.suggestedMenuKey,
      analyzedAt: new Date().toISOString(),
      engine: 'gemini-4-hydrogen',
    };

    return {
      transcript,
      analysis,
      sttUsed,
    };
  } catch {
    return {
      transcript,
      analysis: fallback,
      sttUsed,
    };
  }
}

export async function analyzeChatMessageQuick(input: {
  content: string;
  mode?: 'translate' | 'summary';
}): Promise<{
  mode: 'translate' | 'summary';
  resultText: string;
  engine: 'gemini-4-hydrogen' | 'sgw-voice-engine';
}> {
  const mode = input.mode === 'translate' ? 'translate' : 'summary';
  const fallback = buildFallbackMessageTranslationOrSummary(input.content, mode);
  const ai = getGeminiClient();

  if (!ai || !input.content.trim()) {
    return {
      mode,
      resultText: fallback.resultText,
      engine: 'sgw-voice-engine',
    };
  }

  try {
    const instruction =
      mode === 'translate'
        ? '다음 사내 메신저 메시지를 한국어(영문인 경우 자연스러운 한국어로) 또는 영문(한국어인 경우 간결한 비즈니스 영어로) 번역·요약하세요. 2문장 이내로 출력하세요.'
        : '다음 사내 메신저 메시지의 핵심 요점과 요청 사항만 1~2문장으로 간결하게 한국어로 요약하세요.';
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `${instruction}\n\n원문:\n${input.content}`,
    });
    const text = response.text?.trim();
    if (text) {
      return {
        mode,
        resultText: text,
        engine: 'gemini-4-hydrogen',
      };
    }
  } catch {
    // Fallback
  }

  return {
    mode,
    resultText: fallback.resultText,
    engine: 'sgw-voice-engine',
  };
}

export async function summarizeMailContent(input: {
  mail: MailMessage;
  senderName: string;
}): Promise<{
  bullets: string[];
  engine: 'gemini-4-hydrogen' | 'sgw-control-tower';
}> {
  const fallback = summarizeMailBodyPure(input.mail, input.senderName);
  const ai = getGeminiClient();
  if (!ai) {
    return { bullets: fallback, engine: 'sgw-control-tower' };
  }

  try {
    const attNames = (input.mail.attachments ?? []).map((a) => a.filename).join(', ');
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `다음 사내 메일(출처: ${input.mail.provider === 'bigmail' ? '빅메일' : '비메일'})을 임직원 브리핑용 한국어 3줄 핵심 요약으로 정리하세요.\n발신: ${input.senderName}\n제목: ${input.mail.subject}\n첨부: ${attNames || '없음'}\n본문:\n${input.mail.body}`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            bullets: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['bullets'],
        },
      },
    });
    const parsed = JSON.parse(response.text || '{}') as { bullets?: unknown };
    if (Array.isArray(parsed.bullets) && parsed.bullets.length > 0) {
      return {
        bullets: parsed.bullets.map(String).slice(0, 3),
        engine: 'gemini-4-hydrogen',
      };
    }
  } catch {
    // Fallback
  }

  return { bullets: fallback, engine: 'sgw-control-tower' };
}
