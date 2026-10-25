// === FILE START ===
// packages/voice/src/tts-v2.ts
// PRD §14.1 · §11.2 · FR-VOICE-01 · FR-VOICE-03 · F-162 · T-13.
//
// Text-to-speech via the browser's speechSynthesis. No audio model, no
// WASM, no local inference — T-13 laptop-safety proof: this module can only
// ever reach the platform's built-in synthesizer.
//
// Per-persona rate/pitch: PRD §11.2's YAML sample shows explicit overrides
// (Yuki: rate 0.95, pitch 0.9). When a persona does not override, we derive
// from sliders:
//   rate  = 0.90 + 0.20 * (energy   - 0.50)  →  [0.80, 1.00]
//   pitch = 1.00 + 0.20 * (warmth   - 0.50)  →  [0.90, 1.10]
// Both bounds stay inside the platform's recommended [0.1, 10] / [0, 2]
// ranges. No configuration can push a value outside them.

import type { Persona, SliderSet } from '../../personas/src/personas-roster-v2.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface TtsVoice {
  /** Implementation-specific id (e.g. "Google UK English Female"). */
  name: string;
  lang: string;
  /** true if the platform exposes localService = true. */
  local: boolean;
}

export interface TtsOptions {
  rate: number;   // 0.1 .. 10 (platform range)
  pitch: number;  // 0    .. 2  (platform range)
  volume: number; // 0    .. 1
  /** Preferred voice name. Falls back to first matching lang. */
  voiceName?: string | null;
  /** BCP-47 hint: 'en-IN', 'hi-IN', etc. */
  lang?: string;
}

export interface TtsParams {
  rate: number;
  pitch: number;
  volume: number;
}

export interface TtsBackend {
  isSpeaking(): boolean;
  speak(text: string, opts: TtsOptions): void;
  cancel(): void;
  pause(): void;
  resume(): void;
  getVoices(): ReadonlyArray<TtsVoice>;
}

export const DEFAULT_TTS_PARAMS: Readonly<TtsParams> = Object.freeze({
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,
});

const MIN_RATE = 0.1;
const MAX_RATE = 10;
const MIN_PITCH = 0;
const MAX_PITCH = 2;

export function clampRate(r: number): number {
  if (!Number.isFinite(r)) return DEFAULT_TTS_PARAMS.rate;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, r));
}

export function clampPitch(p: number): number {
  if (!Number.isFinite(p)) return DEFAULT_TTS_PARAMS.pitch;
  return Math.min(MAX_PITCH, Math.max(MIN_PITCH, p));
}

// -----------------------------------------------------------------------------
// Persona → TTS parameter mapping
// -----------------------------------------------------------------------------

/**
 * Derive TTS rate and pitch from a persona's sliders. Explicit overrides win.
 *
 * A persona can carry `tts_override` (an extra field outside `SliderSet`)
 * matching PRD §11.2's YAML sample `tts: { rate, pitch }`. Any field that is
 * absent is computed from sliders. Any computed value outside the platform
 * range is clamped, never thrown.
 */
export function personaToTtsParams(persona: Persona): TtsParams {
  const override = (persona as unknown as { tts_override?: Partial<TtsParams> })
    .tts_override;
  const derived = deriveFromSliders(persona.sliders);
  const rate = override?.rate ?? derived.rate;
  const pitch = override?.pitch ?? derived.pitch;
  const volume = override?.volume ?? DEFAULT_TTS_PARAMS.volume;
  return {
    rate: clampRate(rate),
    pitch: clampPitch(pitch),
    volume: Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1)),
  };
}

function deriveFromSliders(s: SliderSet): TtsParams {
  return {
    rate: clampRate(0.9 + 0.2 * (s.energy - 0.5)),
    pitch: clampPitch(1.0 + 0.2 * (s.warmth - 0.5)),
    volume: 1.0,
  };
}

// -----------------------------------------------------------------------------
// Browser backend — speechSynthesis
// -----------------------------------------------------------------------------

interface SpeechSynthesisLike {
  speaking: boolean;
  speak: (u: SpeechSynthesisUtteranceLike) => void;
  cancel: () => void;
  pause: () => void;
  resume: () => void;
  getVoices: () => SpeechSynthesisVoiceLike[];
}

