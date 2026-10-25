export interface CommandResult {
  originalText: string;
  cleanText: string;
  commands: string[];
  modeOverride?: string;
  styleOverride?: string;
}

/**
 * PRD Section 5.15 & 7.14: Command bar and slash commands
 * Parses /think, /research, minimal, straight talk, etc.
 */
export class CommandParser {
  private modes = ['instant', 'think', 'research', 'council'];
  private styles = ['minimal', 'deep', 'go max', 'human', 'terminal', 'zen', 'raw', 'facts only', 'straight talk'];

  public parse(input: string): CommandResult {
    let text = input.trim();
    const commands: string[] = [];
    let modeOverride: string | undefined;
    let styleOverride: string | undefined;

    // 1. Extract Slash Commands
    const slashRegex = /^\/([a-zA-Z]+)\s*/;
    let match;
    
    while ((match = text.match(slashRegex)) !== null) {
      const cmd = match[1].toLowerCase();
      commands.push(cmd);
      text = text.replace(slashRegex, '');

      if (this.modes.includes(cmd)) {
        modeOverride = cmd;
      } else if (['fact', 'minimal', 'deep', 'human', 'terminal', 'zen', 'raw'].includes(cmd)) {
        styleOverride = cmd;
      }
    }

    // 2. Extract Natural Language Style Commands
    const lowerText = text.toLowerCase();
    for (const style of this.styles) {
      if (lowerText.startsWith(style + ' ')) {
        styleOverride = style;
        text = text.substring(style.length).trim();
        commands.push(style);
        break;
      }
    }

    return {
      originalText: input,
      cleanText: text || input, // Fallback if only commands are passed
      commands,
      modeOverride,
      styleOverride
    };
  }
}