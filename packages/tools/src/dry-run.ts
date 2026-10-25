import type { ToolManifest } from './types.js';

export class DryRunEngine {
  public generatePreview(tool: ToolManifest, input: any): string {
    return `Aura-lie wants to run ${tool.id} (Risk: ${tool.risk}).\nInput summary: ${JSON.stringify(input).substring(0, 100)}...`;
  }
}