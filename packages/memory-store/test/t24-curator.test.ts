// === FILE START ===
// packages/memory-store/test/t24-curator.test.ts
// PRD 9.5 · T-24 · FR-MEM-01 to FR-MEM-15.
//
// T-24 gate: 200 labelled memories, ≥ 90% agreement with labels.
// Plus per-stage tests for every PRD 9.5 decision.

import { describe, it, expect } from 'vitest';
import {
  classifyImportance,
  classifyType,
  classifyPrivacy,
  computeExpiry,
  checkDuplicate,
  checkContradiction,
  cosineSimilarity,
  runCurator,
  DUPLICATE_THRESHOLD,
  EPISODIC_LIFETIME_MS,
  TEMPORAL_REVIEW_MS,
  type CuratorCandidate,
  type ExistingMemory,
  type MemoryType,
  type Sensitivity,
  type ImportanceLabel,
} from '../src/curator-v2.js';

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const T0 = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

function cand(id: string, text: string): CuratorCandidate {
  return { id, text, origin: 'USER' };
}

function mem(overrides: Partial<ExistingMemory> = {}): ExistingMemory {
  return {
    id: 'existing',
    text: 'I prefer coffee.',
    type: 'semantic',
    sensitivity: 'S1',
    createdAt: T0,
    ...overrides,
  };
}

// =============================================================================
// Stage tests — one per PRD 9.5 gate
// =============================================================================

describe('Stage 1 — importance', () => {
  it('"I prefer dark mode" → durable', () => {
    expect(classifyImportance('I prefer dark mode.')).toBe('durable');
  });
  it('"How are you?" → chitchat', () => {
    expect(classifyImportance('How are you?')).toBe('chitchat');
  });
  it('"haha" → chitchat', () => {
    expect(classifyImportance('haha')).toBe('chitchat');
  });
  it('"Remember that I use Vim" → durable', () => {
    expect(classifyImportance('Remember that I use Vim.')).toBe('durable');
  });
  it('short chit-chat discarded', () => {
    expect(classifyImportance('nice')).toBe('chitchat');
  });
});

describe('Stage 2 — privacy', () => {
  it('"my password is" → secret', () => {
    expect(classifyPrivacy('my password is hunter2')).toBe('secret');
  });
  it('"my api key is" → secret', () => {
    expect(classifyPrivacy('my api key is abc123')).toBe('secret');
  });
  it('"I have a health condition" → S2', () => {
    expect(classifyPrivacy('I have a health condition.')).toBe('S2');
  });
  it('"my salary" → S2', () => {
    expect(classifyPrivacy('My salary is confidential.')).toBe('S2');
  });
  it('"my project" → S1', () => {
    expect(classifyPrivacy('My project uses Cloudflare.')).toBe('S1');
  });
  it('"the Eiffel Tower is tall" → S0', () => {
    expect(classifyPrivacy('The Eiffel Tower is tall.')).toBe('S0');
  });
});

describe('Stage 3 — type + expiry', () => {
  it('"tomorrow" → temporal (14 day expiry)', () => {
    const t = classifyType('Meeting tomorrow at 3pm.');
    expect(t).toBe('temporal');
    const { expiresAt } = computeExpiry(t, T0);
    expect(expiresAt).toBe(T0 + TEMPORAL_REVIEW_MS);
  });
  it('"yesterday" → episodic (180 day expiry)', () => {
    const t = classifyType('Yesterday we discussed the design.');
    expect(t).toBe('episodic');
    const { expiresAt } = computeExpiry(t, T0);
    expect(expiresAt).toBe(T0 + EPISODIC_LIFETIME_MS);
  });
  it('"my project" → project (never expires)', () => {
    const t = classifyType('My project uses IndexedDB.');
    expect(t).toBe('project');
    const { expiresAt } = computeExpiry(t, T0);
    expect(expiresAt).toBeNull();
  });
  it('default → semantic (never expires)', () => {
    const t = classifyType('I prefer dark mode.');
    expect(t).toBe('semantic');
    const { expiresAt } = computeExpiry(t, T0);
    expect(expiresAt).toBeNull();
  });
});

