// === FILE START ===
// packages/agents/test/extension-v2.test.ts
// PRD §14.8 · FR-DEV-03.

import { describe, it, expect } from 'vitest';
import {
  EXTENSION_MANIFEST,
  EXTENSION_ACTIONS,
  validateManifest,
  buildClaimCheck,
  auditForbiddenContent,
  CLAIM_CHECK_MAX_CHARS,
  type ExtensionManifest,
} from '../src/extension-v2.js';

describe('extension — manifest shape', () => {
  it('manifest_version is 3 and the name is non-empty', () => {
    expect(EXTENSION_MANIFEST.manifest_version).toBe(3);
    expect(EXTENSION_MANIFEST.name.length).toBeGreaterThan(0);
  });

  it('the shipped manifest validates cleanly', () => {
    const r = validateManifest(EXTENSION_MANIFEST);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('no host permission is overbroad or insecure', () => {
    for (const hp of EXTENSION_MANIFEST.host_permissions) {
      expect(hp).not.toBe('<all_urls>');
      expect(hp.startsWith('https://')).toBe(true);
    }
  });
});

describe('extension — validateManifest rejects bad input', () => {
  it('rejects a non-V3 manifest', () => {
    const bad = {
      ...EXTENSION_MANIFEST,
      manifest_version: 2 as unknown as 3,
    } as ExtensionManifest;
    const r = validateManifest(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('manifest_version'))).toBe(true);
  });

  it('rejects an insecure http host permission', () => {
    const bad: ExtensionManifest = {
      ...EXTENSION_MANIFEST,
      host_permissions: ['http://example.com'],
    };
    const r = validateManifest(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('insecure'))).toBe(true);
  });

  it('rejects an overbroad host permission', () => {
    const bad: ExtensionManifest = {
      ...EXTENSION_MANIFEST,
      host_permissions: ['<all_urls>'],
    };
    const r = validateManifest(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('overbroad'))).toBe(true);
  });
});

describe('extension — actions', () => {
  it('declares exactly two actions', () => {
    expect(EXTENSION_ACTIONS.length).toBe(2);
  });
});

describe('extension — buildClaimCheck happy paths', () => {
  it('fact-check-page produces source "page"', () => {
    const r = buildClaimCheck('fact-check-page', 'Hello world', 'https://example.com/a');
    expect(r.ok).toBe(true);
    expect(r.request!.source).toBe('page');
    expect(r.request!.text).toBe('Hello world');
    expect(r.request!.originUrl).toBe('https://example.com/a');
  });

  it('fact-check-selection produces source "selection"', () => {
    const r = buildClaimCheck('fact-check-selection', 'Selected paragraph', 'https://example.com/a');
    expect(r.ok).toBe(true);
    expect(r.request!.source).toBe('selection');
  });

  it('claimId is deterministic and prefixed by source', () => {
    const a = buildClaimCheck('fact-check-page', 'Same text', 'https://example.com/a');
    const b = buildClaimCheck('fact-check-page', 'Same text', 'https://example.com/a');
    expect(a.request!.claimId).toBe(b.request!.claimId);
    expect(a.request!.claimId.startsWith('ext-page-')).toBe(true);
  });
});

describe('extension — buildClaimCheck rejections', () => {
  it('rejects an unknown action', () => {
    const r = buildClaimCheck('nope', 'x', 'https://example.com');
    expect(r.ok).toBe(false);
    expect(r.reason!.toLowerCase()).toContain('unknown action');
  });

  it('rejects empty text', () => {
    expect(buildClaimCheck('fact-check-page', '   ', 'https://example.com').ok).toBe(false);
    expect(buildClaimCheck('fact-check-page', '', 'https://example.com').ok).toBe(false);
  });

  it('rejects text over CLAIM_CHECK_MAX_CHARS', () => {
    const long = 'x'.repeat(CLAIM_CHECK_MAX_CHARS + 1);
    const r = buildClaimCheck('fact-check-page', long, 'https://example.com');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain(String(CLAIM_CHECK_MAX_CHARS));
  });

  it('rejects a non-https originUrl', () => {
    expect(buildClaimCheck('fact-check-page', 'x', 'http://example.com').ok).toBe(false);
  });
});

describe('extension — audit and source scan', () => {
  it('auditForbiddenContent flags known executable snippets', () => {
    expect(auditForbiddenContent('const x = eval("1+1");')).toContain('eval(');
    expect(auditForbiddenContent('el.innerHTML = "x";')).toContain('.innerHTML');
    expect(auditForbiddenContent('const y = 1;')).toEqual([]);
  });

  it('source scan: extension-v2.ts has zero imports', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'extension-v2.ts'),
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