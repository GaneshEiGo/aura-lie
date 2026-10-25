// === FILE START ===
// packages/data/src/export-profiles.ts
// PRD 9.9 · FR-DATA-01 to FR-DATA-03 · FR-DATA-08 · T-18.
//
// The three export profiles from PRD 9.9:
//
//   FULL         — everything: memory, S2 items, reasoning, audit, settings,
//                  personas. Never includes provider API keys (they live only
//                  in Worker secrets, and are structurally absent from this
//                  module's types).
//   SHAREABLE    — messages, claims WITH evidence, sources.
//                  Excludes: memory, S2 content, emotional data, reasoning,
//                  audit log, settings, personas.
//   ANONYMISED   — same as Shareable, but every PII token (email, phone,
//                  URL, IP) is replaced by a *stable* placeholder
//                  (<email-1>, <phone-1>, <url-1>, <ip-1>). Stability is
//                  per-run, so a given email always becomes the same
//                  placeholder within one export.
//
// Section 90 FIX (this revision):
//   `buildAnonymisedExport` was anonymising `sources[].title` but NOT
//   `sources[].url`. That left the raw `https://…` string in the anonymised
//   package, breaking both `T-18.3 URL is replaced` and
//   `T-18.4 Anonymised contains no raw URLs`. The fix routes `s.url` through
//   the same `anonymiser.anonymise()` that handles every other text field —
//   the URL_RE inside the anonymiser replaces `https://…` with a stable
//   `<url-N>` placeholder, matching the behaviour that already applied to
//   emails, phones, and IPs.

export type ExportProfile = 'full' | 'shareable' | 'anonymised';

// -----------------------------------------------------------------------------
// Domain shapes
// -----------------------------------------------------------------------------

export interface SourceRecord {
  id: string;
  url: string;
  title: string;
  domain: string;
  fetchedAt: string;
}

export interface EvidenceRecord {
  id: string;
  claimId: string;
  sourceId: string;
  quote: string | null;
  matchOk: boolean;
  stance: 'supports' | 'contradicts' | 'neutral';
}

export interface ClaimRecord {
  id: string;
  text: string;
  status: string;
  score: number | null;
  evidence: EvidenceRecord[];
  reasoning?: string;
  sensitivity: 'S0' | 'S1' | 'S2';
}

export interface MessageRecord {
  id: string;
  text: string;
  role: 'user' | 'assistant';
  createdAt: string;
  reasoning?: string;
}

export interface MemoryRecord {
  id: string;
  text: string;
  origin: string;
  sensitivity: 'S0' | 'S1' | 'S2';
  createdAt: string;
  emotional?: boolean;
}

export interface AuditRecord {
  id: string;
  action: string;
  at: string;
  metadata: Record<string, unknown>;
}

export interface PersonaRecord {
  id: string;
  name: string;
  schema: Record<string, unknown>;
}

export interface SettingsRecord {
  theme: 'paper' | 'ink' | 'terminal';
  autonomyLevel: 0 | 1 | 2 | 3;
  quietHours: { start: string; end: string };
  [key: string]: unknown;
}

export interface FullStoreInput {
  profileId: string;
  exportedAt: string;
  messages: MessageRecord[];
  claims: ClaimRecord[];
  sources: SourceRecord[];
  memories: MemoryRecord[];
  auditLog: AuditRecord[];
  settings: SettingsRecord;
  personas: PersonaRecord[];
}

