/**
 * PRD Appendix C: Server-Sent Events formatter.
 */
export class SSEFormatter {
  public formatEvent(event: any): string {
    return `data: ${JSON.stringify(event)}\n\n`;
  }

  public formatDone(): string {
    return `data: [DONE]\n\n`;
  }
}