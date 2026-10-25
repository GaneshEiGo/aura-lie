import { SpeechToText } from './stt.js';
import { TextToSpeech } from './tts.js';
import type { VoiceState, VoiceEngineEvents, VoiceConfig } from './types.js';

export class VoiceManager {
  private stt = new SpeechToText();
  private tts = new TextToSpeech();
  private state: VoiceState = 'IDLE';
  private events: VoiceEngineEvents;

  constructor(events: VoiceEngineEvents) {
    this.events = events;
  }

  public getState(): VoiceState {
    return this.state;
  }

  private setState(newState: VoiceState) {
    this.state = newState;
    this.events.onStateChange(newState);
  }

  public startListening(): void {
    if (this.state === 'SPEAKING') {
      this.interrupt(); // Stop speaking if we start listening
    }

    this.setState('LISTENING');
    this.stt.start(
      (text) => {
        this.setState('PROCESSING');
        this.events.onTranscript(text);
      },
      (err) => {
        this.setState('IDLE');
        this.events.onError(err);
      }
    );
  }

  public stopListening(): void {
    this.stt.stop();
    if (this.state === 'LISTENING') {
      this.setState('IDLE');
    }
  }

  public speak(text: string, config?: Partial<VoiceConfig>): void {
    this.setState('SPEAKING');
    this.stt.stop(); // Stop listening if we start speaking

    const finalConfig: VoiceConfig = {
      rate: config?.rate || 1.0,
      pitch: config?.pitch || 1.0,
      lang: config?.lang || 'en-US'
    };

    this.tts.speak(text, finalConfig, () => {
      this.setState('IDLE');
    });
  }

  /**
   * PRD Section 14.1: Interruption.
   * Immediately stops TTS and resets to IDLE.
   */
  public interrupt(): void {
    this.tts.cancel();
    this.stt.stop();
    this.setState('IDLE');
  }
}