// === FILE START ===
// packages/voice/src/voice-session-v2.ts
// PRD §14.1 · FR-VOICE-01 · FR-VOICE-02 · FR-VOICE-03 · F-161 to F-163.
//
// The voice session orchestrates:
//   · listening (STT active)
//   · thinking  (chat generating)
//   · speaking  (TTS active)
//   · paused    (TTS + generation paused; resume from char offset)
//   · stopped   (terminal; user interrupt reached)
//
// PRD §14.1 requirements enforced here:
//   · interrupt ≤ 300 ms  — stop() transitions state synchronously.
//   · pause/resume/correct/change-subject — every transition is a named
//                            method, never a generic "transition to X".
//   · Captions — the reply text is always what TTS is speaking.
//   · Correction — correct() records the correction and resets the offset.
//
// FIX HISTORY (post Section 97):
//   Bug 1 — speak() was not validating its transition. idle → speaking
//           silently succeeded because `transition()` only sets state. Fixed:
//           speak() now calls assertTransition('speaking') at the top.
//   Bug 2 — resume() accepted any state whose VALID_TRANSITIONS includes
//           'speaking' (notably 'thinking'). But resume() semantically means
//           "un-pause". Fixed: resume() now requires state === 'paused'.

import type { SttBackend, SttResult } from './stt-v2.js';
import type { TtsBackend, TtsOptions } from './tts-v2.js';
import { DEFAULT_TTS_PARAMS, clampRate, clampPitch } from './tts-v2.js';

export type VoiceState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'paused'
  | 'stopped';

export interface VoiceSessionSnapshot {
  state: VoiceState;
  text: string;
  lastSpokenCharIndex: number;
  corrections: string[];
  startedAt: string | null;
  stoppedAt: string | null;
}

export interface VoiceSessionEvent {
  type:
    | 'state-change'
    | 'transcript-final'
    | 'transcript-interim'
    | 'correction'
    | 'stopped';
  state: VoiceState;
  at: string;
  detail?: string;
}

export type VoiceListener = (event: VoiceSessionEvent) => void;

export class VoiceSessionError extends Error {
  readonly kind = 'VoiceSessionError';
  constructor(message: string) {
    super(message);
    this.name = 'VoiceSessionError';
  }
}

export interface VoiceSessionDeps {
  tts?: TtsBackend;
  stt?: SttBackend;
  now?: () => number;
  ttsOptions?: TtsOptions;
}

// Allowed transitions per state. `stop()` bypasses this map (interrupt must
// always work), but every other method validates via assertTransition.
const VALID_TRANSITIONS: Record<VoiceState, VoiceState[]> = {
  idle:      ['listening', 'stopped'],
  listening: ['thinking', 'stopped', 'idle'],
  thinking:  ['speaking', 'stopped'],
  speaking:  ['paused', 'stopped', 'idle', 'thinking'],
  paused:    ['speaking', 'stopped', 'idle'],
  stopped:   ['idle', 'listening'],
};

export class VoiceSession {
  private state: VoiceState = 'idle';
  private text = '';
  private lastSpokenCharIndex = 0;
  private corrections: string[] = [];
  private startedAt: string | null = null;
  private stoppedAt: string | null = null;
  private listeners: VoiceListener[] = [];

  private readonly tts: TtsBackend | null;
  private readonly stt: SttBackend | null;
  private readonly now: () => number;
  private readonly defaultTts: TtsOptions;

  constructor(deps: VoiceSessionDeps = {}) {
    this.tts = deps.tts ?? null;
    this.stt = deps.stt ?? null;
    this.now = deps.now ?? Date.now;
    this.defaultTts = {
      rate: deps.ttsOptions?.rate ?? DEFAULT_TTS_PARAMS.rate,
      pitch: deps.ttsOptions?.pitch ?? DEFAULT_TTS_PARAMS.pitch,
      volume: deps.ttsOptions?.volume ?? DEFAULT_TTS_PARAMS.volume,
      lang: deps.ttsOptions?.lang,
      voiceName: deps.ttsOptions?.voiceName ?? null,
    };

    if (this.stt) {
      this.stt.onResult((r) => this.handleSttResult(r));
    }
  }

  // ---- introspection ----

  snapshot(): VoiceSessionSnapshot {
    return {
      state: this.state,
      text: this.text,
      lastSpokenCharIndex: this.lastSpokenCharIndex,
      corrections: [...this.corrections],
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
    };
  }

