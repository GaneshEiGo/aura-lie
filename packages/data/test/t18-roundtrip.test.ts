// === FILE START ===
// packages/data/test/t18-roundtrip.test.ts
// PRD 9.9 · FR-DATA-01 to FR-DATA-03 · FR-DATA-08 · T-18.
//
// T-18 gate:
//   · Full export → import → identical state (round-trip equal)
//   · Shareable excludes memory, S2, reasoning, audit, settings
//   · Anonymised excludes the same AND replaces PII with stable placeholders
//   · 0 leaks across all three profiles

import { describe, it, expect } from 'vitest';
import {
  buildFullExport,
  buildShareableExport,
  buildAnonymisedExport,
  createStableAnonymiser,
  type FullStoreInput,
} from '../src/export-profiles.js';
import {
  previewImport,
  applyImport,
  type MergeableStore,
} from '../src/import-package.js';

// -----------------------------------------------------------------------------
// Fixtures — a plausible full store
// -----------------------------------------------------------------------------

function makeInput(): FullStoreInput {
  return {
    profileId: 'p1',
    exportedAt: '2026-10-02T12:00:00Z',
    messages: [
      {
        id: 'm1',
        text: 'Email me at alice@example.com',
        role: 'user',
        createdAt: '2026-10-01T10:00:00Z',
        reasoning: 'The user wants a reply',
      },
      {
        id: 'm2',
        text: 'Contacted via +91 98765 43210',
        role: 'assistant',
        createdAt: '2026-10-01T10:01:00Z',
      },
    ],
    claims: [
      {
        id: 'c1',
        text: 'The speed of light is 299,792 km/s',
        status: 'VERIFIED',
        score: 92,
        sensitivity: 'S0',
        evidence: [
          {
            id: 'e1',
            claimId: 'c1',
            sourceId: 's1',
            quote: 'speed of light is 299,792 km/s',
            matchOk: true,
            stance: 'supports',
          },
        ],
        reasoning: 'Straightforward match',
      },
      {
        id: 'c2',
        text: 'My SSN is 123-45-6789',
        status: 'MIXED',
        score: 55,
        sensitivity: 'S2',
        evidence: [
          {
            id: 'e2',
            claimId: 'c2',
            sourceId: 's2',
            quote: 'ssn',
            matchOk: true,
            stance: 'neutral',
          },
        ],
      },
      {
        id: 'c3',
        text: 'No evidence claim',
        status: 'WEAK',
        score: 30,
        sensitivity: 'S0',
        evidence: [],
      },
    ],
    sources: [
      {
        id: 's1',
        url: 'https://nasa.gov/speed-of-light',
        title: 'Speed of Light — NASA',
        domain: 'nasa.gov',
        fetchedAt: '2026-10-01T11:00:00Z',
      },
      {
        id: 's2',
        url: 'https://private.example.com',
        title: 'Private Source',
        domain: 'private.example.com',
        fetchedAt: '2026-10-01T11:00:00Z',
      },
    ],
    memories: [
      {
        id: 'mem1',
        text: 'Prefers minimal interfaces',
        origin: 'USER',
        sensitivity: 'S1',
        createdAt: '2026-09-30T08:00:00Z',
      },
      {
        id: 'mem2',
        text: 'Emotional history',
        origin: 'USER',
        sensitivity: 'S1',
        createdAt: '2026-09-30T08:00:00Z',
        emotional: true,
      },
      {
        id: 'mem3',
        text: 'Health condition',
        origin: 'FILE',
        sensitivity: 'S2',
        createdAt: '2026-09-30T08:00:00Z',
      },
    ],
    auditLog: [
      { id: 'a1', action: 'MEMORY_ADDED', at: '2026-09-30T08:00:00Z', metadata: {} },
    ],
    settings: {
      theme: 'paper',
      autonomyLevel: 1,
      quietHours: { start: '23:00', end: '08:00' },
    },
    personas: [{ id: 'yuki', name: 'Yuki', schema: { warmth: 0.25 } }],
  };
}

