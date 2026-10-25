export type PermissionClass = 'allow' | 'ask' | 'NEVER';

export interface ToolManifest {
  id: string;
  description: string;
  permissions: string[];
  risk: 'none' | 'low' | 'medium' | 'high';
  quota_pool?: string;
  timeout_ms: number;
  max_output_bytes: number;
}

export interface PermissionMatrix {
  [toolId: string]: PermissionClass;
}