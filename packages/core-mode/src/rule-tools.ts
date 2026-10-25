// packages/core-mode/src/rule-tools.ts
// PRD 7.8 · F-250 · deterministic rule tools that work with all pools
// exhausted and with the browser offline. No model, no network.

export interface ToolResult {
  ok: boolean;
  value?: number | string;
  error?: string;
}

// =============================================================================
// Calculator — safe recursive-descent parser, no eval, no Function.
// Grammar:
//   sum     = product (('+' | '-') product)*
//   product = primary (('*' | '/') primary)*
//   primary = '(' sum ')' | NUMBER
//   NUMBER  = ('-')? [0-9]+ ('.' [0-9]+)?
// =============================================================================

export function calculate(input: string): ToolResult {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return { ok: false, error: 'empty' };
  }
  try {
    const value = parseExpression(input);
    if (!Number.isFinite(value)) return { ok: false, error: 'non-finite' };
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function parseExpression(source: string): number {
  let i = 0;
  const len = source.length;

  const skip = (): void => {
    while (i < len && /\s/.test(source[i])) i++;
  };
  const peek = (): string | undefined => {
    skip();
    return i < len ? source[i] : undefined;
  };
  const consume = (): string => {
    skip();
    return source[i++];
  };

  function parseNumber(): number {
    skip();
    const start = i;
    if (source[i] === '-' || source[i] === '+') i++;
    while (i < len && /[0-9.]/.test(source[i])) i++;
    if (i === start) throw new Error('expected number at ' + start);
    const slice = source.slice(start, i);
    const n = parseFloat(slice);
    if (!Number.isFinite(n)) throw new Error('invalid number "' + slice + '"');
    return n;
  }

  function parsePrimary(): number {
    if (peek() === '(') {
      consume(); // '('
      const v = parseSum();
      if (peek() !== ')') throw new Error('expected )');
      consume(); // ')'
      return v;
    }
    return parseNumber();
  }

  function parseProduct(): number {
    let left = parsePrimary();
    for (;;) {
      const op = peek();
      if (op === '*' || op === '/') {
        consume();
        const right = parsePrimary();
        if (op === '/') {
          if (right === 0) throw new Error('division by zero');
          left = left / right;
        } else {
          left = left * right;
        }
      } else {
        return left;
      }
    }
  }

  function parseSum(): number {
    let left = parseProduct();
    for (;;) {
      const op = peek();
      if (op === '+' || op === '-') {
        consume();
        const right = parseProduct();
        left = op === '+' ? left + right : left - right;
      } else {
        return left;
      }
    }
  }

  const result = parseSum();
  skip();
  if (i < len) throw new Error('unexpected token "' + source[i] + '" at ' + i);
  return result;
}

// =============================================================================
// Date math — plain ISO handling, no external library.
// =============================================================================

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` string → UTC epoch ms. Returns `null` on invalid input. */
export function parseIsoDate(input: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const ms = Date.UTC(y, mo - 1, d);
  if (!Number.isFinite(ms)) return null;
  return ms;
}

/** UTC epoch ms → `YYYY-MM-DD` (no time component). */
export function formatIsoDate(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear().toString().padStart(4, '0');
  const mo = (dt.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = dt.getUTCDate().toString().padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

/**
 * Date arithmetic. Accepts:
 *   "+7d" / "-3d" / "+2w" / "+1m" / "+1y"    (relative to `now`)
 *   "2026-10-02 + 7d"                        (relative to a fixed base)
 *   "2026-10-02 - 2026-09-25"                (difference in days)
 */
export function dateMath(input: string, now?: number): ToolResult {
  const base = now ?? Date.now();
  const trimmed = input.trim();

  const diffMatch = /^(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})$/.exec(trimmed);
  if (diffMatch) {
    const a = parseIsoDate(diffMatch[1]);
    const b = parseIsoDate(diffMatch[2]);
    if (a === null || b === null) return { ok: false, error: 'invalid date' };
    const days = Math.round((a - b) / DAY_MS);
    return { ok: true, value: days };
  }

  const relMatch = /^([+-]?)(\d+)([dwmy])$/.exec(trimmed);
  if (relMatch) {
    const sign = relMatch[1] === '-' ? -1 : 1;
    const n = parseInt(relMatch[2], 10) * sign;
    const unit = relMatch[3];
    const ms = offsetMs(n, unit);
    return { ok: true, value: formatIsoDate(base + ms) };
  }

  const baseAndRel = /^(\d{4}-\d{2}-\d{2})\s*([+-])\s*(\d+)([dwmy])$/.exec(trimmed);
  if (baseAndRel) {
    const baseMs = parseIsoDate(baseAndRel[1]);
    if (baseMs === null) return { ok: false, error: 'invalid base date' };
    const sign = baseAndRel[2] === '-' ? -1 : 1;
    const n = parseInt(baseAndRel[3], 10) * sign;
    const ms = offsetMs(n, baseAndRel[4]);
    return { ok: true, value: formatIsoDate(baseMs + ms) };
  }

  return { ok: false, error: 'unrecognised date expression' };
}

function offsetMs(n: number, unit: string): number {
  switch (unit) {
    case 'd':
      return n * DAY_MS;
    case 'w':
      return n * 7 * DAY_MS;
    case 'm':
      return n * 30 * DAY_MS;
    case 'y':
      return n * 365 * DAY_MS;
    default:
      return 0;
  }
}

// =============================================================================
// Currency — off-line conversion from a caller-supplied rate table.
// =============================================================================

export interface CurrencyRates {
  /** Base currency to which everything is normalised. Usually `USD`. */
  base: string;
  /** Currency code → value of 1 unit in base currency. e.g. INR = 0.012, USD = 1. */
  rates: Record<string, number>;
  /** When the rates were captured. */
  at: number;
}

export function currencyConvert(
  amount: number,
  from: string,
  to: string,
  rates: CurrencyRates,
): ToolResult {
  if (!Number.isFinite(amount)) return { ok: false, error: 'invalid amount' };
  const fromUpper = from.toUpperCase();
  const toUpper = to.toUpperCase();
  const fromRate = rates.rates[fromUpper];
  const toRate = rates.rates[toUpper];
  if (fromRate === undefined) {
    return { ok: false, error: 'unknown currency ' + fromUpper };
  }
  if (toRate === undefined) {
    return { ok: false, error: 'unknown currency ' + toUpper };
  }
  if (fromRate <= 0 || toRate <= 0) {
    return { ok: false, error: 'invalid rate' };
  }
  const inBase = amount * fromRate;
  const inTarget = inBase / toRate;
  return { ok: true, value: Number(inTarget.toFixed(4)) };
}

// =============================================================================
// Timers — deterministic, clock-driven. No setInterval; the caller ticks.
// =============================================================================

export interface TimerEntry {
  id: string;
  label: string;
  firesAt: number;
  fired: boolean;
}

export class TimerManager {
  private readonly timers = new Map<string, TimerEntry>();
  private readonly clock: { now(): number };
  private counter = 0;

  constructor(options: { clock?: { now(): number } } = {}) {
    this.clock = options.clock ?? { now: () => Date.now() };
  }

  setTimer(label: string, firesAt: number): TimerEntry {
    const id = `t_${++this.counter}_${this.clock.now().toString(36)}`;
    const entry: TimerEntry = { id, label, firesAt, fired: false };
    this.timers.set(id, entry);
    return { ...entry };
  }

  cancelTimer(id: string): boolean {
    return this.timers.delete(id);
  }

  listTimers(): TimerEntry[] {
    return Array.from(this.timers.values()).map((t) => ({ ...t }));
  }

  /** Called by the Core Mode loop. Returns timers that became due since last tick. */
  tick(): TimerEntry[] {
    const now = this.clock.now();
    const due: TimerEntry[] = [];
    for (const t of this.timers.values()) {
      if (!t.fired && t.firesAt <= now) {
        t.fired = true;
        due.push({ ...t });
        this.timers.delete(t.id);
      }
    }
    return due;
  }

  clear(): void {
    this.timers.clear();
  }
} 