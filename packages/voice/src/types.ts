export type VoiceState = 'IDLE' | 'LISTENING' | 'PROCESSING' | 'SPEAKING';

export interface VoiceConfig {
  rate: number;
  pitch: number;
  lang: string;
}

export interface VoiceEngineEvents {
  onStateChange: (state: VoiceState) => void;
  onTranscript: (text: string) => void;
  onError: (error: Error) => void;
}