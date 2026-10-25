// === FILE START ===
// packages/agents/test/cli-v2.test.ts
// PRD §14.6 · FR-DEV-05.

import { describe, it, expect } from 'vitest';
import {
  parseCli,
  resolveCli,
  renderHelp,
  renderCommand,
  VERSION,
} from '../src/cli-v2.js';

describe('cli — parseCli happy paths', () => {
  it('empty argv → help', () => {
    expect(parseCli([]).name).toBe('help');
  });

  it('health → health command', () => {
    expect(parseCli(['health']).name).toBe('health');
  });

  it('chat joins the remaining tokens into one message', () => {
    const c = parseCli(['chat', 'hello', 'world']);
    expect(c.name).toBe('chat');
    expect(c.args).toEqual(['hello world']);
  });

  it('memory add joins the remaining tokens', () => {
    const c = parseCli(['memory', 'add', 'prefers', 'tables']);
    expect(c.name).toBe('memory-add');
    expect(c.args).toEqual(['prefers tables']);
  });

  it('memory forget captures the id', () => {
    expect(parseCli(['memory', 'forget', 'm1']).args).toEqual(['m1']);
  });

  it('mission create joins the goal', () => {
    expect(parseCli(['mission', 'create', 'ship', 'v1']).args).toEqual(['ship v1']);
  });

  it('mission get captures the id', () => {
    expect(parseCli(['mission', 'get', 'm1']).args).toEqual(['m1']);
  });
});

describe('cli — parseCli rejections', () => {
  it('unknown command throws', () => {
    expect(() => parseCli(['nope'])).toThrow();
  });

  it('chat without a message throws', () => {
    expect(() => parseCli(['chat'])).toThrow();
  });

  it('verify without a claimId throws', () => {
    expect(() => parseCli(['verify'])).toThrow();
  });

  it('memory without a subcommand throws', () => {
    expect(() => parseCli(['memory'])).toThrow();
    expect(() => parseCli(['memory', 'nope'])).toThrow();
  });

  it('mission without a subcommand throws', () => {
    expect(() => parseCli(['mission'])).toThrow();
  });
});

describe('cli — resolveCli', () => {
  it('health resolves to GET /health with public auth', () => {
    const r = resolveCli(parseCli(['health']));
    expect(r.method).toBe('GET');
    expect(r.path).toBe('/health');
    expect(r.auth).toBe('public');
  });

  it('chat resolves to POST /v1/chat with bearer auth', () => {
    const r = resolveCli(parseCli(['chat', 'hi']));
    expect(r.method).toBe('POST');
    expect(r.path).toBe('/v1/chat');
    expect(r.auth).toBe('bearer');
    expect(r.body).toEqual({ message: 'hi' });
  });

  it('memory forget resolves to DELETE /v1/memory/:id', () => {
    const r = resolveCli(parseCli(['memory', 'forget', 'm1']));
    expect(r.method).toBe('DELETE');
    expect(r.path).toBe('/v1/memory/m1');
  });
});

describe('cli — render', () => {
  it('renderHelp names every command family', () => {
    const text = renderHelp();
    expect(text).toContain('health');
    expect(text).toContain('chat');
    expect(text).toContain('verify');
    expect(text).toContain('memory');
    expect(text).toContain('mission');
    expect(text).toContain('quota');
    expect(text).toContain('receipt');
    expect(text).toContain('version');
  });

  it('renderCommand(help) returns the help text', () => {
    expect(renderCommand({ name: 'help', args: [] })).toBe(renderHelp());
  });

  it('renderCommand(version) returns the version string', () => {
    expect(renderCommand({ name: 'version', args: [] })).toBe('aura-lie CLI ' + VERSION);
  });

  it('renderCommand(chat hi) names the HTTP verb, path, and body', () => {
    const line = renderCommand({ name: 'chat', args: ['hi'] });
    expect(line.startsWith('POST /v1/chat')).toBe(true);
    expect(line).toContain('"message":"hi"');
  });
});

describe('cli — source scan', () => {
  it('source scan: cli-v2.ts imports only relative siblings', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'cli-v2.ts'),
      'utf8',
    );
    const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, '');
    const noLineComments = noBlocks
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    const specifiers = Array.from(
      noLineComments.matchAll(/from\s+['"]([^'"]+)['"]/g),
    ).map((m) => m[1]!);
    const external = specifiers.filter((s) => !s.startsWith('.'));
    expect(external).toEqual([]);
  });
});
// === FILE END ===