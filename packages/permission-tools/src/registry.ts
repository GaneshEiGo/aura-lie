// packages/permission-tools/src/registry.ts
// PRD 12.1: tools are declared capabilities with a manifest.
// Validation rejects anything that would let the model bypass the matrix.

import type {
  PermissionClass,
  Resource,
  RiskLevel,
  RegisterResult,
  TaintBehavior,
  ToolManifest,
} from './types.js';
import {
  ALL_RESOURCES,
  VALID_PERMISSION_CLASSES,
  VALID_RISK_LEVELS,
} from './types.js';

const VALID_TAINTING: TaintBehavior[] = ['adds_untrusted', 'none'];

export function validateManifest(raw: unknown): RegisterResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['manifest must be an object'] };
  }
  const m = raw as Partial<ToolManifest>;

  if (!m.id || typeof m.id !== 'string') errors.push('id is required');
  else if (!/^[a-z][a-z0-9_]{2,63}$/.test(m.id)) {
    errors.push('id must be snake_case (3..64 chars, a-z0-9_)');
  }

  if (!m.description || typeof m.description !== 'string') {
    errors.push('description is required');
  }

  if (!m.inputSchema || typeof m.inputSchema !== 'object') {
    errors.push('inputSchema must be an object');
  }
  if (!m.outputSchema || typeof m.outputSchema !== 'object') {
    errors.push('outputSchema must be an object');
  }

  if (!Array.isArray(m.permissions)) {
    errors.push('permissions must be an array');
  } else if (m.permissions.length === 0) {
    errors.push('permissions must contain at least one entry');
  } else {
    for (const p of m.permissions) {
      if (typeof p !== 'string' || !p.includes(':')) {
        errors.push(`permission "${p}" must be "class:resource"`);
        continue;
      }
      const [cls, res] = p.split(':');
      if (!VALID_PERMISSION_CLASSES.includes(cls as PermissionClass)) {
        errors.push(`unknown permission class: ${cls}`);
      }
      if (!ALL_RESOURCES.includes(res as Resource)) {
        errors.push(`unknown resource: ${res}`);
      }
    }
  }

  if (!m.risk || !VALID_RISK_LEVELS.includes(m.risk as RiskLevel)) {
    errors.push(`risk must be one of ${VALID_RISK_LEVELS.join('|')}`);
  }

  if (m.quotaPool !== null && typeof m.quotaPool !== 'string') {
    errors.push('quotaPool must be string or null');
  }

  if (typeof m.timeoutMs !== 'number' || m.timeoutMs <= 0) {
    errors.push('timeoutMs must be a positive number');
  }
  if (typeof m.maxOutputBytes !== 'number' || m.maxOutputBytes <= 0) {
    errors.push('maxOutputBytes must be a positive number');
  }

  if (!m.tainting || !VALID_TAINTING.includes(m.tainting as TaintBehavior)) {
    errors.push(`tainting must be one of ${VALID_TAINTING.join('|')}`);
  }

  return { ok: errors.length === 0, errors };
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolManifest>();

  register(manifest: ToolManifest): RegisterResult {
    const result = validateManifest(manifest);
    if (!result.ok) return result;
    if (this.tools.has(manifest.id)) {
      return { ok: false, errors: [`duplicate tool id: ${manifest.id}`] };
    }
    this.tools.set(manifest.id, cloneManifest(manifest));
    return { ok: true, errors: [] };
  }

  get(id: string): ToolManifest | undefined {
    const tool = this.tools.get(id);
    return tool ? cloneManifest(tool) : undefined;
  }

  list(): ToolManifest[] {
    return Array.from(this.tools.values()).map(cloneManifest);
  }

  size(): number {
    return this.tools.size;
  }

  clear(): void {
    this.tools.clear();
  }
}

function cloneManifest(m: ToolManifest): ToolManifest {
  return {
    ...m,
    inputSchema: { ...m.inputSchema },
    outputSchema: { ...m.outputSchema },
    permissions: [...m.permissions],
  };
}