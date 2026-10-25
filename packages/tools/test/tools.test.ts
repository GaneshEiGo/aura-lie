import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../src/registry.js';
import { DryRunEngine } from '../src/dry-run.js';
import type { ToolManifest, PermissionMatrix } from '../src/types.js';

describe('Tool Registry (PRD 12.1)', () => {
  const registry = new ToolRegistry();
  const dryRun = new DryRunEngine();

  const searchTool: ToolManifest = {
    id: 'search',
    description: 'Search the web',
    permissions: ['read:web'],
    risk: 'low',
    timeout_ms: 5000,
    max_output_bytes: 1024
  };

  registry.register(searchTool);

  const matrix: PermissionMatrix = {
    'search': 'allow',
    'code_runner': 'ask',
    'payments': 'NEVER'
  };

  it('should allow tools explicitly marked as allow', () => {
    expect(registry.canExecute('search', matrix)).toBe('allow');
  });

  it('should default to ask for unknown tools in matrix', () => {
    registry.register({ ...searchTool, id: 'weather' });
    expect(registry.canExecute('weather', matrix)).toBe('ask');
  });

  it('should deny tools marked as NEVER or missing from registry', () => {
    expect(registry.canExecute('payments', matrix)).toBe('NEVER');
    expect(registry.canExecute('non_existent', matrix)).toBe('NEVER');
  });

  it('should generate a dry run preview', () => {
    const preview = dryRun.generatePreview(searchTool, { query: 'Solid state battery' });
    expect(preview).toContain('Aura-lie wants to run search');
    expect(preview).toContain('"query":"Solid state battery"');
  });
});