interface SpeechSynthesisUtteranceLike {
  text: string;
  rate: number;
  pitch: number;
  volume: number;
  voice: SpeechSynthesisVoiceLike | null;
  lang: string;
}

interface SpeechSynthesisVoiceLike {
  name: string;
  lang: string;
  localService: boolean;
}

export interface TtsBrowserWindow {
  speechSynthesis?: SpeechSynthesisLike;
  SpeechSynthesisUtterance?: new (text?: string) => SpeechSynthesisUtteranceLike;
}

/**
 * Build a real browser TTS backend. Throws `TtsUnsupportedError` when the
 * platform exposes no speechSynthesis (T-13: we never fall back to a local
 * model).
 */
export function createBrowserTtsBackend(win?: TtsBrowserWindow): TtsBackend {
  const w = win ?? (typeof globalThis !== 'undefined' ? (globalThis as TtsBrowserWindow) : {});
  const synth = w.speechSynthesis;
  const Utter = w.SpeechSynthesisUtterance;

  if (!synth || !Utter) {
    throw new TtsUnsupportedError(
      'This browser does not expose speechSynthesis. Voice output is unavailable.',
    );
  }

  return {
    isSpeaking(): boolean {
      return synth.speaking;
    },
    speak(text: string, opts: TtsOptions): void {
      if (typeof text !== 'string' || text.length === 0) return;
      const u = new Utter(text);
      u.rate = clampRate(opts.rate);
      u.pitch = clampPitch(opts.pitch);
      u.volume = Math.min(1, Math.max(0, opts.volume));
      if (opts.lang) u.lang = opts.lang;
      if (opts.voiceName) {
        const match = synth.getVoices().find((v) => v.name === opts.voiceName);
        u.voice = match ?? null;
      }
      synth.speak(u);
    },
    cancel(): void { synth.cancel(); },
    pause(): void { synth.pause(); },
    resume(): void { synth.resume(); },
    getVoices(): ReadonlyArray<TtsVoice> {
      return synth.getVoices().map((v) => ({
        name: v.name,
        lang: v.lang,
        local: v.localService,
      }));
    },
  };
}

export class TtsUnsupportedError extends Error {
  readonly kind = 'TtsUnsupportedError';
  constructor(message: string) {
    super(message);
    this.name = 'TtsUnsupportedError';
  }
}

// -----------------------------------------------------------------------------
// In-memory backend — for tests and for Core Mode
// -----------------------------------------------------------------------------

export interface InMemoryTtsLog {
  speaks: { text: string; opts: TtsOptions }[];
  cancels: number;
  pauses: number;
  resumes: number;
}

export function createInMemoryTtsBackend(
  voices: ReadonlyArray<TtsVoice> = [],
): { backend: TtsBackend; log: InMemoryTtsLog } {
  const log: InMemoryTtsLog = { speaks: [], cancels: 0, pauses: 0, resumes: 0 };
  let speaking = false;

  const backend: TtsBackend = {
    isSpeaking() { return speaking; },
    speak(text, opts) {
      log.speaks.push({ text, opts });
      speaking = true;
    },
    cancel() { log.cancels += 1; speaking = false; },
    pause() { log.pauses += 1; speaking = false; },
    resume() { log.resumes += 1; speaking = true; },
    getVoices() { return voices; },
  };
  return { backend, log };
}

/**
 * Pick a voice by BCP-47 language tag: exact match, then primary-subtag
 * match, then null (which tells the platform to pick a default).
 */
export function pickVoiceByLang(
  voices: ReadonlyArray<TtsVoice>,
  lang: string,
): TtsVoice | null {
  const target = lang.toLowerCase();
  const primary = target.split('-')[0] ?? target;

  const exact = voices.find((v) => v.lang.toLowerCase() === target);
  if (exact) return exact;

  const family = voices.find(
    (v) => (v.lang.toLowerCase().split('-')[0] ?? '') === primary,
  );
  if (family) return family;

  return null;
}
// === FILE END ===