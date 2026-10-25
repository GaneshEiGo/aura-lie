import { describe, it, expect } from 'vitest';
import { SSEFormatter } from '../src/sse.js';
import { SSEParser } from '../src/parser.js';

describe('SSE Stream Protocol (PRD 7.7)', () => {
  const formatter = new SSEFormatter();
  const parser = new SSEParser();

  it('should format events into strict SSE strings', () => {
    const event = { t: 'token', delta: 'Hello' };
    const formatted = formatter.formatEvent(event);
    expect(formatted).toBe('data: {"t":"token","delta":"Hello"}\n\n');
  });

  it('should format the done signal', () => {
    expect(formatter.formatDone()).toBe('data: [DONE]\n\n');
  });

  it('should parse SSE chunks back to typed objects', () => {
    const chunk = 'data: {"t":"token","delta":"Hello"}\n\ndata: {"t":"token","delta":" World"}\n\n';
    const events = parser.parseChunk(chunk);
    expect(events.length).toBe(2);
    expect(events[0].delta).toBe('Hello');
    expect(events[1].delta).toBe(' World');
  });

  it('should gracefully handle malformed JSON chunks', () => {
    const chunk = 'data: {invalid_json}\n\n';
    const events = parser.parseChunk(chunk);
    expect(events.length).toBe(0);
  });
});