function toMergeableStore(input: FullStoreInput): MergeableStore {
  return {
    messages: input.messages.map((m) => ({ ...m })),
    claims: input.claims.map((c) => ({
      ...c,
      evidence: c.evidence.map((e) => ({ ...e })),
    })),
    sources: input.sources.map((s) => ({ ...s })),
    memories: input.memories.map((m) => ({ ...m })),
    auditLog: input.auditLog.map((a) => ({ ...a, metadata: { ...a.metadata } })),
    personas: input.personas.map((p) => ({ ...p })),
    settings: { ...input.settings, quietHours: { ...input.settings.quietHours } },
  };
}

const EMPTY_STORE: MergeableStore = {
  messages: [],
  claims: [],
  sources: [],
  memories: [],
  auditLog: [],
  personas: [],
  settings: {},
};

// =============================================================================
// T-18.1 — Full round-trip is identical
// =============================================================================

describe('T-18.1 — Full export round-trip is identical', () => {
  it('buildFullExport → serialize → parse → import → same content', () => {
    const input = makeInput();
    const pkg = buildFullExport(input);

    // Simulate: user saves JSON, later loads it back
    const serialized = JSON.stringify(pkg);
    const reloaded = JSON.parse(serialized);

    const preview = previewImport(EMPTY_STORE, reloaded);
    const restored = applyImport(EMPTY_STORE, preview, {
      conflict: 'keep-local',
    });

    // Every collection deep-equal to the original (minus exportedAt field
    // which lives on the pkg, not on rows)
    expect(restored.messages).toEqual(input.messages.map((m) => ({ ...m })));
    expect(restored.claims).toEqual(
      input.claims.map((c) => ({
        ...c,
        evidence: c.evidence.map((e) => ({ ...e })),
      })),
    );
    expect(restored.sources).toEqual(input.sources.map((s) => ({ ...s })));
    expect(restored.memories).toEqual(input.memories.map((m) => ({ ...m })));
    expect(restored.auditLog).toEqual(
      input.auditLog.map((a) => ({ ...a, metadata: { ...a.metadata } })),
    );
    expect(restored.personas).toEqual(
      input.personas.map((p) => ({ ...p })),
    );
    expect(restored.settings).toEqual(input.settings);
  });

  it('double round-trip is stable (no loss on second export)', () => {
    const input = makeInput();
    const pkg1 = buildFullExport(input);
    const serialized1 = JSON.stringify(pkg1);
    const reloaded1 = JSON.parse(serialized1);
    const preview1 = previewImport(EMPTY_STORE, reloaded1);
    const restored1 = applyImport(EMPTY_STORE, preview1, {
      conflict: 'keep-local',
    });

    // Now export what we restored (plus timestamps from the input)
    const reInput: FullStoreInput = {
      profileId: input.profileId,
      exportedAt: input.exportedAt,
      messages: restored1.messages as FullStoreInput['messages'],
      claims: restored1.claims as FullStoreInput['claims'],
      sources: restored1.sources as FullStoreInput['sources'],
      memories: restored1.memories as FullStoreInput['memories'],
      auditLog: restored1.auditLog as FullStoreInput['auditLog'],
      settings: restored1.settings as FullStoreInput['settings'],
      personas: restored1.personas as FullStoreInput['personas'],
    };
    const pkg2 = buildFullExport(reInput);
    const serialized2 = JSON.stringify(pkg2);

    expect(serialized2).toEqual(serialized1);
  });
});

// =============================================================================
// T-18.2 — Shareable excludes what it promises
// =============================================================================

