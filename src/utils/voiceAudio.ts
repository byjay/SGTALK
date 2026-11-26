// Shared browser audio, singleton unlocked AudioContext, WebAudio playback fallback, and SpeechSynthesis helpers

let sharedAudioCtx: AudioContext | null = null;
let ttsTimerId: number | null = null;

function getAudioContextConstructor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ||
    null
  );
}

export function getSharedAudioContext(): AudioContext | null {
  try {
    const AudioCtx = getAudioContextConstructor();
    if (!AudioCtx) return null;
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new AudioCtx();
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

export async function unlockAudioPlayback(): Promise<AudioContext | null> {
  const ctx = getSharedAudioContext();
  if (!ctx) return null;
  try {
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    // Play a 1-sample silent tick synchronously inside user gesture to unlock mobile Web Audio output
    const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch {
    // ignore autoplay unlock errors
  }
  return ctx;
}

export function pickSupportedAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/wav',
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c));
}

export function dataUrlToBlobUrl(dataUrl: string): string | null {
  try {
    if (!dataUrl || !dataUrl.startsWith('data:')) return null;
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx < 0) return null;
    const header = dataUrl.slice(5, commaIdx);
    const mimeType = (header.split(';')[0] || 'audio/webm').trim();
    const base64 = dataUrl.slice(commaIdx + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

export function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer | null {
  try {
    if (!dataUrl || !dataUrl.startsWith('data:')) return null;
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx < 0) return null;
    const base64 = dataUrl.slice(commaIdx + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  } catch {
    return null;
  }
}

export interface MicAnalyserHandle {
  readNormalizedLevel: () => number;
  stop: () => void;
}

export function createMicAnalyser(stream: MediaStream): MicAnalyserHandle | null {
  try {
    const AudioCtx = getAudioContextConstructor();
    if (!AudioCtx) return null;
    const ctx = getSharedAudioContext() ?? new AudioCtx();
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);

    return {
      readNormalizedLevel: () => {
        analyser.getByteTimeDomainData(buf);
        let sumSq = 0;
        for (let i = 0; i < buf.length; i += 1) {
          const centered = (buf[i] - 128) / 128;
          sumSq += centered * centered;
        }
        const rms = Math.sqrt(sumSq / buf.length);
        return Math.min(1, Math.max(0.08, rms * 4.2));
      },
      stop: () => {
        try {
          source.disconnect();
          analyser.disconnect();
        } catch {
          // ignore
        }
      },
    };
  } catch {
    return null;
  }
}

function fillVoiceCadenceSamples(
  target: Float32Array,
  sampleRate: number,
  clampedSec: number,
  seedText: string,
): void {
  let hash = 0;
  for (let i = 0; i < seedText.length; i += 1) {
    hash = (hash * 31 + seedText.charCodeAt(i)) >>> 0;
  }
  const baseFreqs = [392, 440, 493.88, 523.25, 587.33];
  for (let i = 0; i < target.length; i += 1) {
    const t = i / sampleRate;
    const progress = t / clampedSec;
    const fadeIn = Math.min(1, t / 0.04);
    const fadeOut = Math.min(1, (clampedSec - t) / 0.08);

    const syllablePhase = (t * 3.2) % 1;
    const syllableEnv = syllablePhase < 0.72 ? Math.sin((syllablePhase / 0.72) * Math.PI) : 0.14;
    const stepIdx = Math.floor(t * 3.2 + (hash % 5)) % baseFreqs.length;
    const freq = baseFreqs[stepIdx];

    const fundamental = Math.sin(2 * Math.PI * freq * t);
    const harmonic = 0.35 * Math.sin(2 * Math.PI * freq * 1.5 * t);
    const gentleWarmth = 0.15 * Math.sin(2 * Math.PI * 220 * t + progress * 2);

    target[i] = Math.max(
      -0.95,
      Math.min(0.95, (fundamental + harmonic + gentleWarmth) * 0.36 * syllableEnv * fadeIn * fadeOut),
    );
  }
}

/**
 * Generates an audible, clean 16-bit PCM WAV data URI with cadence envelopes
 * derived from durationSec & seedText so voice messages ALWAYS produce audible output
 * even when an imported/seeded message lacks a recorded audio blob.
 */
export function synthesizeAudibleWavDataUrl(durationSec = 3, seedText = ''): string {
  const clampedSec = Math.max(1.2, Math.min(durationSec, 8));
  const sampleRate = 16000;
  const numSamples = Math.floor(sampleRate * clampedSec);
  const floatSamples = new Float32Array(numSamples);
  fillVoiceCadenceSamples(floatSamples, sampleRate, clampedSec, seedText);

  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) {
      view.setUint8(offset + i, s.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  for (let i = 0; i < numSamples; i += 1) {
    const int16 = Math.max(-32767, Math.min(32767, Math.round(floatSamples[i] * 32767)));
    view.setInt16(44 + i * 2, int16, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

export interface WebAudioPlaybackHandle {
  durationSec: number;
  setRate: (rate: number) => void;
  stop: () => void;
}

export async function playDataUrlWithWebAudio(
  audioDataUrl: string,
  options?: {
    rate?: number;
    startRatio?: number;
    onEnded?: () => void;
  },
): Promise<WebAudioPlaybackHandle | null> {
  const ctx = await unlockAudioPlayback();
  if (!ctx) return null;
  const arrayBuf = dataUrlToArrayBuffer(audioDataUrl);
  if (!arrayBuf) return null;

  try {
    const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = 1.0;
    source.buffer = decoded;
    source.playbackRate.value = Math.max(0.5, Math.min(2.5, options?.rate ?? 1));
    source.connect(gain);
    gain.connect(ctx.destination);

    let stopped = false;
    source.onended = () => {
      try {
        source.disconnect();
        gain.disconnect();
      } catch {
        // ignore
      }
      if (!stopped) {
        options?.onEnded?.();
      }
    };

    const offsetSec = Math.max(
      0,
      Math.min(decoded.duration - 0.05, decoded.duration * (options?.startRatio ?? 0)),
    );
    source.start(0, offsetSec);

    return {
      durationSec: decoded.duration || 1,
      setRate: (nextRate: number) => {
        try {
          source.playbackRate.value = Math.max(0.5, Math.min(2.5, nextRate));
        } catch {
          // ignore
        }
      },
      stop: () => {
        stopped = true;
        try {
          source.stop();
        } catch {
          // ignore
        }
      },
    };
  } catch {
    return null;
  }
}

export async function playSynthesizedVoiceWithWebAudio(
  durationSec: number,
  seedText: string,
  options?: {
    rate?: number;
    startRatio?: number;
    onEnded?: () => void;
  },
): Promise<WebAudioPlaybackHandle | null> {
  const ctx = await unlockAudioPlayback();
  if (!ctx) return null;

  try {
    const clampedSec = Math.max(1.2, Math.min(durationSec, 8));
    const sampleRate = ctx.sampleRate || 44100;
    const numSamples = Math.floor(sampleRate * clampedSec);
    const audioBuf = ctx.createBuffer(1, numSamples, sampleRate);
    fillVoiceCadenceSamples(audioBuf.getChannelData(0), sampleRate, clampedSec, seedText);

    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = 0.85;
    source.buffer = audioBuf;
    source.playbackRate.value = Math.max(0.5, Math.min(2.5, options?.rate ?? 1));
    source.connect(gain);
    gain.connect(ctx.destination);

    let stopped = false;
    source.onended = () => {
      try {
        source.disconnect();
        gain.disconnect();
      } catch {
        // ignore
      }
      if (!stopped) {
        options?.onEnded?.();
      }
    };

    const offsetSec = Math.max(
      0,
      Math.min(clampedSec - 0.05, clampedSec * (options?.startRatio ?? 0)),
    );
    source.start(0, offsetSec);

    return {
      durationSec: clampedSec,
      setRate: (nextRate: number) => {
        try {
          source.playbackRate.value = Math.max(0.5, Math.min(2.5, nextRate));
        } catch {
          // ignore
        }
      },
      stop: () => {
        stopped = true;
        try {
          source.stop();
        } catch {
          // ignore
        }
      },
    };
  } catch {
    return null;
  }
}

export function playVoiceCueTone(kind: 'start' | 'stop' | 'click' | 'notify'): void {
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';

    if (kind === 'start') {
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.14);
    } else if (kind === 'stop') {
      osc.frequency.setValueAtTime(659.25, now);
      osc.frequency.exponentialRampToValueAtTime(440, now + 0.16);
    } else if (kind === 'notify') {
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.setValueAtTime(783.99, now + 0.09);
    } else {
      osc.frequency.setValueAtTime(540, now);
    }

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.24);
  } catch {
    // ignore audio autoplay restrictions
  }
}

export function stopAllSpeechSynthesis(): void {
  try {
    if (ttsTimerId !== null) {
      window.clearTimeout(ttsTimerId);
      ttsTimerId = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
        window.speechSynthesis.cancel();
      }
    }
  } catch {
    // ignore
  }
}

export function speakKoreanVoiceText(
  text: string,
  options?: {
    rate?: number;
    onStart?: () => void;
    onEnd?: () => void;
    onError?: () => void;
  },
): boolean {
  const clean = String(text ?? '').trim();
  if (!clean || typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return false;
  }
  try {
    if (ttsTimerId !== null) {
      window.clearTimeout(ttsTimerId);
      ttsTimerId = null;
    }
    const synth = window.speechSynthesis;
    const needsDelayAfterCancel = synth.speaking || synth.pending;
    if (needsDelayAfterCancel) {
      synth.cancel();
    }

    const doSpeak = () => {
      try {
        const utter = new SpeechSynthesisUtterance(clean);
        utter.lang = 'ko-KR';
        utter.rate = Math.max(0.75, Math.min(2.0, options?.rate ?? 1.05));
        utter.volume = 1.0;

        const voices = synth.getVoices();
        const koVoice = voices.find((v) => v.lang.toLowerCase().startsWith('ko'));
        if (koVoice) {
          utter.voice = koVoice;
        }

        if (options?.onStart) utter.onstart = options.onStart;
        if (options?.onEnd) utter.onend = options.onEnd;
        if (options?.onError) utter.onerror = options.onError;

        synth.speak(utter);
      } catch {
        options?.onError?.();
      }
    };

    if (needsDelayAfterCancel) {
      ttsTimerId = window.setTimeout(() => {
        ttsTimerId = null;
        doSpeak();
      }, 45);
    } else {
      doSpeak();
    }
    return true;
  } catch {
    return false;
  }
}

let emergencyAlertStopper: (() => void) | null = null;

export function stopEmergencyAlertSound(): void {
  try {
    emergencyAlertStopper?.();
  } catch {
    // ignore
  }
  emergencyAlertStopper = null;
}

/**
 * Plays a distinct Korean CBS-style two-tone emergency disaster alert chime via Web Audio API.
 */
export function playEmergencyAlertSound(): void {
  try {
    stopEmergencyAlertSound();
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }

    const activeOscs: OscillatorNode[] = [];
    const now = ctx.currentTime;
    // Two emergency attention pulses (880Hz + 987.77Hz / 659Hz alternating urgent cadence)
    const bursts = [
      { start: 0.0, dur: 0.24, f1: 880, f2: 960 },
      { start: 0.30, dur: 0.24, f1: 880, f2: 960 },
      { start: 0.64, dur: 0.34, f1: 987.77, f2: 783.99 },
    ];

    for (const b of bursts) {
      const oscA = ctx.createOscillator();
      const oscB = ctx.createOscillator();
      const gain = ctx.createGain();

      oscA.type = 'triangle';
      oscB.type = 'sine';
      oscA.frequency.setValueAtTime(b.f1, now + b.start);
      oscB.frequency.setValueAtTime(b.f2, now + b.start);

      gain.gain.setValueAtTime(0.001, now + b.start);
      gain.gain.exponentialRampToValueAtTime(0.24, now + b.start + 0.025);
      gain.gain.setValueAtTime(0.22, now + b.start + b.dur - 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + b.start + b.dur);

      oscA.connect(gain);
      oscB.connect(gain);
      gain.connect(ctx.destination);

      oscA.start(now + b.start);
      oscB.start(now + b.start);
      oscA.stop(now + b.start + b.dur + 0.02);
      oscB.stop(now + b.start + b.dur + 0.02);

      activeOscs.push(oscA, oscB);
    }

    const timer = window.setTimeout(() => {
      emergencyAlertStopper = null;
    }, 1200);

    emergencyAlertStopper = () => {
      window.clearTimeout(timer);
      for (const osc of activeOscs) {
        try {
          osc.stop();
          osc.disconnect();
        } catch {
          // ignore
        }
      }
    };
  } catch {
    // ignore autoplay restriction errors
  }
}