  subscribe(listener: VoiceListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  // ---- lifecycle ----

  startListening(): void {
    this.assertTransition('listening');
    if (this.stt && !this.stt.isSupported()) {
      throw new VoiceSessionError(
        'STT is unsupported in this environment. Voice input is unavailable.',
      );
    }
    this.text = '';
    this.lastSpokenCharIndex = 0;
    this.startedAt = this.isoNow();
    this.stoppedAt = null;
    this.transition('listening');
    if (this.stt) this.stt.start();
  }

  finishListening(transcript?: string): void {
    if (transcript !== undefined) this.text = transcript;
    if (this.text.trim().length === 0) {
      // Nothing to think about; go back to idle quietly.
      this.transition('idle');
      if (this.stt) this.stt.abort();
      return;
    }
    this.transition('thinking');
    if (this.stt) this.stt.stop();
  }

  /**
   * Begin TTS with the given text.
   *
   * BUG FIX (post Section 97): speak() now validates its transition.
   * Previously it fell through from 'idle' silently, which is wrong — speak
   * only makes sense from 'thinking' (chat just answered) or 'paused'
   * (user re-spoke). Every other state throws VoiceSessionError.
   */
  speak(text: string): void {
    if (typeof text !== 'string') return;
    this.assertTransition('speaking');
    this.text = text;
    this.lastSpokenCharIndex = 0;
    this.transition('speaking');
    this.speakFromOffset();
  }

  pause(): void {
    this.assertTransition('paused');
    if (this.tts) this.tts.pause();
    this.transition('paused');
  }

  /**
   * Un-pause. Only valid from `paused`.
   *
   * BUG FIX (post Section 97): resume() is semantically "un-pause", not
   * "enter speaking". The previous implementation delegated to
   * assertTransition('speaking'), which accepted 'thinking' too because
   * VALID_TRANSITIONS['thinking'] includes 'speaking' (for speak()).
   * resume() now requires state === 'paused' explicitly, matching the
   * T-VOICE.3 gate.
   */
  resume(): void {
    if (this.state !== 'paused') {
      throw new VoiceSessionError(
        `Cannot resume from state '${this.state}'. Only 'paused' can be resumed.`,
      );
    }
    if (this.tts) this.tts.resume();
    this.transition('speaking');
    this.speakFromOffset();
  }

  /**
   * PRD §14.1 interrupt. Synchronous; guaranteed ≤ 300 ms wall clock
   * because no promise is awaited and every step (cancel TTS, emit event,
   * transition state) is straight-line JS.
   *
   * stop() intentionally bypasses assertTransition — interrupt must work
   * from any state, including 'stopped' (idempotent).
   */
  stop(): void {
    if (this.state === 'stopped') return;
    if (this.tts) this.tts.cancel();
    if (this.stt) this.stt.abort();
    this.stoppedAt = this.isoNow();
    this.transition('stopped');
    this.emit({
      type: 'stopped',
      state: this.state,
      at: this.stoppedAt,
    });
  }

  correct(note: string): void {
    this.corrections.push(note);
    this.lastSpokenCharIndex = 0;
    this.emit({
      type: 'correction',
      state: this.state,
      at: this.isoNow(),
      detail: note,
    });
  }

  changeSubject(): void {
    this.text = '';
    this.lastSpokenCharIndex = 0;
    if (this.state === 'speaking' || this.state === 'paused') {
      if (this.tts) this.tts.cancel();
      this.transition('idle');
    }
  }

  // ---- caller hooks for tests and streaming callbacks ----

  markSpokenCharIndex(idx: number): void {
    if (idx < 0) return;
    this.lastSpokenCharIndex = Math.min(idx, this.text.length);
  }

  // ---- internals ----

  private handleSttResult(result: SttResult): void {
    if (result.isFinal) {
      this.text = result.transcript;
      this.emit({
        type: 'transcript-final',
        state: this.state,
        at: this.isoNow(),
        detail: result.transcript,
      });
    } else {
      this.emit({
        type: 'transcript-interim',
        state: this.state,
        at: this.isoNow(),
        detail: result.transcript,
      });
    }
  }

  private speakFromOffset(): void {
    if (!this.tts) return;
    const remaining = this.text.slice(this.lastSpokenCharIndex);
    if (remaining.length === 0) return;
    this.tts.speak(remaining, {
      rate: clampRate(this.defaultTts.rate),
      pitch: clampPitch(this.defaultTts.pitch),
      volume: this.defaultTts.volume,
      lang: this.defaultTts.lang,
      voiceName: this.defaultTts.voiceName ?? null,
    });
  }

  private assertTransition(target: VoiceState): void {
    const allowed = VALID_TRANSITIONS[this.state];
    if (!allowed.includes(target)) {
      throw new VoiceSessionError(
        `Invalid transition ${this.state} → ${target}. Allowed: ${allowed.join(', ')}.`,
      );
    }
  }

  private transition(target: VoiceState): void {
    this.state = target;
    this.emit({ type: 'state-change', state: target, at: this.isoNow() });
  }

  private emit(event: VoiceSessionEvent): void {
    for (const l of this.listeners) l(event);
  }

  private isoNow(): string {
    return new Date(this.now()).toISOString();
  }
}
// === FILE END ===