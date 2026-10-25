export interface Env {
  AI: any; // Cloudflare Workers AI binding
  KILL_SWITCH: string;
  OWNER_TOKEN?: string;
}

export type Variables = {
  user: { id: string; role: string };
};