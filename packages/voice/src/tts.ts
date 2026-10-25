import type { VoiceConfig } from './types.js';

/**
 * PRD Section 14.1: Voice Output (TTS).
 * Uses the browser's native speechSynthesis with persona-specific tuning.
 */
export class TextToSpeech {
  private synth: any;

  constructor() {
    if (typeof globalThis !== 'undefined' && (globalThis as any).speechSynthesis) {
      this.synth = (globalThis as any).speechSynthesis;
    }
  }

  public speak(text: string, config: VoiceConfig, onEnd?: () => void): void {
    if (!this.synth) {
      if (onEnd) onEnd(); // Fallback if no TTS available
      return;
    }

    // Cancel any ongoing speech
    this.synth.cancel();

    const utterance = new (globalThis as any).SpeechSynthesisUtterance(text);
    utterance.rate = config.rate;
    utterance.pitch = config.pitch;
    utterance.lang = config.lang;

    if (onEnd) {
      utterance.onend = onEnd;
    }

    this.synth.speak(utterance);
  }

  public cancel(): void {
    if (this.synth) {
      this.synth.cancel();
    }
  }
}