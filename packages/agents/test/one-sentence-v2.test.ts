// === FILE START ===
// packages/agents/test/one-sentence-v2.test.ts
// PRD §10.9 · FR-AGENT-07 · F-102.

import { describe, it, expect } from 'vitest';
import {
  parseOneSentence,
  DEFAULT_TIME,
  DEFAULT_TIMEZONE,
} from '../src/one-sentence-v2.js';

describe('one-sentence — supported phrasings', () => {
  it('parses "Every Monday, tell me what changed in my project"', () => {
    const r = parseOneSentence('Every Monday, tell me what changed in my project');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.schedule.frequency).toBe('weekly');
    expect(r.spec.schedule.weekday).toBe('monday');
    expect(r.spec.action).toBe('report-changes');
    expect(r.spec.target).toBe('my project');
    expect(r.spec.schedule.timeOfDay).toBe(DEFAULT_TIME);
    expect(r.spec.schedule.timezone).toBe(DEFAULT_TIMEZONE);
  });

  it('parses "Every day, summarise my notes"', () => {
    const r = parseOneSentence('Every day, summarise my notes');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.schedule.frequency).toBe('daily');
    expect(r.spec.schedule.weekday).toBeUndefined();
    expect(r.spec.action).toBe('summarise');
    expect(r.spec.target).toBe('my notes');
  });

  it('parses "Every Friday at 17:00, remind me to review the sprint"', () => {
    const r = parseOneSentence('Every Friday at 17:00, remind me to review the sprint');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.schedule.frequency).toBe('weekly');
    expect(r.spec.schedule.weekday).toBe('friday');
    expect(r.spec.schedule.timeOfDay).toBe('17:00');
    expect(r.spec.action).toBe('remind');
    expect(r.spec.target).toBe('the sprint');
  });

  it('parses "Every month, tell me what changed in Q4"', () => {
    const r = parseOneSentence('Every month, tell me what changed in Q4');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.schedule.frequency).toBe('monthly');
    expect(r.spec.action).toBe('report-changes');
    expect(r.spec.target).toBe('Q4');
  });
});

describe('one-sentence — rejections', () => {
  it('rejects empty input', () => {
    const r = parseOneSentence('');
    expect(r.ok).toBe(false);
  });

  it('rejects unsupported phrasing ("Sometimes ...")', () => {
    const r = parseOneSentence('Sometimes, do the dishes');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason.toLowerCase()).toContain('unsupported');
  });

  it('rejects an out-of-range hour', () => {
    const r = parseOneSentence('Every day at 99:00, summarise my notes');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('hour');
  });

  it('rejects non-string input', () => {
    // @ts-expect-error deliberate invalid input
    const r = parseOneSentence(null);
    expect(r.ok).toBe(false);
  });
});

describe('one-sentence — shape and determinism', () => {
  it('weekday is captured as one of the seven canonical lowercase days', () => {
    const r = parseOneSentence('Every Wednesday, summarise the roadmap');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.schedule.weekday).toBe('wednesday');
  });

  it('default time is 09:00 when no time is given', () => {
    const r = parseOneSentence('Every day, summarise X');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.schedule.timeOfDay).toBe('09:00');
  });

  it('confirmation card contains the target', () => {
    const r = parseOneSentence('Every Monday, tell me what changed in my project');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.confirmation).toContain('my project');
    expect(r.spec.confirmation).toContain('Nothing runs until you confirm');
  });

  it('is deterministic (same input → identical spec)', () => {
    const a = parseOneSentence('Every Monday, tell me what changed in my project');
    const b = parseOneSentence('Every Monday, tell me what changed in my project');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('source scan: one-sentence-v2.ts has zero imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'one-sentence-v2.ts'),
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
    expect(specifiers).toEqual([]);
  });
});
// === FILE END ===