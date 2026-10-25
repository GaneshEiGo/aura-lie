export interface VoiceSliders {
  warmth: number;
  humor: number;
  energy: number;
  skepticism: number;
  bluntness: number;
  formality: number;
  verbosity: number;
  creativity: number;
  emoji: number;
  sarcasm: number;
}

export interface PersonaAnchor {
  user: string;
  reply: string;
}

export interface PersonaSchema {
  id: string;
  name: string;
  archetype: string;
  accent: string;
  voice: {
    sliders: VoiceSliders;
  };
  rules: string[];
  banned: string[];
  anchors: PersonaAnchor[];
  modes: string[];
  safety: 'inherit';
}