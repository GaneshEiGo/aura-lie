// packages/blueprints/src/validator.ts
// PRD 14.7 — "Shared as a plain file, never executable code."

import type { Blueprint, ValidationResult } from './types.js';

const DANGEROUS_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'eval', re: /\beval\s*\(/i },
  { name: 'Function', re: /\bFunction\s*\(/i },
  { name: 'setTimeout', re: /\bsetTimeout\s*\(/i },
  { name: 'setInterval', re: /\bsetInterval\s*\(/i },
  { name: 'script-tag', re: /<script\b/i },
  { name: 'javascript-uri', re: /javascript\s*:/i },
  { name: 'require', re: /\brequire\s*\(/i },
  { name: 'import-statement', re: /\bimport\s*\(/i },
  { name: 'process', re: /\bprocess\./i },
];

const ALLOWED_ACTIONS = new Set([
  'search',
  'fetch',
  'read',
  'extract',
  'verify',
  'redteam',
  'synthesise',
  'format',
  'notify',
  'ask',
]);

export class BlueprintValidator {
  public validate(blueprint: any): ValidationResult {
    const errors: string[] = [];

    if (!blueprint || typeof blueprint !== 'object') {
      return { valid: false, errors: ['Blueprint is empty or not an object'] };
    }

    if (!blueprint.id || typeof blueprint.id !== 'string') {
      errors.push('Missing or invalid id');
    }
    if (!blueprint.name || typeof blueprint.name !== 'string') {
      errors.push('Missing or invalid name');
    }
    if (!blueprint.version || typeof blueprint.version !== 'string') {
      errors.push('Missing or invalid version');
    }
    if (!Array.isArray(blueprint.steps)) {
      errors.push('Missing or invalid steps array');
    }

    if (Array.isArray(blueprint.steps)) {
      const serialised = safeStringify(blueprint.steps);

      for (const { name, re } of DANGEROUS_PATTERNS) {
        if (re.test(serialised)) {
          errors.push(`Security violation: Found executable pattern (${name})`);
        }
      }

      // Structural validation of each step
      blueprint.steps.forEach((step: any, idx: number) => {
        if (!step || typeof step !== 'object') {
          errors.push(`Step ${idx} is not an object`);
          return;
        }
        if (!step.id || typeof step.id !== 'string') {
          errors.push(`Step ${idx} missing id`);
        }
        if (!step.description || typeof step.description !== 'string') {
          errors.push(`Step ${idx} missing description`);
        }
        if (typeof step.action === 'string' && !ALLOWED_ACTIONS.has(step.action)) {
          // Unknown action is a warning-level error the importer rejects.
          errors.push(`Step ${idx} uses unknown action "${step.action}"`);
        }
      });
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * PRD 10.9 — dry-run plan. No side effects, no execution.
   */
  public plan(blueprint: Blueprint): import('./types.js').ExecutionPlan {
    const warnings: string[] = [];
    if (blueprint.steps.length === 0) {
      warnings.push('Blueprint has no steps');
    }
    if (blueprint.steps.length > 20) {
      warnings.push('Blueprint exceeds the 20-step mission budget (PRD 10.9)');
    }
    if (!blueprint.outputFormat) {
      warnings.push('No outputFormat declared; defaulting to markdown');
    }

    // Conservative call estimate: 1 per step + 1 synthesis.
    const estimatedCalls = blueprint.steps.length + 1;

    return {
      blueprintId: blueprint.id,
      stepCount: blueprint.steps.length,
      estimatedCalls,
      steps: blueprint.steps.map((s) => ({ ...s })),
      warnings,
    };
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}