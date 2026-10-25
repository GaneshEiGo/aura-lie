const BANNED_PHRASES = [
  "Certainly!",
  "Absolutely!",
  "I'd be happy to assist",
  "As an AI language model",
  "I hope this helps",
  "Here is a comprehensive overview",
  "Great question!",
  "Let me know if you have any other questions"
];

export function containsFiller(text: string): boolean {
  const lower = text.toLowerCase();
  return BANNED_PHRASES.some(phrase => lower.includes(phrase.toLowerCase()));
}

export function stripFiller(text: string): string {
  let cleaned = text;
  for (const phrase of BANNED_PHRASES) {
    const regex = new RegExp(`^${phrase}\\s*`, 'i');
    cleaned = cleaned.replace(regex, '');
  }
  
  for (const phrase of BANNED_PHRASES) {
    const regex = new RegExp(`${phrase}\\s*`, 'gi');
    cleaned = cleaned.replace(regex, '');
  }

  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  return cleaned.trim();
}