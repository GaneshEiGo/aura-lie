// === FILE START ===
// packages/agents/src/extension-v2.ts
// PRD §14.8 · FR-DEV-03 · T-13.
//
// Browser extension manifest spec + the "Fact-check this page" contract.
//
// Manifest V3 only. No remote code (PRD §12.2 supply-chain rule). No `eval`,
// no `Function()`, no inline event handlers, no remote script loads. Host
// permissions limited to the claim-check API host. The manifest is validated
// by `validateManifest`, which rejects overbroad or insecure host patterns.
//
// The extension exposes exactly one family of actions: "Fact-check this page"
// and "Fact-check the selection". Each produces a `ClaimCheckRequest` whose
// body matches the /v1/verify request declared in rest-api-v2.ts.
//
// Zero external imports.

export type ManifestVersion = 3;

export interface ExtensionAction {
  id: string;
  title: string;
  description: string;
  /** Matches a route in rest-api-v2.ts (kept as a string for the scan). */
  endpoint: string;
  method: 'POST';
}

export interface ExtensionManifest {
  manifest_version: ManifestVersion;
  name: string;
  version: string;
  description: string;
  permissions: readonly string[];
  host_permissions: readonly string[];
  background: { service_worker: string };
  content_scripts: readonly Array<{
    matches: readonly string[];
    js: readonly string[];
    run_at: 'document_idle';
  }>;
  action: { default_popup: string; default_title: string };
}

export const EXTENSION_ACTIONS: readonly ExtensionAction[] = Object.freeze([
  Object.freeze({
    id: 'fact-check-page',
    title: 'Fact-check this page',
    description:
      'Send the page text through the Truth Engine and open the claim drawer',
    endpoint: '/v1/verify',
    method: 'POST' as const,
  }),
  Object.freeze({
    id: 'fact-check-selection',
    title: 'Fact-check the selected text',
    description:
      'Send only the selected paragraph through the Truth Engine',
    endpoint: '/v1/verify',
    method: 'POST' as const,
  }),
]);

export const EXTENSION_MANIFEST: ExtensionManifest = Object.freeze({
  manifest_version: 3,
  name: 'Aura-lie — Fact-check this page',
  version: '1.0.0',
  description:
    'Sends the current page or selection to your Aura-lie deployment for claim-level verification.',
  permissions: Object.freeze(['activeTab', 'storage', 'contextMenus']),
  host_permissions: Object.freeze([
    'https://*.workers.dev/',
    'https://*.pages.dev/',
  ]),
  background: { service_worker: 'background.js' },
  content_scripts: Object.freeze([
    Object.freeze({
      matches: Object.freeze(['https://*/*']),
      js: Object.freeze(['content.js']),
      run_at: 'document_idle' as const,
    }),
  ]),
  action: {
    default_popup: 'popup.html',
    default_title: 'Fact-check this page',
  },
});

export interface ExtensionValidation {
  ok: boolean;
  errors: string[];
}

const FORBIDDEN_SNIPPETS = [
  'eval(',
  'new Function(',
  'document.write(',
  '.innerHTML',
];

export function validateManifest(m: ExtensionManifest): ExtensionValidation {
  const errors: string[] = [];

  if (m.manifest_version !== 3) {
    errors.push('manifest_version must be 3 (Manifest V3 only)');
  }
  if (typeof m.name !== 'string' || m.name.length === 0) {
    errors.push('name must be a non-empty string');
  }

  for (const hp of m.host_permissions) {
    if (
      hp === '<all_urls>' ||
      hp === '*://*/*' ||
      hp === 'http://*/*' ||
      hp === 'https://*/*'
    ) {
      errors.push(`overbroad host permission: "${hp}"`);
    }
    if (hp.startsWith('http://')) {
      errors.push(`insecure host permission: "${hp}"`);
    }
  }

  if (m.content_scripts.length === 0) {
    errors.push('at least one content script is required');
  }

  return { ok: errors.length === 0, errors };
}

export interface ClaimCheckRequest {
  claimId: string;
  text: string;
  source: 'page' | 'selection';
  originUrl: string;
}

export const CLAIM_CHECK_MAX_CHARS = 4000;

export interface BuiltClaimCheck {
  ok: boolean;
  reason?: string;
  request?: ClaimCheckRequest;
}

function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

export function buildClaimCheck(
  actionId: string,
  rawText: string,
  originUrl: string,
): BuiltClaimCheck {
  const action = EXTENSION_ACTIONS.find((a) => a.id === actionId);
  if (action === undefined) {
    return { ok: false, reason: `unknown action: "${actionId}"` };
  }
  if (typeof rawText !== 'string' || rawText.trim().length === 0) {
    return { ok: false, reason: 'text is empty' };
  }
  if (rawText.length > CLAIM_CHECK_MAX_CHARS) {
    return {
      ok: false,
      reason: `text exceeds ${CLAIM_CHECK_MAX_CHARS} characters`,
    };
  }
  if (typeof originUrl !== 'string' || !originUrl.startsWith('https://')) {
    return { ok: false, reason: 'originUrl must be https' };
  }

  const source: ClaimCheckRequest['source'] =
    actionId === 'fact-check-selection' ? 'selection' : 'page';

  const claimId = `ext-${source}-${hashString(originUrl + '|' + rawText)}`;

  return {
    ok: true,
    request: {
      claimId,
      text: rawText,
      source,
      originUrl,
    },
  };
}

export function auditForbiddenContent(text: string): string[] {
  const found: string[] = [];
  for (const needle of FORBIDDEN_SNIPPETS) {
    if (text.includes(needle)) found.push(needle);
  }
  return found;
}
// === FILE END ===