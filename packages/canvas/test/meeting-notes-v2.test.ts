// === FILE START ===
// packages/canvas/test/meeting-notes-v2.test.ts
// PRD §14.5 · F-194 · T-13.

import { describe, it, expect } from 'vitest';
import {
  extractActionItems,
  extractDecisions,
  summariseMeeting,
  parseMeeting,
} from '../src/meeting-notes-v2.js';

describe('meeting-notes — extractActionItems', () => {
  it('extracts "X will Y" as an action item', () => {
    const items = extractActionItems('Alice will fix the bug.');
    expect(items.length).toBe(1);
    expect(items[0]!.assignee).toBe('Alice');
    expect(items[0]!.action).toBe('fix the bug');
  });

  it('captures multiple action items on separate lines', () => {
    const transcript = 'Alice will draft the spec.\nBob will review the draft.';
    const items = extractActionItems(transcript);
    expect(items.length).toBe(2);
    expect(items[0]!.assignee).toBe('Alice');
    expect(items[1]!.assignee).toBe('Bob');
  });

  it('returns empty array for empty transcript', () => {
    expect(extractActionItems('')).toEqual([]);
  });

  it('carries line numbers matching the source transcript', () => {
    const transcript = 'Intro line.\nAlice will ship it.';
    const items = extractActionItems(transcript);
    expect(items[0]!.line).toBe(2);
  });
});

describe('meeting-notes — extractDecisions', () => {
  it('extracts "we decided to X" as a decision', () => {
    const ds = extractDecisions('We decided to use Cloudflare.');
    expect(ds.length).toBe(1);
    expect(ds[0]!.text).toBe('use Cloudflare');
  });

  it('extracts "the team has decided X" as a decision', () => {
    const ds = extractDecisions('The team has decided to ship on Friday.');
    expect(ds.length).toBe(1);
    expect(ds[0]!.text).toBe('ship on Friday');
  });

  it('returns empty array for empty transcript', () => {
    expect(extractDecisions('')).toEqual([]);
  });
});

describe('meeting-notes — summariseMeeting', () => {
  it('returns at most N substantive sentences', () => {
    const transcript =
      'Short.\n' +
      'This is a substantive sentence that is longer than twenty characters.\n' +
      'Another substantive sentence that also passes the length filter.\n' +
      'And one more that qualifies.';
    const s = summariseMeeting(transcript, 2);
    expect(s.length).toBe(2);
  });

  it('filters out very short fragments', () => {
    expect(summariseMeeting('Ok. Yes. No.')).toEqual([]);
  });

  it('returns empty array for empty transcript', () => {
    expect(summariseMeeting('')).toEqual([]);
  });
});

describe('meeting-notes — parseMeeting composes all three', () => {
  const transcript =
    'This is a substantive introductory line about the Q4 priorities.\n' +
    'We decided to use Cloudflare for the edge.\n' +
    'Alice will draft the spec.\n' +
    'Bob will review the draft.';

  it('returns summary, action items, and decisions together', () => {
    const notes = parseMeeting(transcript);
    expect(notes.summary.length).toBeGreaterThan(0);
    expect(notes.actionItems.length).toBe(2);
    expect(notes.decisions.length).toBe(1);
  });

  it('empty input → all-empty fields', () => {
    const notes = parseMeeting('');
    expect(notes.summary).toEqual([]);
    expect(notes.actionItems).toEqual([]);
    expect(notes.decisions).toEqual([]);
  });

  it('is deterministic', () => {
    const a = parseMeeting(transcript);
    const b = parseMeeting(transcript);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('source scan: meeting-notes-v2.ts has zero imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'meeting-notes-v2.ts'),
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