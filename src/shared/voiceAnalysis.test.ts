import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeVoiceTranscriptPure,
  buildFallbackMessageTranslationOrSummary,
  validateLargeFileLinkInput,
} from './voiceAnalysis';

test('analyzeVoiceTranscriptPure detects leave intent and extracts keywords/actions', () => {
  const res = analyzeVoiceTranscriptPure('내일 오전반차 등록하고 김민준 팀장님께 공유해 주세요', 4);
  assert.equal(res.detectedIntent, 'leave');
  assert.equal(res.suggestedMenuKey, 'leave');
  assert.ok(res.keywords.length >= 1);
  assert.ok(res.actionItems.some((a) => a.includes('연차')));
  assert.equal(res.engine, 'sgw-voice-engine');
});

test('analyzeVoiceTranscriptPure detects bigmail/bmail and meeting_memo intents', () => {
  const mailRes = analyzeVoiceTranscriptPure('빅메일로 온 설계서 첨부 메일 요약해서 열어줘', 5);
  assert.equal(mailRes.detectedIntent, 'mail');
  assert.equal(mailRes.suggestedMenuKey, 'bmail');

  const memoRes = analyzeVoiceTranscriptPure('방금 회의 내용을 미팅메모로 정리해 줘', 6);
  assert.equal(memoRes.detectedIntent, 'meeting_memo');
  assert.equal(memoRes.suggestedMenuKey, 'meeting-memo');
});

test('buildFallbackMessageTranslationOrSummary handles English translation and Korean summary', () => {
  const tr = buildFallbackMessageTranslationOrSummary('Please review the urgent approval attachment.', 'translate');
  assert.equal(tr.detectedLanguage, 'en');
  assert.ok(tr.resultText.includes('한글 번역'));

  const sum = buildFallbackMessageTranslationOrSummary('오늘 오후 3시에 전사 보안 점검이 있습니다. 모든 팀원은 참석 바랍니다.', 'summary');
  assert.equal(sum.detectedLanguage, 'ko');
  assert.ok(sum.resultText.includes('핵심 요약'));
});

test('validateLargeFileLinkInput validates URLs and computes size & expiry', () => {
  const bad = validateLargeFileLinkInput({
    filename: '모델.zip',
    externalUrl: 'javascript:alert(1)',
    sizeMB: 250,
  });
  assert.equal(bad.ok, false);

  const ok = validateLargeFileLinkInput({
    filename: '2026_CAD_조립도_v3.zip',
    externalUrl: 'https://cdn.sgw.co.kr/releases/cad-v3.zip',
    sizeMB: 480,
    expiresDays: 7,
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.sizeBytes, 480 * 1024 * 1024);
    assert.equal(ok.filename, '2026_CAD_조립도_v3.zip');
  }

  const large100gb = validateLargeFileLinkInput({
    filename: '모델_학습데이터_100GB.tar.zst',
    externalUrl: 'https://storage.example.com/datasets/train.tar.zst',
    sizeValue: 100,
    sizeUnit: 'GB',
    expiresDays: 30,
    shareProvider: 's3',
    passcode: '2026',
    maxDownloads: 10,
  });
  assert.equal(large100gb.ok, true);
  if (large100gb.ok) {
    assert.equal(large100gb.sizeBytes, 100 * 1024 * 1024 * 1024);
    assert.equal(large100gb.shareProvider, 's3');
    assert.equal(large100gb.passcode, '2026');
    assert.equal(large100gb.maxDownloads, 10);
  }

  const ssrfBlocked = validateLargeFileLinkInput({
    filename: 'secret.zip',
    externalUrl: 'http://169.254.169.254/latest/meta-data/',
    sizeValue: 100,
    sizeUnit: 'GB',
  });
  assert.equal(ssrfBlocked.ok, false);

  const shortPin = validateLargeFileLinkInput({
    filename: 'archive.zip',
    externalUrl: 'https://cdn.example.com/archive.zip',
    sizeValue: 100,
    sizeUnit: 'GB',
    passcode: '12',
  });
  assert.equal(shortPin.ok, false);
});
