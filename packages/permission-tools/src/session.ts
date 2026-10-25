// packages/permission-tools/src/session.ts
// Per-turn-session approvals for PRD 10.3 "ask once per session".

export class SessionContext {
  private readonly approved = new Set<string>();

  /** Mark a permission key like `code.execute` as approved this session. */
  approve(key: string): void {
    this.approved.add(key);
  }

  has(key: string): boolean {
    return this.approved.has(key);
  }

  /** Number of approvals recorded (for observability). */
  size(): number {
    return this.approved.size;
  }

  /** Clear all session approvals (e.g. on user logout). */
  reset(): void {
    this.approved.clear();
  }
}