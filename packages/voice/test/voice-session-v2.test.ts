// === FILE START ===
// packages/voice/test/voice-session-v2.test.ts
// PRD §14.1 · FR-VOICE-02 · F-163 · T-VOICE gate.
//
// The T-VOICE gate:
//   · interrupt() completes in ≤ 300 ms wall clock from user action to
//     'stopped' state
//   · state machine rejects invalid transitions
//   · pause/resume/correct/change-subject behave as PRD §14.1
//   · captions: the text being spoken is always what speak() received

import { describe, it, expect } from 'vitest';
import {
  VoiceSession,
  VoiceSessionError,
  type VoiceSessionEvent,
} from '../src/voice-session-v2.js';
import { createInMemoryTtsBackend } from '../src/tts-v2.js';
import { createInMemorySttBackend } from '../src/stt-v2.js';

const FIXED_NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
const now = () => FIXED_NOW;

function makeSession() {
  const { backend: tts, log: ttsLog } = createInMemoryTtsBackend();
  const sttCtl = createInMemorySttBackend({ supported: true });
  const session = new VoiceSession({ tts, stt: sttCtl.backend, now });
  return { session, tts, ttsLog, sttCtl };
}

// =============================================================================
// T-VOICE.1 — Interrupt ≤ 300 ms (the gate)
// =============================================================================

describe('T-VOICE.1 — GATE: interrupt completes in ≤ 300 ms', () => {
  it('stop() from speaking transitions to stopped in < 300 ms', () => {
    const { session } = makeSession();
    session.startListening();
    session.finishListening('hello world');
    session.speak('Hello world.');

    const t0 = performance.now();
    session.stop();
    const t1 = performance.now();

    expect(t1 - t0).toBeLessThan(300);
    expect(session.snapshot().state).toBe('stopped');
  });

  it('stop() from listening also completes in < 300 ms', () => {
    const { session } = makeSession();
    session.startListening();
    const t0 = performance.now();
    session.stop();
    const t1 = performance.now();
    expect(t1 - t0).toBeLessThan(300);
    expect(session.snapshot().state).toBe('stopped');
  });

  it('stop() from thinking completes in < 300 ms', () => {
    const { session } = makeSession();
    session.startListening();
    session.finishListening('hi');
    const t0 = performance.now();
    session.stop();
    const t1 = performance.now();
    expect(t1 - t0).toBeLessThan(300);
    expect(session.snapshot().state).toBe('stopped');
  });

  it('stop() from paused completes in < 300 ms', () => {
    const { session } = makeSession();
    session.startListening();
    session.finishListening('hi');
    session.speak('Hi.');
    session.pause();
    const t0 = performance.now();
    session.stop();
    const t1 = performance.now();
    expect(t1 - t0).toBeLessThan(300);
    expect(session.snapshot().state).toBe('stopped');
  });
});

// =============================================================================
// T-VOICE.2 — Interrupt cancels TTS and STT
// =============================================================================

describe('T-VOICE.2 — stop() cancels TTS and STT', () => {
  it('cancels TTS', () => {
    const { session, ttsLog } = makeSession();
    session.startListening();
    session.finishListening('hi');
    session.speak('Hi.');
    session.stop();
    expect(ttsLog.cancels).toBeGreaterThanOrEqual(1);
  });

  it('aborts STT when listening', () => {
    const { session, sttCtl } = makeSession();
    session.startListening();
    session.stop();
    expect(sttCtl.state.aborted).toBe(true);
  });

  it('idempotent — calling stop() twice does not throw', () => {
    const { session } = makeSession();
    session.startListening();
    session.stop();
    expect(() => session.stop()).not.toThrow();
    expect(session.snapshot().state).toBe('stopped');
  });
});

// =============================================================================
// T-VOICE.3 — Pause / resume from character offset
// =============================================================================

