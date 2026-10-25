import type { CommandItem, CommandResult } from './types.js';

export class CommandParser {
  public search(query: string, commands: CommandItem[]): CommandResult[] {
    const lowerQuery = query.toLowerCase().trim();
    if (!lowerQuery) return [];

    const results: CommandResult[] = [];

    for (const cmd of commands) {
      let score = 0;
      const labelLower = cmd.label.toLowerCase();
      const categoryLower = cmd.category.toLowerCase();

      if (labelLower === lowerQuery) score += 100;
      else if (labelLower.startsWith(lowerQuery)) score += 50;
      else if (labelLower.includes(lowerQuery)) score += 25;
      
      if (categoryLower.includes(lowerQuery)) score += 10;

      if (score > 0) {
        results.push({ item: cmd, score });
      }
    }

    // Sort by score descending
    return results.sort((a, b) => b.score - a.score);
  }
}