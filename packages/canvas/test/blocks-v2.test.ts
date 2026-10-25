// === FILE START ===
// packages/canvas/test/blocks-v2.test.ts
// PRD §7.12 · FR-CANVAS-02 · T-13.

import { describe, it, expect } from 'vitest';
import {
  chooseBlock,
  ALL_BLOCK_TYPES,
  type Intent,
} from '../src/blocks-v2.js';

describe('blocks — intent → block mapping (PRD §7.12)', () => {
  const cases: [Intent, string][] = [
    ['answer', 'paragraph'],
    ['comparison', 'comparison-table'],
    ['process', 'numbered-steps'],
    ['research', 'evidence-blocks'],
    ['code', 'code-panel'],
    ['planning', 'checklist'],
    ['uncertainty', 'unknowns-panel'],
    ['troubleshooting', 'decision-tree'],
    ['action', 'task-card'],
    ['unknown', 'paragraph'],
  ];

  for (const [intent, expected] of cases) {
    it(`${intent} → ${expected}`, () => {
      expect(chooseBlock(intent)).toBe(expected);
    });
  }
});

describe('blocks — anti over-formatting', () => {
  it('unknown intent → paragraph fallback', () => {
    const notAnIntent = 'casual-chat' as unknown as Intent;
    expect(chooseBlock(notAnIntent)).toBe('paragraph');
  });

  it('every returned block type is in the frozen set', () => {
    const intents: Intent[] = [
      'answer',
      'comparison',
      'process',
      'research',
      'code',
      'planning',
      'uncertainty',
      'troubleshooting',
      'action',
      'unknown',
    ];
    for (const i of intents) {
      expect(ALL_BLOCK_TYPES).toContain(chooseBlock(i));
    }
  });
});

describe('blocks — ALL_BLOCK_TYPES is frozen and complete', () => {
  it('has exactly 10 entries', () => {
    expect(ALL_BLOCK_TYPES.length).toBe(10);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(ALL_BLOCK_TYPES)).toBe(true);
  });

  it('contains every distinct value chooseBlock can return', () => {
    const intents: Intent[] = [
      'answer',
      'comparison',
      'process',
      'research',
      'code',
      'planning',
      'uncertainty',
      'troubleshooting',
      'action',
      'unknown',
    ];
    const produced = new Set(intents.map(chooseBlock));
    for (const p of produced) {
      expect(ALL_BLOCK_TYPES).toContain(p);
    }
  });

  it('contains paragraph', () => {
    expect(ALL_BLOCK_TYPES).toContain('paragraph');
  });
});
// === FILE END ===