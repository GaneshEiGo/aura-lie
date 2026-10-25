import { describe, it, expect } from 'vitest';
import { CommandParser } from '../src/parser.js';

describe('Command Parser (PRD 5.15, 7.14)', () => {
  const parser = new CommandParser();

  it('should extract slash mode commands', () => {
    const result = parser.parse('/think What is the meaning of life?');
    expect(result.modeOverride).toBe('think');
    expect(result.cleanText).toBe('What is the meaning of life?');
    expect(result.commands).toContain('think');
  });

  it('should extract slash style commands', () => {
    const result = parser.parse('/minimal How tall is Mount Everest?');
    expect(result.styleOverride).toBe('minimal');
    expect(result.cleanText).toBe('How tall is Mount Everest?');
  });

  it('should extract natural language style commands', () => {
    const result = parser.parse('straight talk Give me the facts about coffee.');
    expect(result.styleOverride).toBe('straight talk');
    expect(result.cleanText).toBe('Give me the facts about coffee.');
  });

  it('should chain commands', () => {
    const result = parser.parse('/research /deep Tell me about quantum computing.');
    expect(result.modeOverride).toBe('research');
    expect(result.styleOverride).toBe('deep');
    expect(result.cleanText).toBe('Tell me about quantum computing.');
  });
});