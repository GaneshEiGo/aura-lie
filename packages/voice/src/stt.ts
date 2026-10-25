/**
 * PRD Section 14.1: Voice Input (STT).
 * Wraps the browser's Web Speech API with a fallback mechanism.
 */
export class SpeechToText {
  private recognition: any = null;
  private isListening: boolean = false;

  constructor() {
    // Check for browser support (Mocked for Node test environment)
    if (typeof globalThis !== 'undefined' && (globalThis as any).webkitSpeechRecognition) {
      const SpeechRecognition = (globalThis as any).webkitSpeechRecognition || (globalThis as any).SpeechRecognition;
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = false;
      this.recognition.lang = 'en-US';
    }
  }

  public start(onResult: (text: string) => void, onError: (err: Error) => void): void {
    if (!this.recognition) {
      onError(new Error('Browser does not support STT'));
      return;
    }

    this.isListening = true;
    this.recognition.onresult = (event: any) => {
      const transcript = event.results[event.results.length - 1][0].transcript;
      onResult(transcript);
    };

    this.recognition.onerror = (event: any) => {
      onError(new Error(`STT Error: ${event.error}`));
      this.isListening = false;
    };

    this.recognition.start();
  }

  public stop(): void {
    if (this.recognition && this.isListening) {
      this.recognition.stop();
      this.isListening = false;
    }
  }

  public getIsListening(): boolean {
    return this.isListening;
  }
}