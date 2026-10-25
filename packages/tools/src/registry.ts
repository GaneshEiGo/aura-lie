import type { ToolManifest, PermissionMatrix, PermissionClass } from './types.js';

export class ToolRegistry {
  private tools = new Map<string, ToolManifest>();

  public register(tool: ToolManifest) {
    this.tools.set(tool.id, tool);
  }

  public getTool(id: string): ToolManifest | undefined {
    return this.tools.get(id);
  }

  public canExecute(toolId: string, matrix: PermissionMatrix): PermissionClass {
    const tool = this.tools.get(toolId);
    if (!tool) return 'NEVER'; // Deny by default if tool doesn't exist

    const permission = matrix[toolId] || 'ask'; // Default to ask if not explicitly set
    if (permission === 'NEVER') return 'NEVER';
    return permission;
  }
}