// === FILE START ===
// packages/voice/test/stt-v2.test.ts
// PRD §14.1 · FR-VOICE-01 · F-161 · T-13.

import { describe, it, expect } from 'vitest';
import {
  createInMemorySttBackend,
  createBrowserSttBackend,
  PRIVACY_NOTICE,
  SttUnsupportedError,
} from '../src/stt-v2.js';

// =============================================================================
// STT.1 — Privacy notice is present and honest (PRD §14.1)
// =============================================================================

describe('STT.1 — privacy notice', () => {
  it('PRIVACY_NOTICE mentions cloud processing honestly', () => {
    expect(PRIVACY_NOTICE).toMatch(/browser/i);
    expect(PRIVACY_NOTICE).toMatch(/cloud/i);
    expect(PRIVACY_NOTICE).toMatch(/privacy/i);
  });

  it('backend exposes the notice for the UI to render', () => {
    const ctl = createInMemorySttBackend({ supported: true });
    expect(ctl.backend.privacyNotice).toBe(PRIVACY_NOTICE);
  });
});

// =============================================================================
// STT.2 — Feature detection
// =============================================================================

describe('STT.2 — feature detection', () => {
  it('in-memory backend isSupported() honours the flag', () => {
    expect(createInMemorySttBackend({ supported: true }).backend.isSupported()).toBe(true);
    expect(createInMemorySttBackend({ supported: false }).backend.isSupported()).toBe(false);
  });

  it('start() throws SttUnsupportedError when unsupported', () => {
    const ctl = createInMemorySttBackend({ supported: false });
    expect(() => ctl.backend.start()).toThrow(SttUnsupportedError);
  });

  it('browser backend isSupported() returns false without a ctor', () => {
    const b = createBrowserSttBackend({ win: {} });
    expect(b.isSupported()).toBe(false);
    expect(() => b.start()).toThrow(SttUnsupportedError);
  });
});

// =============================================================================
// STT.3 — In-memory backend events
// =============================================================================

describe('STT.3 — in-memory backend emits results', () => {
  it('onResult fires when emitResult is called', () => {
    const ctl = createInMemorySttBackend();
    let last: string | null = null;
    ctl.backend.onResult((r) => { last = r.transcript; });
    ctl.emitResult({ transcript: 'hello', isFinal: true, confidence: 0.9 });
    expect(last).toBe('hello');
  });

  it('onError fires when emitError is called', () => {
    const ctl = createInMemorySttBackend();
    let code: string | null = null;
    ctl.backend.onError((e) => { code = e.code; });
    ctl.emitError({ code: 'network', message: 'boom' });
    expect(code).toBe('network');
  });

  it('onEnd fires when emitEnd is called', () => {
    const ctl = createInMemorySttBackend();
    let ended = false;
    ctl.backend.onEnd(() => { ended = true; });
    ctl.emitEnd();
    expect(ended).toBe(true);
  });
});

// =============================================================================
// STT.4 — Browser backend surface (with a stub ctor)
// =============================================================================

describe('STT.4 — browser backend surface', () => {
  it('constructs successfully when SpeechRecognition exists', () => {
    class FakeRec {
      lang = 'en';
      continuous = false;
      interimResults = false;
      onresult: ((ev: unknown) => void) | null = null;
      onerror: ((ev: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {}
      stop() {}
      abort() {}
    }
    const b = createBrowserSttBackend({
      win: { SpeechRecognition: FakeRec as never },
    });
    expect(b.isSupported()).toBe(true);
    expect(b.privacyNotice).toBe(PRIVACY_NOTICE);
  });

  it('falls back to webkitSpeechRecognition when present', () => {
    class FakeRec {
      lang = 'en';
      continuous = false;
      interimResults = false;
      onresult: ((ev: unknown) => void) | null = null;
      onerror: ((ev: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {}
      stop() {}
      abort() {}
    }
    const b = createBrowserSttBackend({
      win: { webkitSpeechRecognition: FakeRec as never },
    });
    expect(b.isSupported()).toBe(true);
  });
});

// =============================================================================
// STT.5 — No local model (T-13 proof)
// =============================================================================

describe('STT.5 — no local model (T-13 proof)', () => {
  it('stt-v2.ts source contains no model weights or inference imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const file = path.resolve(__dirname, '..', 'src', 'stt-v2.ts');
    const src = fs.readFileSync(file, 'utf8');
    expect(src).not.toMatch(/onnxruntime|@xenova|tensorflow|transformers\.js/i);
    expect(src).toMatch(/SpeechRecognition/);
  });
});
// === FILE END ===