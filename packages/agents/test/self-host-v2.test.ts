// === FILE START ===
// packages/agents/test/self-host-v2.test.ts
// PRD §14.8 · §17.8 · §H.3 · F-283.

import { describe, it, expect } from 'vitest';
import {
  SELF_HOST_STEPS,
  VERIFY_CHECKS,
  SECRET_NAMES,
  validateStep,
  runDoctor,
  renderStep,
  renderVerifyChecklist,
  type DoctorConfig,
} from '../src/self-host-v2.js';

describe('self-host — the 10-step walkthrough', () => {
  it('contains exactly 10 steps (§H.3)', () => {
    expect(SELF_HOST_STEPS.length).toBe(10);
  });

  it('step ids are 1..10 in order', () => {
    expect(SELF_HOST_STEPS.map((s) => s.id)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it('every step passes validateStep', () => {
    for (const s of SELF_HOST_STEPS) {
      expect(validateStep(s)).toBe(true);
    }
  });

  it('validateStep rejects an empty title', () => {
    expect(validateStep({ ...SELF_HOST_STEPS[0]!, title: '' })).toBe(false);
  });
});

describe('self-host — the 14 [VERIFY] checks', () => {
  it('contains exactly 14 checks (§17.8)', () => {
    expect(VERIFY_CHECKS.length).toBe(14);
  });

  it('check ids are 1..14 in order', () => {
    expect(VERIFY_CHECKS.map((c) => c.id)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ]);
  });
});

describe('self-host — secret names', () => {
  it('contains MASTER_KEY and both VAPID keys', () => {
    expect(SECRET_NAMES).toContain('MASTER_KEY');
    expect(SECRET_NAMES).toContain('VAPID_PUBLIC_KEY');
    expect(SECRET_NAMES).toContain('VAPID_PRIVATE_KEY');
  });
});

describe('self-host — doctor', () => {
  function goodConfig(): DoctorConfig {
    return {
      nodeVersion: '24.22.0',
      pnpmVersion: '10.0.0',
      hasCard: false,
      hasAiBinding: true,
      hasSecret: ['MASTER_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'],
    };
  }

  it('valid config → ok:true, no errors', () => {
    const r = runDoctor(goodConfig());
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('hasCard:true → ok:false with an error mentioning payment method', () => {
    const r = runDoctor({ ...goodConfig(), hasCard: true });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('payment'))).toBe(true);
  });

  it('hasAiBinding:false → ok:false', () => {
    const r = runDoctor({ ...goodConfig(), hasAiBinding: false });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('Workers AI'))).toBe(true);
  });

  it('missing MASTER_KEY → ok:false', () => {
    const r = runDoctor({ ...goodConfig(), hasSecret: ['VAPID_PUBLIC_KEY'] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('MASTER_KEY'))).toBe(true);
  });
});

describe('self-host — rendering and determinism', () => {
  it('renderStep returns a single-line string containing "Step"', () => {
    const line = renderStep(SELF_HOST_STEPS[0]!);
    expect(line.startsWith('Step 1.')).toBe(true);
    expect(line).not.toContain('\n');
  });

  it('renderVerifyChecklist produces one line per check', () => {
    const text = renderVerifyChecklist();
    const lines = text.split('\n');
    expect(lines.length).toBe(VERIFY_CHECKS.length);
    for (const line of lines) {
      expect(line.startsWith('[VERIFY ')).toBe(true);
    }
  });
});

describe('self-host — source scan', () => {
  it('source scan: self-host-v2.ts has zero imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'self-host-v2.ts'),
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