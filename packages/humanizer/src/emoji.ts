export function countEmojis(text: string): number {
  const emojiRegex = /[\u{1F300}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
  const matches = text.match(emojiRegex);
  return matches ? matches.length : 0;
}

export function enforceEmojiLimit(text: string, maxEmojis: number = 1): string {
  let count = 0;
  const emojiRegex = /[\u{1F300}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
  
  return text.replace(emojiRegex, (match) => {
    count++;
    if (count > maxEmojis) {
      return ''; 
    }
    return match;
  });
}