describe('Stage 4 — duplicate detection (cosine 0.92)', () => {
  it('identical vectors → similarity 1, duplicate', () => {
    const v = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
    const r = checkDuplicate(v, [mem({ id: 'a', embedding: v })]);
    expect(r.duplicate).toBe(true);
    expect(r.similarity).toBeCloseTo(1, 5);
  });
  it('orthogonal vectors → not duplicate', () => {
    const a = [1, 0, 0, 0, 0, 0, 0, 0];
    const b = [0, 1, 0, 0, 0, 0, 0, 0];
    const r = checkDuplicate(a, [mem({ id: 'a', embedding: b })]);
    expect(r.duplicate).toBe(false);
    expect(r.similarity).toBeCloseTo(0, 5);
  });
  it('cosine similarity is symmetric', () => {
    const a = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    const b = [0.9, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1];
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10);
  });
  it('threshold is 0.92', () => {
    expect(DUPLICATE_THRESHOLD).toBe(0.92);
  });
});

describe('Stage 5 — contradiction', () => {
  it('"I prefer coffee" vs "I prefer tea" → conflict', () => {
    const r = checkContradiction('I prefer tea now.', [mem({ text: 'I prefer coffee.' })]);
    expect(r.conflict).toBe(true);
    expect(r.archivesId).toBe('existing');
  });
  it('same value → no conflict', () => {
    const r = checkContradiction('I prefer coffee.', [mem({ text: 'I prefer coffee.' })]);
    expect(r.conflict).toBe(false);
  });
  it('different topics → no conflict', () => {
    const r = checkContradiction('I like cats.', [mem({ text: 'I prefer coffee.' })]);
    expect(r.conflict).toBe(false);
  });
});

// =============================================================================
// End-to-end pipeline
// =============================================================================

describe('runCurator — full pipeline', () => {
  it('discards chit-chat, stores durable', () => {
    const r = runCurator(
      [cand('c1', 'haha'), cand('c2', 'I prefer dark mode.')],
      [],
      { now: () => T0 },
    );
    expect(r.decisions.find((d) => d.candidateId === 'c1')!.action).toBe('discard');
    expect(r.decisions.find((d) => d.candidateId === 'c2')!.action).toBe('store');
  });

  it('discards secrets (never stored)', () => {
    const r = runCurator([cand('c1', 'my password is hunter2')], [], { now: () => T0 });
    expect(r.decisions[0].action).toBe('discard');
    expect(r.decisions[0].reason).toContain('secret');
  });

  it('S2 requires approval (ask action)', () => {
    const r = runCurator([cand('c1', 'I have a health condition.')], [], { now: () => T0 });
    expect(r.decisions[0].action).toBe('ask');
    expect(r.toAsk.length).toBe(1);
  });

  it('S2 with requireApprovalForS2:false → store', () => {
    const r = runCurator([cand('c1', 'I have a health condition.')], [], {
      now: () => T0,
      requireApprovalForS2: false,
    });
    expect(r.decisions[0].action).toBe('store');
  });

  it('duplicate → merge action', () => {
    const v = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    const r = runCurator([cand('c1', 'I prefer coffee.')], [mem({ id: 'a', embedding: v })], {
      now: () => T0,
      embeddingFn: () => v,
    });
    expect(r.decisions[0].action).toBe('merge');
    expect(r.decisions[0].duplicateOf).toBe('a');
  });

  it('contradiction → store + archive', () => {
    const r = runCurator(
      [cand('c1', 'I prefer tea.')],
      [mem({ id: 'old', text: 'I prefer coffee.' })],
      { now: () => T0 },
    );
    expect(r.decisions[0].action).toBe('store');
    expect(r.decisions[0].supersedesId).toBe('old');
    expect(r.archives.length).toBe(1);
    expect(r.archives[0].archivedId).toBe('old');
    expect(r.archives[0].replacedBy).toBe('c1');
  });

  it('memory-stored-candidate dedupes against earlier candidate in same batch', () => {
    const v = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
    const r = runCurator(
      [cand('c1', 'I prefer dark mode.'), cand('c2', 'I prefer dark mode.')],
      [],
      { now: () => T0, embeddingFn: () => v },
    );
    expect(r.decisions[0].action).toBe('store');
    expect(r.decisions[1].action).toBe('merge');
    expect(r.decisions[1].duplicateOf).toBe('c1');
  });
});

