// === FILE START ===
// packages/i18n/src/locale-v2.ts
// PRD §6.9 · FR-I18N-02.
//
// Locale detection, per-locale formatting, IST-aware reset display.
// No third-party i18n library — pure Intl, one dependency (built into Node 18+
// and every browser this app targets).

import type { Locale } from './catalogue-v2.js';

export type LocaleTag = 'en' | 'hi' | 'en-IN' | 'hi-IN';

export interface FormatContext {
  locale: LocaleTag;
  /** IANA timezone. Defaults to Asia/Kolkata (IST). */
  timeZone?: string;
  /** Force 12-hour clock even when the locale defaults to 24. */
  hour12?: boolean;
}

const DEFAULT_TZ = 'Asia/Kolkata';

function ctxOrDefault(ctx: Partial<FormatContext> = {}): FormatContext {
  return {
    locale: ctx.locale ?? 'en-IN',
    timeZone: ctx.timeZone ?? DEFAULT_TZ,
    hour12: ctx.hour12,
  };
}

function baseLocale(ctx: FormatContext): Locale {
  return ctx.locale.startsWith('hi') ? 'hi' : 'en';
}

/**
 * Detect locale from `Accept-Language` header and (optionally) timezone.
 *  · explicit `hi` / `hi-IN` in header → hi-IN
 *  · explicit `en-IN` in header → en-IN
 *  · timezone Asia/Kolkata and no locale hint → en-IN
 *  · otherwise → en
 */
export function detectLocale(
  acceptLanguage?: string | null,
  timeZone?: string | null,
): LocaleTag {
  const tag = (acceptLanguage ?? '').toLowerCase();
  if (tag.includes('hi-in')) return 'hi-IN';
  if (tag.includes('hi')) return 'hi';
  if (tag.includes('en-in')) return 'en-IN';
  if (timeZone === DEFAULT_TZ && !tag.includes('en')) return 'en-IN';
  return 'en';
}

/** Number with locale grouping (en-IN uses lakh/crore for large values). */
export function formatNumber(n: number, ctx?: Partial<FormatContext>): string {
  const c = ctxOrDefault(ctx);
  return new Intl.NumberFormat(c.locale).format(n);
}

/** Compact number for quota / receipts (1.2K, 4.3L, 1.1Cr). */
export function formatCompactNumber(
  n: number,
  ctx?: Partial<FormatContext>,
): string {
  const c = ctxOrDefault(ctx);
  return new Intl.NumberFormat(c.locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
}

/** ISO-style date in the target timezone (e.g. "2 Oct 2026"). */
export function formatDate(
  when: Date | string | number,
  ctx?: Partial<FormatContext>,
): string {
  const c = ctxOrDefault(ctx);
  const d = toDate(when);
  return new Intl.DateTimeFormat(c.locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: c.timeZone,
  }).format(d);
}

/** Time with timezone label (e.g. "05:30 IST"). */
export function formatTime(
  when: Date | string | number,
  ctx?: Partial<FormatContext>,
): string {
  const c = ctxOrDefault(ctx);
  const d = toDate(when);
  const time = new Intl.DateTimeFormat(c.locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: c.hour12 ?? false,
    timeZone: c.timeZone,
  }).format(d);
  return `${time} ${tzLabel(c.timeZone ?? DEFAULT_TZ)}`;
}

/** Relative time (e.g. "3 hours ago", "in 2 days"). */
export function formatRelativeTime(
  when: Date | string | number,
  now: Date | string | number,
  ctx?: Partial<FormatContext>,
): string {
  const c = ctxOrDefault(ctx);
  const rtf = new Intl.RelativeTimeFormat(c.locale, { numeric: 'auto' });
  const diffMs = toDate(when).getTime() - toDate(now).getTime();
  const abs = Math.abs(diffMs);
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  if (abs < MIN) return rtf.format(Math.round(diffMs / 1000), 'second');
  if (abs < HOUR) return rtf.format(Math.round(diffMs / MIN), 'minute');
  if (abs < DAY) return rtf.format(Math.round(diffMs / HOUR), 'hour');
  return rtf.format(Math.round(diffMs / DAY), 'day');
}

/** Currency in the user's currency. Defaults to INR for hi/hi-IN/en-IN. */
export function formatCurrency(
  amount: number,
  ctx?: Partial<FormatContext>,
  currency: 'INR' | 'USD' | 'GBP' = 'INR',
): string {
  const c = ctxOrDefault(ctx);
  return new Intl.NumberFormat(c.locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Quota reset display (PRD §6.9 · FR-I18N-02).
 * Returns "05:30 IST" — the PRD's canonical form.
 * Cloudflare resets at 00:00 UTC = 05:30 IST. Provider resets vary and are
 * shown per pool elsewhere; this is the base formatter.
 */
export function formatQuotaReset(
  resetAt: Date | string | number,
  ctx?: Partial<FormatContext>,
): string {
  return formatTime(resetAt, ctx);
}

function toDate(when: Date | string | number): Date {
  return when instanceof Date ? when : new Date(when);
}

function tzLabel(timeZone: string): string {
  if (timeZone === 'Asia/Kolkata') return 'IST';
  if (timeZone === 'Europe/London') return 'GMT';
  if (timeZone === 'America/New_York') return 'ET';
  if (timeZone === 'America/Los_Angeles') return 'PT';
  return timeZone;
}

export { baseLocale };
// === FILE END ===