describe('T-VOICE.3 — pause / resume', () => {
  it('pause from speaking → paused', () => {
    const { session } = makeSession();
    session.startListening();
    session.finishListening('hello');
    session.speak('Hello world.');
    session.pause();
    expect(session.snapshot().state).toBe('paused');
  });

  it('pause invokes TTS.pause', () => {
    const { session, ttsLog } = makeSession();
    session.startListening();
    session.finishListening('x');
    session.speak('x.');
    session.pause();
    expect(ttsLog.pauses).toBe(1);
  });

  it('resume from paused → speaking and speaks from the recorded offset', () => {
    const { session, ttsLog } = makeSession();
    const full = 'The answer is 42.';
    session.startListening();
    session.finishListening('x');
    session.speak(full);

    // Simulate TTS having progressed to char 14 ('The answer is ')
    session.markSpokenCharIndex(14);
    session.pause();
    session.resume();

    // The last speak() call must be the remainder, not the full text.
    const lastSpeak = ttsLog.speaks[ttsLog.speaks.length - 1]!;
    expect(lastSpeak.text).toBe(full.slice(14));
    expect(lastSpeak.text).toBe('42.');
  });

  it('resume invokes TTS.resume', () => {
    const { session, ttsLog } = makeSession();
    session.startListening();
    session.finishListening('x');
    session.speak('x.');
    session.pause();
    session.resume();
    expect(ttsLog.resumes).toBe(1);
  });

  it('resume from non-paused throws VoiceSessionError', () => {
    const { session } = makeSession();
    session.startListening();
    session.finishListening('x');
    expect(() => session.resume()).toThrow(VoiceSessionError);
  });
});

// =============================================================================
// T-VOICE.4 — Correction recording
// =============================================================================

describe('T-VOICE.4 — correct() records and resets offset', () => {
  it('records the correction note', () => {
    const { session } = makeSession();
    session.startListening();
    session.finishListening('x');
    session.speak('Long answer.');
    session.correct('no, the second one');
    const snap = session.snapshot();
    expect(snap.corrections).toEqual(['no, the second one']);
  });

  it('resets lastSpokenCharIndex so next speak starts fresh', () => {
    const { session } = makeSession();
    session.startListening();
    session.finishListening('x');
    session.speak('First answer.');
    session.markSpokenCharIndex(10);
    session.correct('pick option 2');
    expect(session.snapshot().lastSpokenCharIndex).toBe(0);
  });

  it('emits a correction event', () => {
    const { session } = makeSession();
    const events: VoiceSessionEvent[] = [];
    session.subscribe((e) => events.push(e));
    session.startListening();
    session.correct('pick B');
    const correctionEvent = events.find((e) => e.type === 'correction');
    expect(correctionEvent).toBeDefined();
    expect(correctionEvent!.detail).toBe('pick B');
  });

  it('multiple corrections accumulate', () => {
    const { session } = makeSession();
    session.correct('a');
    session.correct('b');
    expect(session.snapshot().corrections).toEqual(['a', 'b']);
  });
});

// =============================================================================
// T-VOICE.5 — Change subject
// =============================================================================

describe('T-VOICE.5 — changeSubject()', () => {
  it('clears the current text and offset', () => {
    const { session } = makeSession();
    session.startListening();
    session.finishListening('talk about A');
    session.speak('Here is a long answer about A.');
    session.markSpokenCharIndex(20);
    session.changeSubject();
    const snap = session.snapshot();
    expect(snap.text).toBe('');
    expect(snap.lastSpokenCharIndex).toBe(0);
  });

  it('does not stop the session — new topic can begin', () => {
    const { session } = makeSession();
    session.startListening();
    session.finishListening('a');
    session.speak('answer a.');
    session.changeSubject();
    expect(session.snapshot().state).toBe('idle');
    // Can start listening again without error.
    expect(() => session.startListening()).not.toThrow();
  });

  it('cancels TTS when speaking', () => {
    const { session, ttsLog } = makeSession();
    session.startListening();
    session.finishListening('a');
    session.speak('answer.');
    const before = ttsLog.cancels;
    session.changeSubject();
    expect(ttsLog.cancels).toBeGreaterThan(before);
  });
});