describe('T-18.2 — Shareable excludes memory, S2, reasoning, audit, settings', () => {
  it('drops the entire memory array', () => {
    const pkg = buildShareableExport(makeInput());
    expect('memories' in pkg.data).toBe(false);
  });

  it('drops S2 claims', () => {
    const pkg = buildShareableExport(makeInput());
    const claims = pkg.data.claims as Array<{ id: string }>;
    expect(claims.some((c) => c.id === 'c2')).toBe(false); // S2 claim
    expect(claims.some((c) => c.id === 'c1')).toBe(true); // S0 with evidence
  });

  it('drops claims with no evidence', () => {
    const pkg = buildShareableExport(makeInput());
    const claims = pkg.data.claims as Array<{ id: string }>;
    expect(claims.some((c) => c.id === 'c3')).toBe(false); // no evidence
  });

  it('strips reasoning from every message and claim', () => {
    const pkg = buildShareableExport(makeInput());
    for (const m of pkg.data.messages as Array<Record<string, unknown>>) {
      expect('reasoning' in m).toBe(false);
    }
    for (const c of pkg.data.claims as Array<Record<string, unknown>>) {
      expect('reasoning' in c).toBe(false);
    }
  });

  it('does not include auditLog, settings, or personas', () => {
    const pkg = buildShareableExport(makeInput());
    expect('auditLog' in pkg.data).toBe(false);
    expect('settings' in pkg.data).toBe(false);
    expect('personas' in pkg.data).toBe(false);
  });

  it('only includes sources referenced by surviving claims', () => {
    const pkg = buildShareableExport(makeInput());
    const sources = pkg.data.sources as Array<{ id: string }>;
    expect(sources.some((s) => s.id === 's1')).toBe(true); // referenced by c1
    expect(sources.some((s) => s.id === 's2')).toBe(false); // referenced by S2 claim c2
  });
});

// =============================================================================
// T-18.3 — Anonymised replaces PII with stable placeholders
// =============================================================================

describe('T-18.3 — Anonymised replaces PII with stable placeholders', () => {
  it('email is replaced and never appears in the output', () => {
    const pkg = buildAnonymisedExport(makeInput());
    const messages = pkg.data.messages as Array<{ text: string }>;
    const joined = messages.map((m) => m.text).join(' ');
    expect(joined).not.toContain('alice@example.com');
    expect(joined).toContain('<email-');
  });

  it('phone number is replaced', () => {
    const pkg = buildAnonymisedExport(makeInput());
    const joined = (pkg.data.messages as Array<{ text: string }>)
      .map((m) => m.text)
      .join(' ');
    expect(joined).not.toContain('98765');
    expect(joined).toMatch(/<phone-\d+>/);
  });

  it('URL is replaced', () => {
    const pkg = buildAnonymisedExport(makeInput());
    const sources = pkg.data.sources as Array<Record<string, unknown>>;
    for (const s of sources) {
      expect(String(s.url ?? '')).not.toContain('https://');
    }
  });

  it('same email maps to same placeholder (stability)', () => {
    const input = makeInput();
    input.messages.push({
      id: 'm3',
      text: 'Again alice@example.com, same person',
      role: 'user',
      createdAt: '2026-10-01T10:02:00Z',
    });
    const anon = createStableAnonymiser();
    const pkg = buildAnonymisedExport(input, anon);
    const joined = (pkg.data.messages as Array<{ text: string }>)
      .map((m) => m.text)
      .join(' ');
    // The same email → the same placeholder; the whole run has one
    // email-like PII token, so one placeholder.
    const matches = joined.match(/<email-\d+>/g) ?? [];
    const unique = new Set(matches);
    expect(matches.length).toBe(2);
    expect(unique.size).toBe(1);
  });

  it('does NOT leak PII even inside quotes', () => {
    const input = makeInput();
    input.claims[0].evidence[0].quote = 'Contact alice@example.com for details';
    const pkg = buildAnonymisedExport(input);
    const claims = pkg.data.claims as Array<{
      evidence: Array<{ quote: string | null }>;
    }>;
    const quotes = claims.flatMap((c) =>
      c.evidence.map((e) => e.quote ?? ''),
    );
    for (const q of quotes) {
      expect(q).not.toContain('alice@example.com');
    }
  });
});

// =============================================================================
// T-18.4 — 0 leaks
// =============================================================================

