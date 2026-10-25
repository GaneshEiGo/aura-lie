import { describe, it, expect, vi } from 'vitest';
import { VoiceManager } from '../src/manager.js';
import type { VoiceState } from '../src/types.js';

// Mock browser APIs missing in Node
(globalThis as any).speechSynthesis = {
  cancel: vi.fn(),
  speak: vi.fn((utterance) => {
    // Simulate async completion
    setTimeout(() => {
      if (utterance.onend) utterance.onend();
    }, 10);
  })
};

(globalThis as any).SpeechSynthesisUtterance = class {
  text: string;
  rate: number = 1;
  pitch: number = 1;
  lang: string = 'en-US';
  onend: any;
  constructor(text: string) {
    this.text = text;
  }
};

describe('Voice Engine (PRD 14.1)', () => {
  it('should transition states correctly', async () => {
    const stateChanges: VoiceState[] = [];
    const manager = new VoiceManager({
      onStateChange: (state) => stateChanges.push(state),
      onTranscript: vi.fn(),
      onError: vi.fn()
    });

    expect(manager.getState()).toBe('IDLE');

    // Mock TTS speaking
    manager.speak('Hello world');
    expect(manager.getState()).toBe('SPEAKING');

    // Interrupt
    manager.interrupt();
    expect(manager.getState()).toBe('IDLE');

    // Verify sequence
    expect(stateChanges).toEqual(['SPEAKING', 'IDLE']);
  });

  it('should trigger onTranscript when STT yields text', () => {
    const onTranscriptMock = vi.fn();
    const manager = new VoiceManager({
      onStateChange: vi.fn(),
      onTranscript: onTranscriptMock,
      onError: vi.fn()
    });

    // Force mock recognition to emit a result
    (manager as any).stt.recognition = {
      start: vi.fn(),
      stop: vi.fn(),
      onresult: null,
      onerror: null
    };

    manager.startListening();
    
    // Simulate browser event
    (manager as any).stt.recognition.onresult({
      results: [[{ transcript: 'testing voice' }]]
    });

    expect(onTranscriptMock).toHaveBeenCalledWith('testing voice');
    expect(manager.getState()).toBe('PROCESSING');
  });
});