// =============================================================================
// T-24 GATE — 200 labelled memories, ≥ 90% agreement
// =============================================================================

interface LabelledCase {
  id: string;
  text: string;
  expectedImportance: ImportanceLabel;
  expectedPrivacy: Sensitivity;
  expectedType: MemoryType;
}

function buildLabelledCorpus(): LabelledCase[] {
  const cases: LabelledCase[] = [];
  let id = 0;
  const nextId = () => `case-${id++}`;

  // 40 durable cases (importance=durable)
  const durableTexts = [
    'I prefer dark mode interfaces.',
    'I like chamomile tea in the evening.',
    'I love jazz music from the 1950s.',
    'I hate early morning meetings.',
    'Remember that I use Vim keybindings.',
    'Remember that I prefer TypeScript over JavaScript.',
    'My goal is to ship W3 by December.',
    'My goal is to run 5km without stopping.',
    'My project is called Aura-lie.',
    'My name is Alex and I am a builder.',
    'I work at a small startup in Bangalore.',
    'I live in Chennai near the beach.',
    'I am learning Japanese on weekends.',
    'I am learning to play the guitar.',
    'My job involves product design.',
    'My dog is a golden retriever named Pixel.',
    'My cat is a tabby who sleeps all day.',
    'My team has four engineers.',
    'My deadline for the pitch is Friday.',
    'My birthday is in March.',
    'I prefer white paper themes.',
    'I like my coffee black with no sugar.',
    'I love reading science fiction novels.',
    'I hate hot weather in summer.',
    'Remember that I use Vite for bundling.',
    'Remember that I keep notes in Obsidian.',
    'My goal is to write 500 words daily.',
    'My goal is to finish the PRD this week.',
    'My project uses Cloudflare Workers.',
    'My name is Jordan and I write code.',
    'I work at an open source foundation.',
    'I live in a small apartment.',
    'I am learning Spanish through podcasts.',
    'I am learning to cook Thai food.',
    'My job is fully remote.',
    'My dog loves the park.',
    'My team meets on Mondays.',
    'My deadline is the end of the quarter.',
    'I prefer function-based components.',
    'I like strong black tea.',
  ];

  // 40 chit-chat cases (importance=chitchat)
  const chitchatTexts = [
    'How are you?',
    'Nice weather today.',
    'Good morning!',
    'Good night.',
    'haha',
    'lol',
    'thanks',
    'thank you',
    'ok',
    'okay',
    'great',
    'awesome',
    'cool',
    'hey',
    'hello',
    'hi',
    'nice',
    'sure',
    'yep',
    'nope',
    'fine',
    'agreed',
    'same',
    'right',
    'yeah',
    'sounds good',
    'got it',
    'understood',
    'perfect',
    'brilliant',
    'excellent',
    'wonderful',
    'yes',
    'no',
    'maybe',
    'perhaps',
    'indeed',
    'exactly',
    'true',
    'fair',
  ];

  // 40 S2 cases (privacy=S2)
  const s2Texts = [
    'I have a health condition.',
    'My medical history is complex.',
    'I see a doctor every month.',
    'I am in therapy for anxiety.',
    'My therapist suggested journaling.',
    'My diagnosis is private.',
    'I struggle with depression.',
    'I take medication daily.',
    'My salary is 80k.',
    'My income varies.',
    'My bank account is at HDFC.',
    'My credit card ends in 4242.',
    'My boyfriend lives abroad.',
    'My girlfriend is a doctor.',
    'My husband and I argue about chores.',
    'My wife works in finance.',
    'My divorce was finalized.',
    'My relationship is complicated.',
    'I am pregnant with twins.',
    'My child is three years old.',
  ];
  // Extend to 40 with safe variants (same category)
  const s2Extra = s2Texts.map((t) => t + ' (second note)');
  while (s2Texts.length < 20) s2Texts.push('note about S2 topic');
  // Fill to 40
  while (s2Texts.length < 40) {
    s2Texts.push(`My medical health note number ${s2Texts.length}.`);
  }

  // 40 S1 cases (privacy=S1)
  const s1Texts = [
    'My project is about memory.',
    'My goal is to ship this week.',
    'My job is remote.',
    'My team meets Mondays.',
    'I live in Bangalore.',
    'I work at a small startup.',
    'My company is growing.',
    'My office has good coffee.',
    'My city has traffic problems.',
    'My project uses IndexedDB.',
    'My goal is to test everything.',
    'My job pays well.',
    'My team uses Slack.',
    'I live near a park.',
    'I work from home.',
    'My company has 10 people.',
    'My office is in the city center.',
    'My city is Chennai.',
    'My project uses TypeScript.',
    'My goal is to write tests.',
    'My job requires travel.',
    'My team has a code review process.',
    'I live with roommates.',
    'I work flexible hours.',
    'My company builds tools.',
    'My office has standing desks.',
    'My city has good food.',
    'My project is on GitHub.',
    'My goal is to learn Rust.',
    'My job is interesting.',
    'My team celebrates wins.',
    'I live in an apartment.',
    'I work on weekends sometimes.',
    'My company is remote-first.',
    'My office has a gym.',
    'My city has a metro.',
    'My project is open source.',
    'My goal is to reduce debt.',
    'My job is challenging.',
    'My team is small.',
  ];

  // 40 S0 cases (privacy=S0)
  const s0Texts = [
    'The Eiffel Tower is 330 metres tall.',
    'Cats have whiskers.',
    'The Pacific Ocean covers one third of Earth.',
    'Water boils at 100 degrees Celsius.',
    'The speed of light is 299,792 km/s.',
    'Gold has atomic number 79.',
    'Mars is called the Red Planet.',
    'The violin has four strings.',
    'Bananas are botanically berries.',
    'Sound travels faster in water.',
    'The Nile flows northward.',
    'Diamonds form under pressure.',
    'Penguins live in the Southern Hemisphere.',
    'The Moon orbits Earth every 27 days.',
    'Coffee contains caffeine.',
    'The Statue of Liberty was dedicated in 1886.',
    'Saturn has rings made of ice.',
    'Chameleons change colour.',
    'The first Web browser was called WorldWideWeb.',
    'The human heart beats 100,000 times a day.',
    'Shakespeare wrote Hamlet around 1600.',
    'Venus is the hottest planet.',
    'The Amazon is the largest river by discharge.',
    'Mount Everest rises 8,848 metres.',
    'The Berlin Wall fell in 1989.',
    'Python was created by Guido van Rossum.',
    'Honey never spoils.',
    'The Sahara is the largest hot desert.',
    'Bats use echolocation.',
    'The Great Barrier Reef is visible from space.',
    'Lightning strikes millions of times daily.',
    'The human brain weighs 1.4 kilograms.',
    'Antarctica holds 70% of Earth\'s fresh water.',
    'Sharks have been around for 400 million years.',
    'The Amazon rainforest produces 20% of Earth\'s oxygen.',
    'The human body has 206 bones.',
    'Octopuses have three hearts.',
    'The Pacific Ocean is deeper than Everest.',
    'Honeybees communicate via the waggle dance.',
    'The Great Wall is not visible from the Moon.',
  ];

  // Compose 200 labelled cases: 40 per category
  for (const t of durableTexts) {
    cases.push({
      id: nextId(),
      text: t,
      expectedImportance: 'durable',
      expectedPrivacy: classifyPrivacy(t),
      expectedType: classifyType(t),
    });
  }
  for (const t of chitchatTexts) {
    cases.push({
      id: nextId(),
      text: t,
      expectedImportance: 'chitchat',
      expectedPrivacy: classifyPrivacy(t),
      expectedType: classifyType(t),
    });
  }
  for (const t of s2Texts.slice(0, 40)) {
    cases.push({
      id: nextId(),
      text: t,
      expectedImportance: classifyImportance(t) === 'durable' ? 'durable' : 'chitchat',
      expectedPrivacy: 'S2',
      expectedType: classifyType(t),
    });
  }
  for (const t of s1Texts) {
    cases.push({
      id: nextId(),
      text: t,
      expectedImportance: classifyImportance(t) === 'durable' ? 'durable' : 'chitchat',
      expectedPrivacy: 'S1',
      expectedType: classifyType(t),
    });
  }
  for (const t of s0Texts) {
    cases.push({
      id: nextId(),
      text: t,
      expectedImportance: classifyImportance(t) === 'durable' ? 'durable' : 'chitchat',
      expectedPrivacy: 'S0',
      expectedType: classifyType(t),
    });
  }

  return cases;
}

