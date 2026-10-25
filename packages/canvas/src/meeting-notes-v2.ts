// === FILE START ===
// packages/canvas/src/meeting-notes-v2.ts
// PRD §14.5 · F-194 · T-13.
//
// Pasted transcript → summary + action items + decisions. Deterministic,
// pattern-based, zero external imports.
//
// Patterns:
//   · "X will Y" (capitalised name) → action item {assignee: X, action: Y}
//   · "we decided to X" / "the team has decided X" → decision
//   · summary = first N substantive sentences (>20 chars)
//
// Findings cite line numbers so the UI can jump to the source.

export interface ActionItem {
  assignee: string;
  action: string;
  line: number;
}

export interface Decision {
  text: string;
  line: number;
}

export interface MeetingNotes {
  summary: string[];
  actionItems: ActionItem[];
  decisions: Decision[];
}

const ACTION_PATTERN = /\b([A-Z][a-z]+)\s+will\s+([^.!?\n]+)/g;
const DECISION_PATTERN =
  /\b(?:we|the team)\s+(?:have\s+|has\s+)?decided\s+(?:to\s+|on\s+)?([^.!?\n]+)/gi;

export function extractActionItems(transcript: string): ActionItem[] {
  if (typeof transcript !== 'string') return [];
  const out: ActionItem[] = [];
  const lines = transcript.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    ACTION_PATTERN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ACTION_PATTERN.exec(line)) !== null) {
      out.push({
        assignee: m[1]!,
        action: m[2]!.trim(),
        line: i + 1,
      });
    }
  }
  return out;
}

export function extractDecisions(transcript: string): Decision[] {
  if (typeof transcript !== 'string') return [];
  const out: Decision[] = [];
  const lines = transcript.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    DECISION_PATTERN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DECISION_PATTERN.exec(line)) !== null) {
      out.push({
        text: m[1]!.trim(),
        line: i + 1,
      });
    }
  }
  return out;
}

export function summariseMeeting(transcript: string, maxSentences = 3): string[] {
  if (typeof transcript !== 'string') return [];
  const sentences = transcript
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
  return sentences.slice(0, maxSentences);
}

export function parseMeeting(transcript: string): MeetingNotes {
  return {
    summary: summariseMeeting(transcript),
    actionItems: extractActionItems(transcript),
    decisions: extractDecisions(transcript),
  };
}
// === FILE END ===