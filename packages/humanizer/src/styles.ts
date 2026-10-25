export type StyleMode = 'default' | 'minimal' | 'human' | 'terminal' | 'zen';

export function applyStyle(text: string, mode: StyleMode): string {
  switch (mode) {
    case 'minimal':
      const sentences = text.split(/(?<=[.!?])\s+/);
      if (sentences.length > 2) {
        return `${sentences[0]} ${sentences[sentences.length - 1]}`;
      }
      return text;

    case 'zen':
      const firstSentence = text.split(/(?<=[.!?])\s+/)[0];
      return firstSentence || text;

    case 'terminal':
      return `\`\`\`terminal\n${text}\n\`\`\``;

    case 'human':
    case 'default':
    default:
      return text;
  }
}