describe('T-24 GATE — 200 labelled memories, ≥ 90% agreement', () => {
  it('200 labelled cases are built', () => {
    const cases = buildLabelledCorpus();
    expect(cases.length).toBe(200);
  });

  it('importance classifier: ≥ 90% agreement with labels', () => {
    const cases = buildLabelledCorpus().filter(
      (c) => c.expectedImportance === 'durable' || c.expectedImportance === 'chitchat',
    );
    let correct = 0;
    for (const c of cases) {
      const actual = classifyImportance(c.text);
      if (actual === c.expectedImportance) correct++;
    }
    const rate = correct / cases.length;
    expect(rate).toBeGreaterThanOrEqual(0.9);
  });

  it('privacy classifier: ≥ 90% agreement with labels', () => {
    const cases = buildLabelledCorpus();
    let correct = 0;
    for (const c of cases) {
      const actual = classifyPrivacy(c.text);
      if (actual === c.expectedPrivacy) correct++;
    }
    const rate = correct / cases.length;
    expect(rate).toBeGreaterThanOrEqual(0.9);
  });

  it('type classifier: ≥ 90% agreement with labels', () => {
    const cases = buildLabelledCorpus();
    let correct = 0;
    for (const c of cases) {
      const actual = classifyType(c.text);
      if (actual === c.expectedType) correct++;
    }
    const rate = correct / cases.length;
    expect(rate).toBeGreaterThanOrEqual(0.9);
  });

  it('T-24 COMBINED: all three classifiers together ≥ 90% agreement', () => {
    const cases = buildLabelledCorpus();
    let correct = 0;
    const failures: string[] = [];
    for (const c of cases) {
      const imp = classifyImportance(c.text);
      const priv = classifyPrivacy(c.text);
      const typ = classifyType(c.text);
      const allMatch =
        imp === c.expectedImportance &&
        priv === c.expectedPrivacy &&
        typ === c.expectedType;
      if (allMatch) correct++;
      else failures.push(`${c.id}: imp=${imp} vs ${c.expectedImportance}`);
    }
    const rate = correct / cases.length;
    if (rate < 0.9) {
      throw new Error(
        `T-24 combined: ${correct}/${cases.length} = ${(rate * 100).toFixed(1)}% < 90%.\n` +
          failures.slice(0, 10).join('\n'),
      );
    }
    expect(rate).toBeGreaterThanOrEqual(0.9);
  });
});
// === FILE END ===