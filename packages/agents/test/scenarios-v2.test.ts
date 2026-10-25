// === FILE START ===
// packages/agents/test/scenarios-v2.test.ts
// PRD §15.5.

import { describe, it, expect } from 'vitest';
import {
  SCENARIOS,
  getScenario,
  checkScenario,
  type CapabilityScenario,
} from '../src/scenarios-v2.js';

function scenarioById(id: string): CapabilityScenario {
  const s = getScenario(id as never);
  if (s === null) throw new Error(`scenario not found: ${id}`);
  return s;
}

describe('scenarios — presence and shape', () => {
  it('all five PRD §15.5 scenarios are present', () => {
    expect(SCENARIOS.length).toBe(5);
    const ids = SCENARIOS.map((s) => s.id).sort();
    expect(ids).toEqual([
      'error-recovery',
      'irreversible-stop',
      'next-day-resume',
      'stranger-replay',
      'unfamiliar-goal',
    ]);
  });

  it('every scenario has a non-empty expectedEvents sequence', () => {
    for (const s of SCENARIOS) {
      expect(s.expectedEvents.length).toBeGreaterThan(0);
      for (const e of s.expectedEvents) {
        expect(typeof e).toBe('string');
        expect(e.length).toBeGreaterThan(0);
      }
    }
  });

  it('scenario ids are unique', () => {
    const seen = new Set<string>();
    for (const s of SCENARIOS) {
      expect(seen.has(s.id)).toBe(false);
      seen.add(s.id);
    }
  });
});

describe('scenarios — lookup', () => {
  it('getScenario returns the matching scenario', () => {
    const s = getScenario('unfamiliar-goal');
    expect(s).not.toBeNull();
    expect(s!.id).toBe('unfamiliar-goal');
    expect(s!.title.toLowerCase()).toContain('unfamiliar');
  });

  it('getScenario returns null for an unknown id', () => {
    // @ts-expect-error deliberate unknown id
    expect(getScenario('does-not-exist')).toBeNull();
  });
});

describe('scenarios — checkScenario success path', () => {
  it('passes when all expected events appear in order', () => {
    const s = scenarioById('next-day-resume');
    const r = checkScenario(s, ['load-state', 'resume', 'execute']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.matched).toEqual(['load-state', 'resume', 'execute']);
  });

  it('passes when extra events are interleaved', () => {
    const s = scenarioById('next-day-resume');
    const r = checkScenario(s, [
      'noise',
      'load-state',
      'noise',
      'resume',
      'noise',
      'execute',
      'noise',
    ]);
    expect(r.ok).toBe(true);
  });

  it('passes on the unfamiliar-goal scenario for a realistic run', () => {
    const s = scenarioById('unfamiliar-goal');
    const recorded = [
      'plan',
      'quota-notice',
      'search',
      'search',
      'ask-user',
      'user-replied',
      'search',
      'synthesise',
      'done',
    ];
    const r = checkScenario(s, recorded);
    expect(r.ok).toBe(true);
  });
});

describe('scenarios — checkScenario failure path', () => {
  it('fails when an expected event is missing', () => {
    const s = scenarioById('irreversible-stop');
    const r = checkScenario(s, ['plan', 'execute']);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing).toEqual(['permission-required']);
    expect(r.firstMissingAt).toBe(2);
  });

  it('fails when expected events appear out of order', () => {
    const s = scenarioById('next-day-resume');
    const r = checkScenario(s, ['resume', 'execute', 'load-state']);
    expect(r.ok).toBe(false);
  });

  it('fails when recorded events are empty', () => {
    const s = scenarioById('stranger-replay');
    const r = checkScenario(s, []);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.firstMissingAt).toBe(0);
    expect(r.missing.length).toBe(s.expectedEvents.length);
  });
});

describe('scenarios — determinism and source scan', () => {
  it('checkScenario is deterministic', () => {
    const s = scenarioById('error-recovery');
    const trace = [
      'plan', 'search', 'error', 'retry', 'search', 'conflict', 'resolve',
    ];
    const a = checkScenario(s, trace);
    const b = checkScenario(s, trace);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('source scan: scenarios-v2.ts has zero imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'scenarios-v2.ts'),
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