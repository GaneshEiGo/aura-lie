// packages/cost-guard/src/ci-scan.ts
// PRD 4.7 §4 + 12.7 Layer 2: "A script scans the code and config for
// non-allowlisted hosts, billing endpoints and paid-tier environment
// variables. It fails the build."

import type { CiScanViolation } from './types.js';

/** Paid SDK package names — import of any fails the build. */
export const PAID_SDK_PATTERNS: Array<{ pattern: RegExp; package: string }> = [
  { pattern: /\bfrom\s+['"]stripe['"]/g, package: 'stripe' },
  { pattern: /\brequire\(\s*['"]stripe['"]\s*\)/g, package: 'stripe' },
  { pattern: /\bfrom\s+['"]@stripe\//g, package: '@stripe/*' },
  { pattern: /\bfrom\s+['"]braintree['"]/g, package: 'braintree' },
  { pattern: /\bfrom\s+['"]@paypal\//g, package: '@paypal/*' },
  { pattern: /\bfrom\s+['"]paypal-rest-sdk['"]/g, package: 'paypal-rest-sdk' },
  { pattern: /\bfrom\s+['"]square-connect['"]/g, package: 'square-connect' },
  { pattern: /\bfrom\s+['"]@square\//g, package: '@square/*' },
];

/**
 * Environment variable names that imply a paid tier. Reference to any of
 * these in source fails the build. (Cloudflare Workers `env` object form
 * included — `env.STRIPE_SECRET_KEY`.)
 */
export const PAID_ENV_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /process\.env\.[A-Z0-9_]*(?:STRIPE|BILLING|PAID)[A-Z0-9_]*/g, name: 'STRIPE/BILLING/PAID env' },
  { pattern: /env\.[A-Z0-9_]*(?:STRIPE|BILLING|PAID)[A-Z0-9_]*/g, name: 'STRIPE/BILLING/PAID env' },
];

/** `{ "paid": true }` on any model/provider entry fails the build. */
export const PAID_MODEL_PATTERNS: Array<{ pattern: RegExp; note: string }> = [
  { pattern: /["']paid["']\s*:\s*true/g, note: 'model flagged paid:true' },
];

export function scanSource(code: string, filename: string): CiScanViolation[] {
  const violations: CiScanViolation[] = [];

  for (const { pattern, package: pkg } of PAID_SDK_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(code)) !== null) {
      violations.push({
        file: filename,
        kind: 'paid-sdk',
        match: m[0],
        reason: `paid SDK import detected: ${pkg}`,
      });
    }
  }

  for (const { pattern, name } of PAID_ENV_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(code)) !== null) {
      violations.push({
        file: filename,
        kind: 'paid-env',
        match: m[0],
        reason: `paid-tier env reference: ${name}`,
      });
    }
  }

  for (const { pattern, note } of PAID_MODEL_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(code)) !== null) {
      violations.push({
        file: filename,
        kind: 'paid-model-flag',
        match: m[0],
        reason: note,
      });
    }
  }

  return violations;
}

export interface TreeFile {
  path: string;
  code: string;
}

export function scanTree(files: TreeFile[]): CiScanViolation[] {
  const all: CiScanViolation[] = [];
  for (const file of files) {
    all.push(...scanSource(file.code, file.path));
  }
  return all;
}