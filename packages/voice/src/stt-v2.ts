// === FILE START ===
// packages/voice/src/stt-v2.ts
// PRD §14.1 · FR-VOICE-01 · F-161 · T-13.
//
// Speech-to-text via the browser's SpeechRecognition (Web Speech API).
// No audio model, no WASM, no local inference — T-13 laptop-safety proof.
//
// PRD §14.1 privacy disclosure (must be shown to the user verbatim):
//   "Some browsers process audio in the cloud. Check your browser's privacy
//    policy before speaking sensitive content."
//
// Feature detection: `isSupported()` returns false in Node/tests; `start()`
// throws `SttUnsupportedError` if called unsupported. No silent fallback to
// a cloud model.

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface SttResult {
  transcript: string;
  isFinal: boolean;
  /** 0..1 confidence when the platform provides it. */
  confidence: number;
}

export type SttResultCallback = (result: SttResult) => void;
export type SttErrorCallback = (err: SttError) => void;
export type SttEndCallback = () => void;

export interface SttBackend {
  isSupported(): boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onResult(cb: SttResultCallback): void;
  onError(cb: SttErrorCallback): void;
  onEnd(cb: SttEndCallback): void;
  /** PRD §14.1 mandatory disclosure. Rendered verbatim by the UI. */
  readonly privacyNotice: string;
}

export class SttUnsupportedError extends Error {
  readonly kind = 'SttUnsupportedError';
  constructor(message: string) {
    super(message);
    this.name = 'SttUnsupportedError';
  }
}

export interface SttError {
  code: 'no-speech' | 'audio-capture' | 'network' | 'not-allowed' | 'aborted' | 'unknown';
  message: string;
}

/** PRD §14.1 — the exact notice the UI must display. */
export const PRIVACY_NOTICE =
  "Some browsers process audio in the cloud. Check your browser's privacy policy before speaking sensitive content.";

// -----------------------------------------------------------------------------
// Browser backend — SpeechRecognition / webkitSpeechRecognition
// -----------------------------------------------------------------------------

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<
    ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }
  >;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export interface SttBrowserWindow {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
}

/**
 * Real browser STT backend. Throws `SttUnsupportedError` when neither
 * `SpeechRecognition` nor `webkitSpeechRecognition` is available.
 */
export function createBrowserSttBackend(opts?: {
  win?: SttBrowserWindow;
  lang?: string;
  continuous?: boolean;
  interimResults?: boolean;
}): SttBackend {
  const win =
    opts?.win ??
    (typeof globalThis !== 'undefined' ? (globalThis as SttBrowserWindow) : {});
  const Ctor = win.SpeechRecognition ?? win.webkitSpeechRecognition;

  let resultCb: SttResultCallback | null = null;
  let errorCb: SttErrorCallback | null = null;
  let endCb: SttEndCallback | null = null;

  const supported = typeof Ctor === 'function';

  let active: SpeechRecognitionLike | null = null;

  return {
    isSupported() { return supported; },
    start() {
      if (!supported || !Ctor) {
        throw new SttUnsupportedError(
          'SpeechRecognition is not available in this browser. Voice input is unavailable.',
        );
      }
      if (active) return; // idempotent while listening
      const r = new Ctor();
      r.lang = opts?.lang ?? 'en-IN';
      r.continuous = opts?.continuous ?? false;
      r.interimResults = opts?.interimResults ?? true;

      r.onresult = (ev) => {
        if (!resultCb) return;
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const alt = ev.results[i]![0];
          if (!alt) continue;
          resultCb({
            transcript: alt.transcript,
            isFinal: ev.results[i]!.isFinal,
            confidence: alt.confidence ?? 0,
          });
        }
      };
      r.onerror = (ev) => {
        if (!errorCb) return;
        errorCb({
          code: normaliseErrorCode(ev.error),
          message: ev.message ?? ev.error,
        });
      };
      r.onend = () => {
        active = null;
        if (endCb) endCb();
      };
      active = r;
      r.start();
    },
    stop() {
      if (active) active.stop();
    },
    abort() {
      if (active) active.abort();
      active = null;
    },
    onResult(cb) { resultCb = cb; },
    onError(cb) { errorCb = cb; },
    onEnd(cb) { endCb = cb; },
    privacyNotice: PRIVACY_NOTICE,
  };
}

function normaliseErrorCode(code: string): SttError['code'] {
  switch (code) {
    case 'no-speech':
    case 'audio-capture':
    case 'network':
    case 'not-allowed':
    case 'aborted':
      return code;
    default:
      return 'unknown';
  }
}

// -----------------------------------------------------------------------------
// In-memory backend — for tests
// -----------------------------------------------------------------------------

export interface InMemorySttController {
  backend: SttBackend;
  /** Simulate a result event from the platform. */
  emitResult(result: SttResult): void;
  /** Simulate an error event from the platform. */
  emitError(error: SttError): void;
  /** Simulate the browser ending the session. */
  emitEnd(): void;
  /** Inspection for assertions. */
  readonly state: { started: boolean; stopped: boolean; aborted: boolean };
}

export function createInMemorySttBackend(opts?: {
  supported?: boolean;
}): InMemorySttController {
  const supported = opts?.supported ?? true;
  const state = { started: false, stopped: false, aborted: false };
  let resultCb: SttResultCallback | null = null;
  let errorCb: SttErrorCallback | null = null;
  let endCb: SttEndCallback | null = null;

  const backend: SttBackend = {
    isSupported() { return supported; },
    start() {
      if (!supported) {
        throw new SttUnsupportedError('SpeechRecognition is not available.');
      }
      state.started = true;
    },
    stop() { state.stopped = true; },
    abort() { state.aborted = true; },
    onResult(cb) { resultCb = cb; },
    onError(cb) { errorCb = cb; },
    onEnd(cb) { endCb = cb; },
    privacyNotice: PRIVACY_NOTICE,
  };

  return {
    backend,
    emitResult(result) { if (resultCb) resultCb(result); },
    emitError(error) { if (errorCb) errorCb(error); },
    emitEnd() { if (endCb) endCb(); },
    state,
  };
}
// === FILE END ===