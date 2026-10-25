// packages/autonomy-runner/src/sentence.ts
// F-102: "Every Monday, tell me what changed in my project" → Aura-lie
// creates the schedule, data source, comparison and notification from that
// sentence, shows the plan, and asks you to confirm."

import type { OneSentenceAgent } from './types.js';

const FREQ_RE =
  /^(every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|day|week|hour|minute)|daily|weekly|hourly)\b\s*,?\s*(.*)$/i;

export function parseOneSentenceAgent(
  sentence: string,
): OneSentenceAgent | null {
  const trimmed = (sentence ?? '').trim();
  if (!trimmed) return null;

  const m = trimmed.match(FREQ_RE);
  if (!m) return null;

  const freq = m[1].toLowerCase();
  const rest = (m[3] ?? '').trim();
  if (!rest) return null;

  const schedule = toCron(freq);
  let comparison = 'what changed';
  let dataSource = 'my project';
  let confidence = 0.6;

  const whatChanged = rest.match(
    /(?:tell|show|report)\s+me\s+(?:what\s+changed|what's\s+new)\s+in\s+(.+?)[.!?]?$/i,
  );
  if (whatChanged) {
    comparison = 'what changed';
    dataSource = whatChanged[1].trim();
    confidence = 0.9;
  } else {
    const notify = rest.match(/notify\s+me\s+(?:of|about)\s+(.+?)[.!?]?$/i);
    if (notify) {
      comparison = 'new';
      dataSource = notify[1].trim();
      confidence = 0.7;
    } else {
      const report = rest.match(/(?:report|give\s+me)\s+(.+?)[.!?]?$/i);
      if (report) {
        comparison = 'progress';
        dataSource = report[1].trim();
        confidence = 0.5;
      }
    }
  }

  const notification = `notify when ${comparison} changes in ${dataSource}`;

  return {
    schedule,
    dataSource,
    comparison,
    notification,
    raw: trimmed,
    confidence,
    requiresConfirmation: true,
  };
}

function toCron(freq: string): string {
  if (freq === 'daily' || freq === 'every day') return '0 9 * * *';
  if (freq === 'weekly' || freq === 'every week') return '0 9 * * 1';
  if (freq === 'hourly' || freq === 'every hour') return '0 * * * *';
  if (freq === 'every minute') return '* * * * *';
  const days: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  for (const [day, num] of Object.entries(days)) {
    if (freq === `every ${day}`) return `0 9 * * ${num}`;
  }
  return '0 9 * * *';
}