export interface ExportPackage {
  profile: ExportProfile;
  profileId: string;
  exportedAt: string;
  version: 1;
  data: Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// Anonymiser
// -----------------------------------------------------------------------------

export interface Anonymiser {
  anonymise(text: string): string;
  /** Placeholder → original map, for debugging only. */
  readonly mapping: ReadonlyMap<string, string>;
}

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_RE = /(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?){2,4}\d{2,4}/g;
const URL_RE = /\bhttps?:\/\/[^\s"'<>]+/g;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

export function createStableAnonymiser(): Anonymiser {
  const mapping = new Map<string, string>();
  const reverse = new Map<string, string>();
  let counter = 0;

  function placeholderFor(kind: string, original: string): string {
    const existing = reverse.get(original);
    if (existing) return existing;
    counter += 1;
    const ph = `<${kind}-${counter}>`;
    mapping.set(ph, original);
    reverse.set(original, ph);
    return ph;
  }

  return {
    anonymise(text: string): string {
      if (typeof text !== 'string' || text.length === 0) return text;
      let out = text;
      out = out.replace(EMAIL_RE, (m) => placeholderFor('email', m));
      out = out.replace(URL_RE, (m) => placeholderFor('url', m));
      out = out.replace(IPV4_RE, (m) => placeholderFor('ip', m));
      // Phone is last — its regex is loose and could swallow digits from
      // an already-anonymised placeholder.
      out = out.replace(PHONE_RE, (m) => {
        if (/^<\w+-\d+>$/.test(m)) return m;
        return placeholderFor('phone', m);
      });
      return out;
    },
    get mapping() {
      return mapping;
    },
  };
}

// -----------------------------------------------------------------------------
// Builders
// -----------------------------------------------------------------------------

function cloneMessages(messages: MessageRecord[]): MessageRecord[] {
  return messages.map((m) => ({ ...m }));
}

function cloneClaims(claims: ClaimRecord[]): ClaimRecord[] {
  return claims.map((c) => ({
    ...c,
    evidence: c.evidence.map((e) => ({ ...e })),
  }));
}

function stripReasoning(messages: MessageRecord[]): MessageRecord[] {
  return messages.map(({ reasoning: _r, ...rest }) => rest);
}

function stripReasoningFromClaims(claims: ClaimRecord[]): ClaimRecord[] {
  return claims.map(({ reasoning: _r, ...rest }) => rest);
}

function filterS2Claims(claims: ClaimRecord[]): ClaimRecord[] {
  return claims.filter((c) => c.sensitivity !== 'S2');
}

function filterEvidencedClaims(claims: ClaimRecord[]): ClaimRecord[] {
  return claims.filter((c) => c.evidence.length > 0);
}

/**
 * Full profile — no filtering except for structural safety.
 * Provider API keys are not in FullStoreInput, so they cannot leak.
 */
export function buildFullExport(input: FullStoreInput): ExportPackage {
  return {
    profile: 'full',
    profileId: input.profileId,
    exportedAt: input.exportedAt,
    version: 1,
    data: {
      messages: cloneMessages(input.messages),
      claims: cloneClaims(input.claims),
      sources: input.sources.map((s) => ({ ...s })),
      memories: input.memories.map((m) => ({ ...m })),
      auditLog: input.auditLog.map((a) => ({
        ...a,
        metadata: { ...a.metadata },
      })),
      settings: {
        ...input.settings,
        quietHours: { ...input.settings.quietHours },
      },
      personas: input.personas.map((p) => ({
        ...p,
        schema: { ...p.schema },
      })),
    },
  };
}

/**
 * Shareable profile — drops memory, S2 claims, emotional memories,
 * reasoning, audit, settings, personas. Only evidenced claims and their
 * referenced sources survive.
 */
export function buildShareableExport(input: FullStoreInput): ExportPackage {
  const keptClaims = stripReasoningFromClaims(
    filterEvidencedClaims(filterS2Claims(input.claims)),
  );
  const keptClaimIds = new Set(keptClaims.map((c) => c.id));
  const keptEvidence = keptClaims.flatMap((c) => c.evidence);
  const referencedSourceIds = new Set(keptEvidence.map((e) => e.sourceId));

  return {
    profile: 'shareable',
    profileId: input.profileId,
    exportedAt: input.exportedAt,
    version: 1,
    data: {
      messages: stripReasoning(input.messages),
      claims: keptClaims.map((c) => ({
        ...c,
        evidence: c.evidence.filter((e) => keptClaimIds.has(e.claimId)),
      })),
      sources: input.sources.filter((s) => referencedSourceIds.has(s.id)),
    },
  };
}

/**
 * Anonymised profile — same filtering as Shareable, plus PII is replaced
 * with stable placeholders. If a message/claim/quote ends up empty of
 * meaningful content, we still keep the row (structure preserved) with the
 * placeholder text.
 *
 * Section 90 FIX: every text field that can carry PII (message text, claim
 * text, evidence quote, source title, **source url**) is now routed through
 * `anonymiser.anonymise()`. The `URL_RE` inside the anonymiser collapses
 * `https://…` to a stable `<url-N>` placeholder, so an anonymised package
 * contains no raw URLs.
 */
export function buildAnonymisedExport(
  input: FullStoreInput,
  anonymiser: Anonymiser = createStableAnonymiser(),
): ExportPackage {
  const keptClaims = stripReasoningFromClaims(
    filterEvidencedClaims(filterS2Claims(input.claims)),
  );
  const keptClaimIds = new Set(keptClaims.map((c) => c.id));
  const keptEvidence = keptClaims.flatMap((c) => c.evidence);
  const referencedSourceIds = new Set(keptEvidence.map((e) => e.sourceId));

  return {
    profile: 'anonymised',
    profileId: input.profileId,
    exportedAt: input.exportedAt,
    version: 1,
    data: {
      messages: stripReasoning(input.messages).map((m) => ({
        ...m,
        text: anonymiser.anonymise(m.text),
      })),
      claims: keptClaims.map((c) => ({
        ...c,
        text: anonymiser.anonymise(c.text),
        evidence: c.evidence
          .filter((e) => keptClaimIds.has(e.claimId))
          .map((e) => ({
            ...e,
            quote: e.quote !== null ? anonymiser.anonymise(e.quote) : null,
          })),
      })),
      sources: input.sources
        .filter((s) => referencedSourceIds.has(s.id))
        .map((s) => ({
          ...s,
          // Section 90 FIX: anonymise BOTH the URL and the title. Before
          // this change, `url` stayed raw and leaked `https://…` into the
          // package, breaking the 0-leaks gate.
          url: anonymiser.anonymise(s.url),
          title: anonymiser.anonymise(s.title),
        })),
    },
  };
}
// === FILE END ===