export function triggerBrowserEmergencyNotification(
  title: string,
  body: string,
  onClick?: () => void,
): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  try {
    const show = () => {
      const notif = new Notification(title, {
        body,
        tag: `sg-talk-urgent-${Date.now()}`,
        requireInteraction: true,
      });
      if (onClick) {
        notif.onclick = () => {
          try {
            window.focus();
          } catch {
            // ignore
          }
          onClick();
          notif.close();
        };
      }
    };
    if (Notification.permission === 'granted') {
      show();
    }
  } catch {
    // ignore environments blocking Notification API
  }
}

export function mapSpeechRecognitionError(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return '마이크 권한이 차단되어 있어 녹음 파일 기반 AI 음성 분석 모드로 전환하거나 브라우저 마이크 허용이 필요합니다.';
    case 'no-speech':
      return '음성이 감지되지 않았습니다. 마이크 가까이에서 다시 말씀해 주세요.';
    case 'audio-capture':
      return '연결된 마이크 입력 장치를 찾을 수 없습니다.';
    case 'network':
      return '브라우저 음성인식 서버 연결이 원활하지 않아 녹음 후 서버 AI 분석으로 전환합니다.';
    default:
      return '브라우저 음성인식이 중단되었습니다. 녹음 전송이나 텍스트 입력을 이용하실 수 있습니다.';
  }
}
