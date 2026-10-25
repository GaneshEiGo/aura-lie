import { describe, it, expect } from 'vitest';
import { PromiseQueue } from '../src/queue.js';

describe('Promise Queue (PRD 7.8, L15)', () => {
  it('should enqueue and dequeue requests in order (FIFO)', () => {
    const queue = new PromiseQueue();
    
    queue.enqueue('Message 1', 'instant', 'Aura-lie');
    queue.enqueue('Message 2', 'instant', 'Aura-lie');
    
    expect(queue.getQueueLength()).toBe(2);
    
    const first = queue.dequeue();
    expect(first?.message).toBe('Message 1');
    expect(queue.getQueueLength()).toBe(1);
  });

  it('should resolve a request and move it to completed', () => {
    const queue = new PromiseQueue();
    const req = queue.enqueue('Test message', 'think', 'Yuki');
    
    expect(queue.getQueueLength()).toBe(1);
    
    queue.resolve(req.id, 'This is the promised answer.');
    
    expect(queue.getQueueLength()).toBe(0);
    expect(queue.getCompleted().length).toBe(1);
    expect(queue.getCompleted()[0].response).toBe('This is the promised answer.');
  });

  it('should not resolve a non-existent request', () => {
    const queue = new PromiseQueue();
    queue.resolve('fake-id', 'Fake response');
    expect(queue.getCompleted().length).toBe(0);
  });
});