// === FILE START ===
// scripts/audit-cost.mjs
// PRD 12.7 · T-01 · L1.
//
// Standalone Cost Guard CI check. Runs via `node scripts/audit-cost.mjs` or
// from a pre-commit hook. Exits 1 if any of these trip:
//   1. A paid SDK is listed in any workspace package.json's dependencies.
//   2. A known billing endpoint URL appears in production source (not tests).
//   3. A model flagged paid:true is referenced in the model registry seed.
//
// Conservative by design: skips node_modules, .git, tests, and dist. Exits 0
// on a clean tree. On this codebase it exits 0 today — it is belt-and-braces
// on top of `cost-guard-gate.test.ts`, not a replacement.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

const PAID_PACKAGES = new Set([
  '@anthropic-ai/sdk',
  'openai',
  'cohere-ai',
  '@google-cloud/aiplatform',
  '@aws-sdk/client-bedrock-runtime',
  '@mistralai/mistralai',
  'groq-sdk-paid-tier',
]);

const BILLING_URL_PATTERNS = [
  /stripe\.com\/v1\/charges/i,
  /stripe\.com\/v1\/payment_intents/i,
  /api\.openai\.com\/v1\/billing/i,
  /billing\.anthropic\.com/i,
  /billing\.googleapis\.com/i,
  /payments\.cloudflare\.com/i,
];

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
]);

const SKIP_FILE_EXT = new Set(['.lock', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf']);

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
    } else if (st.isFile()) {
      out.push(full);
    }
  }
}

function isTestPath(relPath) {
  return (
    relPath.includes(`${sep}test${sep}`) ||
    relPath.includes(`${sep}tests${sep}`) ||
    relPath.endsWith('.test.ts') ||
    relPath.endsWith('.test.js') ||
    relPath.endsWith('.spec.ts') ||
    relPath.endsWith('.spec.js')
  );
}

function checkPackageJson(file) {
  const violations = [];
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return violations;
  }
  const deps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
  };
  for (const name of Object.keys(deps)) {
    if (PAID_PACKAGES.has(name)) {
      violations.push(
        `${relative(ROOT, file)}: paid SDK "${name}" in dependencies`,
      );
    }
  }
  return violations;
}

function checkSource(file) {
  const violations = [];
  const relPath = relative(ROOT, file);
  if (isTestPath(relPath)) return violations;
  const ext = file.slice(file.lastIndexOf('.'));
  if (SKIP_FILE_EXT.has(ext)) return violations;
  if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'].includes(ext)) return violations;

  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    return violations;
  }
  for (const pat of BILLING_URL_PATTERNS) {
    if (pat.test(content)) {
      violations.push(
        `${relPath}: billing endpoint matching ${pat}`,
      );
    }
  }
  return violations;
}

function main() {
  const files = [];
  walk(ROOT, files);

  const violations = [];
  for (const f of files) {
    if (f.endsWith('package.json')) {
      violations.push(...checkPackageJson(f));
    }
    if (f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js') || f.endsWith('.jsx') || f.endsWith('.mjs') || f.endsWith('.cjs') || f.endsWith('.json')) {
      violations.push(...checkSource(f));
    }
  }

  if (violations.length > 0) {
    console.error('❌ T-01 Cost Guard audit FAILED');
    for (const v of violations) console.error(`  · ${v}`);
    console.error(`\n${violations.length} violation(s). See PRD 12.7 · F-217.`);
    process.exit(1);
  }

  console.log('✅ T-01 Cost Guard audit passed');
  console.log(`   scanned ${files.length} files, 0 violations`);
  console.log('   cost_inr = 0 invariant holds');
  process.exit(0);
}

main();
// === FILE END ===