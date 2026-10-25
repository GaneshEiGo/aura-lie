// === FILE START ===
// packages/agents/src/blueprints-v2.ts
// PRD §10.9 · FR-AGENT-08 · F-103 · T-13.
//
// Blueprints are saveable agent recipes as plain JSON data files. They are
// NEVER executable code. This module is the safety contract:
//   · validateBlueprint recursively rejects any key that could be interpreted
//     as code: `code`, `exec`, `execute`, `eval`, `script`, `function`, `fn`,
//     `run`.
//   · Every field that survives validation is a string, a number, a boolean,
//     a plain object, or an array of those. No functions, no symbols.
//   · save/load/export/import are all plain-data operations. Nothing here
//     touches the filesystem, the network, or the process.
//
// Zero external imports.

export type OutputFormat = 'markdown' | 'json' | 'table';

export type BlueprintStepKind =
  | 'read'
  | 'search'
  | 'verify'
  | 'synthesise'
  | 'write';

export interface BlueprintStep {
  kind: BlueprintStepKind;
  description: string;
  modelRole?: string;
}

export interface Blueprint {
  id: string;
  name: string;
  description: string;
  steps: BlueprintStep[];
  outputFormat: OutputFormat;
}

export type ValidationResult =
  | { ok: true; blueprint: Blueprint }
  | { ok: false; error: string };

const STEP_KINDS: readonly BlueprintStepKind[] = [
  'read', 'search', 'verify', 'synthesise', 'write',
];

const FORMATS: readonly OutputFormat[] = ['markdown', 'json', 'table'];

// Any of these keys anywhere in the blueprint makes it reject. A blueprint is
// data; the moment it can carry code it stops being safe to share.
const FORBIDDEN_KEYS: readonly string[] = [
  'code', 'exec', 'execute', 'eval', 'script', 'function', 'fn', 'run',
];

function findForbiddenKey(value: unknown, path: string): string | null {
  if (value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const inner = findForbiddenKey(value[i], `${path}[${i}]`);
      if (inner !== null) return inner;
    }
    return null;
  }
  for (const k of Object.keys(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.includes(k.toLowerCase())) {
      return `${path}.${k} is forbidden: blueprints are data, never code`;
    }
    const inner = findForbiddenKey(
      (value as Record<string, unknown>)[k],
      `${path}.${k}`,
    );
    if (inner !== null) return inner;
  }
  return null;
}

export function validateBlueprint(input: unknown): ValidationResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'blueprint must be a plain object' };
  }

  const forbidden = findForbiddenKey(input, 'blueprint');
  if (forbidden !== null) return { ok: false, error: forbidden };

  const obj = input as Record<string, unknown>;

  if (typeof obj['id'] !== 'string' || obj['id'].length === 0) {
    return { ok: false, error: 'id must be a non-empty string' };
  }
  if (typeof obj['name'] !== 'string' || obj['name'].length === 0) {
    return { ok: false, error: 'name must be a non-empty string' };
  }
  if (typeof obj['description'] !== 'string') {
    return { ok: false, error: 'description must be a string' };
  }
  if (!Array.isArray(obj['steps']) || obj['steps'].length === 0) {
    return { ok: false, error: 'steps must be a non-empty array' };
  }
  if (
    typeof obj['outputFormat'] !== 'string' ||
    !(FORMATS as readonly string[]).includes(obj['outputFormat'])
  ) {
    return {
      ok: false,
      error: `outputFormat must be one of: ${FORMATS.join(', ')}`,
    };
  }

  const steps: BlueprintStep[] = [];
  for (let i = 0; i < obj['steps'].length; i++) {
    const rawStep = obj['steps'][i];
    if (rawStep === null || typeof rawStep !== 'object' || Array.isArray(rawStep)) {
      return { ok: false, error: `steps[${i}] must be a plain object` };
    }
    const s = rawStep as Record<string, unknown>;
    if (
      typeof s['kind'] !== 'string' ||
      !(STEP_KINDS as readonly string[]).includes(s['kind'])
    ) {
      return {
        ok: false,
        error: `steps[${i}].kind must be one of: ${STEP_KINDS.join(', ')}`,
      };
    }
    if (typeof s['description'] !== 'string' || s['description'].length === 0) {
      return {
        ok: false,
        error: `steps[${i}].description must be a non-empty string`,
      };
    }
    const step: BlueprintStep = {
      kind: s['kind'] as BlueprintStepKind,
      description: s['description'],
    };
    if (s['modelRole'] !== undefined) {
      if (typeof s['modelRole'] !== 'string') {
        return { ok: false, error: `steps[${i}].modelRole must be a string` };
      }
      step.modelRole = s['modelRole'];
    }
    steps.push(step);
  }

  return {
    ok: true,
    blueprint: {
      id: obj['id'] as string,
      name: obj['name'] as string,
      description: obj['description'] as string,
      steps,
      outputFormat: obj['outputFormat'] as OutputFormat,
    },
  };
}

// In-memory registry. Not persistent. Data only — no side effects beyond the map.

const registry: Map<string, Blueprint> = new Map();

function cloneBlueprint(bp: Blueprint): Blueprint {
  return { ...bp, steps: bp.steps.map((s) => ({ ...s })) };
}

export function saveBlueprint(bp: Blueprint): void {
  registry.set(bp.id, cloneBlueprint(bp));
}

export function loadBlueprint(id: string): Blueprint | null {
  const bp = registry.get(id);
  return bp ? cloneBlueprint(bp) : null;
}

export function listBlueprints(): Blueprint[] {
  return Array.from(registry.values()).map(cloneBlueprint);
}

export function clearRegistry(): void {
  registry.clear();
}

export function exportBlueprint(bp: Blueprint): string {
  return JSON.stringify(bp, null, 2);
}

export function importBlueprint(json: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
  return validateBlueprint(parsed);
}
// === FILE END ===