describe('T-18.4 — GATE: 0 PII leaks across Shareable and Anonymised', () => {
  const INPUT = makeInput();
  const SERIALIZED_SHAREABLE = JSON.stringify(buildShareableExport(INPUT));
  const SERIALIZED_ANONYMISED = JSON.stringify(buildAnonymisedExport(INPUT));

  it('Shareable excludes S2-only rows by definition (S2 claim id c2)', () => {
    expect(SERIALIZED_SHAREABLE).not.toContain('"c2"');
  });

  it('Shareable contains no "emotional":true memory rows', () => {
    expect(SERIALIZED_SHAREABLE).not.toContain('"emotional":true');
  });

  it('Anonymised contains no raw emails', () => {
    expect(SERIALIZED_ANONYMISED).not.toContain('alice@example.com');
  });

  it('Anonymised contains no raw phone numbers', () => {
    expect(SERIALIZED_ANONYMISED).not.toMatch(/98765/);
  });

  it('Anonymised contains no raw URLs', () => {
    expect(SERIALIZED_ANONYMISED).not.toContain('https://');
  });

  it('Shareable contains no reasoning field', () => {
    expect(SERIALIZED_SHAREABLE).not.toContain('"reasoning"');
  });

  it('Full export preserves everything it is allowed to (memory, S2, reasoning, audit, settings)', () => {
    const full = JSON.stringify(buildFullExport(INPUT));
    expect(full).toContain('"mem3"'); // S2 memory
    expect(full).toContain('"reasoning"');
    expect(full).toContain('"a1"'); // audit row
    expect(full).toContain('"paper"'); // settings
  });

  it('Full export never contains an API key field', () => {
    const full = JSON.stringify(buildFullExport(INPUT));
    expect(full).not.toMatch(/"apiKey"|"api_key"|"GROQ_API_KEY"|"GEMINI_API_KEY"/);
  });
});

// =============================================================================
// Preview + conflict strategies (side quest, but proven for T-18 completeness)
// =============================================================================

describe('previewImport + conflict strategies', () => {
  it('previewImport does not mutate existing', () => {
    const input = makeInput();
    const pkg = buildFullExport(input);
    const existing = toMergeableStore(input);
    const snapshot = JSON.stringify(existing);
    previewImport(existing, pkg);
    expect(JSON.stringify(existing)).toEqual(snapshot);
  });

  it('keep-local wins on id conflict', () => {
    const input = makeInput();
    const pkg = buildFullExport(input);
    const existing = toMergeableStore(input);
    existing.messages[0] = { ...existing.messages[0], text: 'LOCAL WINS' };
    const preview = previewImport(existing, pkg);
    const next = applyImport(existing, preview, { conflict: 'keep-local' });
    expect((next.messages[0] as { text: string }).text).toBe('LOCAL WINS');
  });

  it('keep-imported wins on id conflict', () => {
    const input = makeInput();
    const pkg = buildFullExport(input);
    const existing = toMergeableStore(input);
    existing.messages[0] = { ...existing.messages[0], text: 'LOCAL LOSES' };
    const preview = previewImport(existing, pkg);
    const next = applyImport(existing, preview, { conflict: 'keep-imported' });
    expect((next.messages[0] as { text: string }).text).toBe(input.messages[0].text);
  });

  it('keep-both produces both rows with distinct ids', () => {
    const input = makeInput();
    const pkg = buildFullExport(input);
    const existing = toMergeableStore(input);
    existing.messages[0] = { ...existing.messages[0], text: 'LOCAL' };
    const preview = previewImport(existing, pkg);
    const next = applyImport(existing, preview, { conflict: 'keep-both' });
    const messages = next.messages as Array<{ id: string; text: string }>;
    const localRow = messages.find((m) => m.id === 'm1');
    const importedRow = messages.find((m) => m.id.startsWith('m1~imported-'));
    expect(localRow?.text).toBe('LOCAL');
    expect(importedRow?.text).toBe(input.messages[0].text);
  });
});
// === FILE END ===