// =============================================================================
// T-VOICE.6 — Captions: what we say is what we display
// =============================================================================

describe('T-VOICE.6 — captions (reply text is the caption)', () => {
  it('speak(text) sets the caption to exactly text', () => {
    const { session } = makeSession();
    session.startListening();
    session.finishListening('q');
    session.speak('The full answer text.');
    expect(session.snapshot().text).toBe('The full answer text.');
  });

  it('resume preserves the caption (does not truncate the snapshot text)', () => {
    const { session } = makeSession();
    session.startListening();
    session.finishListening('q');
    session.speak('The full answer text.');
    session.markSpokenCharIndex(10);
    session.pause();
    session.resume();
    expect(session.snapshot().text).toBe('The full answer text.');
  });
});

// =============================================================================
// T-VOICE.7 — Invalid transitions
// =============================================================================

describe('T-VOICE.7 — invalid transitions throw VoiceSessionError', () => {
  it('cannot speak() from idle', () => {
    const { session } = makeSession();
    expect(() => session.speak('x')).toThrow(VoiceSessionError);
  });

  it('cannot pause() from idle', () => {
    const { session } = makeSession();
    expect(() => session.pause()).toThrow(VoiceSessionError);
  });

  it('cannot startListening() from speaking', () => {
    const { session } = makeSession();
    session.startListening();
    session.finishListening('x');
    session.speak('x.');
    expect(() => session.startListening()).toThrow(VoiceSessionError);
  });

  it('stopped → listening is allowed', () => {
    const { session } = makeSession();
    session.startListening();
    session.stop();
    expect(() => session.startListening()).not.toThrow();
  });
});

// =============================================================================
// T-VOICE.8 — STT integration
// =============================================================================

describe('T-VOICE.8 — STT result integration', () => {
  it('final transcript sets snapshot.text', () => {
    const { session, sttCtl } = makeSession();
    session.startListening();
    sttCtl.emitResult({ transcript: 'what is today', isFinal: true, confidence: 0.9 });
    expect(session.snapshot().text).toBe('what is today');
  });

  it('final transcript emits transcript-final event', () => {
    const { session, sttCtl } = makeSession();
    const events: VoiceSessionEvent[] = [];
    session.subscribe((e) => events.push(e));
    session.startListening();
    sttCtl.emitResult({ transcript: 'hi', isFinal: true, confidence: 0.9 });
    expect(events.some((e) => e.type === 'transcript-final')).toBe(true);
  });

  it('interim transcript does not set snapshot.text', () => {
    const { session, sttCtl } = makeSession();
    session.startListening();
    sttCtl.emitResult({ transcript: 'partial', isFinal: false, confidence: 0.5 });
    expect(session.snapshot().text).toBe('');
  });

  it('empty finishListening → idle', () => {
    const { session } = makeSession();
    session.startListening();
    session.finishListening('');
    expect(session.snapshot().state).toBe('idle');
  });
});

// =============================================================================
// T-VOICE.9 — Event subscription
// =============================================================================

describe('T-VOICE.9 — event subscription', () => {
  it('subscriber receives every state-change event', () => {
    const { session } = makeSession();
    const events: VoiceSessionEvent[] = [];
    session.subscribe((e) => events.push(e));
    session.startListening();
    session.finishListening('x');
    session.speak('x.');
    session.pause();
    session.resume();
    session.stop();
    const stateChanges = events.filter((e) => e.type === 'state-change');
    // listening → thinking → speaking → paused → speaking → stopped = 6 changes
    expect(stateChanges.length).toBeGreaterThanOrEqual(6);
  });

  it('unsubscribe stops further events', () => {
    const { session } = makeSession();
    const events: VoiceSessionEvent[] = [];
    const off = session.subscribe((e) => events.push(e));
    session.startListening();
    const countAfterListen = events.length;
    off();
    session.finishListening('x');
    expect(events.length).toBe(countAfterListen);
  });
});
// === FILE END ===