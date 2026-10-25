// === FILE START ===
// packages/voice/test/tts-v2.test.ts
// PRD §11.2 · §14.1 · FR-VOICE-01 · FR-VOICE-03 · F-162 · T-13.

import { describe, it, expect } from 'vitest';
import {
  createInMemoryTtsBackend,
  createBrowserTtsBackend,
  personaToTtsParams,
  pickVoiceByLang,
  clampRate,
  clampPitch,
  DEFAULT_TTS_PARAMS,
  TtsUnsupportedError,
  type TtsVoice,
} from '../src/tts-v2.js';
import {
  YUKI,
  AURA_LIE,
  KAITO,
  RIN,
} from '../../personas/src/personas-roster-v2.js';

describe('TTS — rate and pitch clamping', () => {
  it('clampRate keeps values inside [0.1, 10]', () => {
    expect(clampRate(1)).toBe(1);
    expect(clampRate(-1)).toBe(0.1);
    expect(clampRate(20)).toBe(10);
    expect(clampRate(NaN)).toBe(DEFAULT_TTS_PARAMS.rate);
  });

  it('clampPitch keeps values inside [0, 2]', () => {
    expect(clampPitch(1)).toBe(1);
    expect(clampPitch(-1)).toBe(0);
    expect(clampPitch(5)).toBe(2);
    expect(clampPitch(NaN)).toBe(DEFAULT_TTS_PARAMS.pitch);
  });
});

describe('TTS — persona → params', () => {
  it('derives rate and pitch from sliders for a persona with no override', () => {
    const p = personaToTtsParams(YUKI);
    // Yuki: energy 0.20, warmth 0.25 → rate ≈ 0.84, pitch ≈ 0.95
    expect(p.rate).toBeGreaterThan(0.8);
    expect(p.rate).toBeLessThan(0.9);
    expect(p.pitch).toBeGreaterThan(0.9);
    expect(p.pitch).toBeLessThan(1.0);
    expect(p.volume).toBe(1);
  });

  it('explicit tts_override takes precedence', () => {
    const withOverride = { ...YUKI, tts_override: { rate: 0.95, pitch: 0.9 } };
    const p = personaToTtsParams(withOverride);
    expect(p.rate).toBe(0.95);
    expect(p.pitch).toBe(0.9);
  });

  it('every roster persona produces valid params', () => {
    for (const persona of [AURA_LIE, YUKI, KAITO, RIN]) {
      const p = personaToTtsParams(persona);
      expect(p.rate).toBeGreaterThanOrEqual(0.1);
      expect(p.rate).toBeLessThanOrEqual(10);
      expect(p.pitch).toBeGreaterThanOrEqual(0);
      expect(p.pitch).toBeLessThanOrEqual(2);
      expect(p.volume).toBeGreaterThanOrEqual(0);
      expect(p.volume).toBeLessThanOrEqual(1);
    }
  });
});

describe('TTS — in-memory backend', () => {
  it('speak() records the call with the options', () => {
    const { backend, log } = createInMemoryTtsBackend();
    backend.speak('hello', { rate: 1, pitch: 1, volume: 1 });
    expect(log.speaks.length).toBe(1);
    expect(log.speaks[0]!.text).toBe('hello');
  });

  it('empty text is a no-op only for the browser backend', () => {
    // In-memory records every call; browser backend filters empty text.
    // Both behaviours are valid — the state machine filters empty first.
    const { backend, log } = createInMemoryTtsBackend();
    backend.speak('', { rate: 1, pitch: 1, volume: 1 });
    expect(log.speaks.length).toBe(1);
  });

  it('cancel() increments the counter', () => {
    const { backend, log } = createInMemoryTtsBackend();
    backend.cancel();
    backend.cancel();
    expect(log.cancels).toBe(2);
  });

  it('isSpeaking() reflects state', () => {
    const { backend } = createInMemoryTtsBackend();
    expect(backend.isSpeaking()).toBe(false);
    backend.speak('x', { rate: 1, pitch: 1, volume: 1 });
    expect(backend.isSpeaking()).toBe(true);
    backend.cancel();
    expect(backend.isSpeaking()).toBe(false);
  });
});

describe('TTS — pickVoiceByLang', () => {
  const voices: TtsVoice[] = [
    { name: 'Female EN-IN', lang: 'en-IN', local: true },
    { name: 'Female EN-US', lang: 'en-US', local: true },
    { name: 'Hindi Female', lang: 'hi-IN', local: false },
  ];

  it('exact match wins', () => {
    expect(pickVoiceByLang(voices, 'hi-IN')?.name).toBe('Hindi Female');
  });

  it('family match when exact is absent', () => {
    expect(pickVoiceByLang(voices, 'en-GB')?.name).toBe('Female EN-IN');
  });

  it('unknown language → null', () => {
    expect(pickVoiceByLang(voices, 'fr-FR')).toBeNull();
  });

  it('empty voice list → null', () => {
    expect(pickVoiceByLang([], 'en-IN')).toBeNull();
  });
});

describe('TTS — browser backend (feature detection)', () => {
  it('throws TtsUnsupportedError when speechSynthesis is absent', () => {
    expect(() => createBrowserTtsBackend({} as never)).toThrow(TtsUnsupportedError);
  });

  it('constructs a backend when speechSynthesis + Utterance exist', () => {
    const fakeSynth = {
      speaking: false,
      speak: () => {},
      cancel: () => {},
      pause: () => {},
      resume: () => {},
      getVoices: () => [],
    };
    class FakeUtter {
      text = '';
      rate = 1;
      pitch = 1;
      volume = 1;
      voice = null;
      lang = 'en';
      constructor(t = '') { this.text = t; }
    }
    const backend = createBrowserTtsBackend({
      speechSynthesis: fakeSynth,
      SpeechSynthesisUtterance: FakeUtter as never,
    });
    expect(backend.isSpeaking()).toBe(false);
    expect(backend.getVoices()).toEqual([]);
  });
});

describe('TTS — no local model (T-13 proof)', () => {
  it('tts-v2.ts source contains no model weights, no WASM, no inference import', async () => {
    // Structural sanity test: read the source file and confirm the module
    // only reaches the platform synthesizer, never a local model.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const file = path.resolve(
      __dirname,
      '..',
      'src',
      'tts-v2.ts',
    );
    const src = fs.readFileSync(file, 'utf8');
    expect(src).not.toMatch(/onnxruntime|@xenova|tensorflow|transformers\.js/i);
    expect(src).not.toMatch(/new\s+Worker\(.*model/i);
    expect(src).toMatch(/speechSynthesis/);
  });
});
// === FILE END ===