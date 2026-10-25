// packages/marketplace/src/validator.ts
// PRD 14.7: "Reviewed, schema-validated, no executable content."
// Reuses @aura-lie/blueprints/BlueprintValidator for blueprint items.

import { BlueprintValidator } from '@aura-lie/blueprints';
import type {
  MarketplaceItem,
  MarketplaceItemKind,
  ReviewResult,
} from './types.js';

const ITEM_KINDS: MarketplaceItemKind[] = ['blueprint', 'persona', 'workflow'];

const FORBIDDEN_PATTERNS: RegExp[] = [
  /\beval\s*\(/i,
  /\bFunction\s*\(/i,
  /<script\b/i,
  /javascript\s*:/i,
  /\brequire\s*\(/i,
  /\bimport\s*\(/i,
  /\bprocess\./i,
];

const FORBIDDEN_PERSONA_KEYS = [
  'truthRules',
  'safetyRules',
  'permissionMatrix',
  'killSwitch',
];

export class MarketplaceValidator {
  private readonly blueprintValidator = new BlueprintValidator();

  review(item: any): ReviewResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!item || typeof item !== 'object') {
      return { approved: false, errors: ['Item is empty or not an object'], warnings };
    }

    if (!item.id || typeof item.id !== 'string') {
      errors.push('Missing or invalid id');
    }
    if (!item.kind || !ITEM_KINDS.includes(item.kind)) {
      errors.push(`Invalid kind (must be one of: ${ITEM_KINDS.join(', ')})`);
    }
    if (!item.name || typeof item.name !== 'string') {
      errors.push('Missing or invalid name');
    }
    if (!item.description || typeof item.description !== 'string') {
      errors.push('Missing or invalid description');
    }
    if (!item.version || typeof item.version !== 'string') {
      errors.push('Missing or invalid version');
    }
    if (item.schemaVersion !== 1) {
      errors.push(`Unsupported schemaVersion: ${item.schemaVersion}`);
    }
    if (!item.content || typeof item.content !== 'object') {
      errors.push('Missing or invalid content');
    }

    // L9: no executable content anywhere in the payload
    const serialized = safeStringify(item.content);
    for (const re of FORBIDDEN_PATTERNS) {
      if (re.test(serialized)) {
        errors.push(`Security violation: executable pattern detected (${re.source})`);
      }
    }

    // Delegate to type-specific validation
    if (item.kind === 'blueprint' && item.content) {
      const bpResult = this.blueprintValidator.validate(item.content);
      if (!bpResult.valid) {
        for (const e of bpResult.errors) errors.push(`Blueprint: ${e}`);
      }
    }

    if (item.kind === 'persona' && item.content) {
      this.validatePersona(item.content, errors);
    }

    if (item.kind === 'workflow' && item.content) {
      this.validateWorkflow(item.content, errors);
    }

    return { approved: errors.length === 0, errors, warnings };
  }

  private validatePersona(content: any, errors: string[]): void {
    if (!content.id || typeof content.id !== 'string') {
      errors.push('Persona: missing id');
    }
    if (!content.name || typeof content.name !== 'string') {
      errors.push('Persona: missing name');
    }
    if (content.sliders !== undefined && typeof content.sliders !== 'object') {
      errors.push('Persona: sliders must be an object');
    }
    for (const key of FORBIDDEN_PERSONA_KEYS) {
      if (content[key] !== undefined) {
        errors.push(`Persona: "${key}" cannot be overridden by a persona`);
      }
    }
  }

  private validateWorkflow(content: any, errors: string[]): void {
    if (!Array.isArray(content.steps)) {
      errors.push('Workflow: missing steps array');
      return;
    }
    if (content.steps.length > 20) {
      errors.push('Workflow: exceeds 20-step budget (PRD 10.9)');
    }
  }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}