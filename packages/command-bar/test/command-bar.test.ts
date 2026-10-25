import { describe, it, expect, vi } from 'vitest';
import { CommandRegistry } from '../src/registry.js';
import { CommandParser } from '../src/parser.js';
import { CommandExecutor } from '../src/executor.js';

describe('Command Bar (PRD 5.15)', () => {
  const registry = new CommandRegistry();
  const parser = new CommandParser();
  
  const mockAction = vi.fn();
  
  registry.register({ id: 'think', category: 'Modes', label: 'Switch to Think Mode', action: mockAction });
  registry.register({ id: 'paper', category: 'Appearance', label: 'Switch to Paper Theme', action: vi.fn() });
  registry.register({ id: 'ink', category: 'Appearance', label: 'Switch to Ink Theme', action: vi.fn() });

  it('should find commands by exact match', () => {
    const results = parser.search('Switch to Think Mode', registry.getAll());
    expect(results.length).toBe(1);
    expect(results[0].item.id).toBe('think');
    expect(results[0].score).toBe(100);
  });

  it('should find commands by prefix match', () => {
    const results = parser.search('Switch to', registry.getAll());
    expect(results.length).toBe(3);
    expect(results[0].score).toBe(50);
  });

  it('should find commands by category', () => {
    const results = parser.search('appearance', registry.getAll());
    expect(results.length).toBe(2);
    expect(results[0].item.category).toBe('Appearance');
  });

  it('should execute a command successfully', async () => {
    const executor = new CommandExecutor(registry);
    const success = await executor.execute('think');
    
    expect(success).toBe(true);
    expect(mockAction).toHaveBeenCalledTimes(1);
  });

  it('should handle missing commands gracefully', async () => {
    const executor = new CommandExecutor(registry);
    const success = await executor.execute('non-existent');
    
    expect(success).toBe(false);
  });
});