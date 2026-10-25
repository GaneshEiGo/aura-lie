// packages/stream-coordinator/test/stream-coordinator.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  createJob,
  runSlice,
  cancelJob,
  currentToken,
  initialToken,
  stepTokenFor,
  parseStepToken,
  progressLabel,
  InMemoryJobStore,
  Outbox,
  DEFAULT_SUBREQUEST_CAP_PER_SLICE,
} from '../src/index.js';
import type {
  JobState,
  StepFn,
  StepOutcome,
} from '../src/index.js';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function makeStepFn(
  subrequestsUsed = 5,
): StepFn<{ n: number }> {
  return async (state) => ({
    state: { n: state.n + 1 },
    artifacts: [{ produced: state.n }],
    subrequestsUsed,
  });
}

// -----------------------------------------------------------------------------
describe('SSE Stream Coordinator (PRD 13.7, 13.8, T-23)', () => {
  // ---- Constants -----------------------------------------------
  it('DEFAULT_SUBREQUEST_CAP_PER_SLICE is 35 (PRD 13.3)', () => {
    expect(DEFAULT_SUBREQUEST_CAP_PER_SLICE).toBe(35);
  });

  // ---- createJob ----------------------------------------------
  it('createJob initializes a running job', () => {
    const job = createJob({
      kind: 'research',
      totalSteps: 4,
      initial: { n: 0 },
      now: 1_000,
    });
    expect(job.status).toBe('running');
    expect(job.cursor).toBe(0);
    expect(job.attempts).toBe(0);
    expect(job.totalSteps).toBe(4);
    expect(job.state).toEqual({ n: 0 });
    expect(job.stepResults).toEqual({});
    expect(job.startAt).toBe(1_000);
    expect(job.updatedAt).toBe(1_000);
    expect(job.nextRunAt).toBeNull();
  });

  it('createJob uses custom id when provided', () => {
    const job = createJob({
      kind: 'research',
      totalSteps: 1,
      initial: {},
      id: 'my-job',
      now: 1_000,
    });
    expect(job.id).toBe('my-job');
  });

  it('createJob generates unique ids', () => {
    const a = createJob({ kind: 'research', totalSteps: 1, initial: {}, now: 1 });
    const b = createJob({ kind: 'research', totalSteps: 1, initial: {}, now: 1 });
    expect(a.id).not.toBe(b.id);
  });

  it('createJob rejects invalid totalSteps', () => {
    expect(() =>
      createJob({ kind: 'research', totalSteps: 0, initial: {} }),
    ).toThrow(/totalSteps/);
  });

  // ---- Tokens --------------------------------------------------
  it('initialToken encodes the job id', () => {
    expect(initialToken({ id: 'abc' })).toBe('job:abc:init');
  });

  it('stepTokenFor encodes the cursor', () => {
    expect(stepTokenFor({ id: 'abc', cursor: 3 })).toBe('job:abc:step:3');
  });

  it('parseStepToken parses an init token', () => {
    const parsed = parseStepToken('job:abc:init');
    expect(parsed).toEqual({ jobId: 'abc', cursor: 'init' });
  });

  it('parseStepToken parses a step token', () => {
    const parsed = parseStepToken('job:abc:step:3');
    expect(parsed).toEqual({ jobId: 'abc', cursor: 3 });
  });

  it('parseStepToken returns null on malformed tokens', () => {
    expect(parseStepToken('garbage')).toBeNull();
    expect(parseStepToken('job::init')).toBeNull();
    expect(parseStepToken('job:abc:step:-1')).toBeNull();
    expect(parseStepToken('job:abc:step:xyz')).toBeNull();
  });

  // ---- progressLabel ------------------------------------------
  it('progressLabel reports cursor and total (PRD 13.7)', () => {
    expect(progressLabel({ cursor: 0, totalSteps: 8 })).toBe(
      'Working... 0 of 8 steps',
    );
    expect(progressLabel({ cursor: 3, totalSteps: 8 })).toBe(
      'Working... 3 of 8 steps',
    );
    expect(progressLabel({ cursor: 8, totalSteps: 8 })).toBe(
      'Working... 8 of 8 steps',
    );
  });

  // ---- runSlice: happy path ----------------------------------
  it('runSlice runs the first step and advances the cursor', async () => {
    const store = new InMemoryJobStore();
    const job = createJob({
      kind: 'research',
      totalSteps: 3,
      initial: { n: 0 },
      now: 1_000,
    });
    store.put(job);

    const result = await runSlice(job, {
      stepFn: makeStepFn(5),
      store,
      clientToken: initialToken(job),
      clock: { now: () => 2_000 },
    });

    expect(result.done).toBe(false);
    expect(result.cached).toBe(false);
    expect(result.job.cursor).toBe(1);
    expect(result.job.attempts).toBe(1);
    expect(result.job.state).toEqual({ n: 1 });
    expect(result.budget.used).toBe(5);
    expect(result.budget.exceeded).toBe(false);
    expect(result.nextToken).toBe('job:' + job.id + ':step:1');
  });

  it('runSlice saves the updated job to the store', async () => {
    const store = new InMemoryJobStore();
    const job = createJob({
      kind: 'research',
      totalSteps: 2,
      initial: { n: 0 },
      now: 1_000,
    });
    store.put(job);

    await runSlice(job, {
      stepFn: makeStepFn(3),
      store,
      clientToken: initialToken(job),
    });

    const persisted = store.get(job.id);
    expect(persisted).toBeDefined();
    expect(persisted?.cursor).toBe(1);
    expect(persisted?.attempts).toBe(1);
  });

  it('runSlice emits a continue event with the next token', async () => {
    const store = new InMemoryJobStore();
    const job = createJob({
      kind: 'research',
      totalSteps: 3,
      initial: { n: 0 },
      now: 1_000,
    });
    store.put(job);

    const result = await runSlice(job, {
      stepFn: makeStepFn(4),
      store,
      clientToken: initialToken(job),
    });

    expect(result.continueEvent).toBeDefined();
    expect(result.continueEvent?.t).toBe('continue');
    if (result.continueEvent && result.continueEvent.t === 'continue') {
      expect(result.continueEvent.stepToken).toBe(
        'job:' + job.id + ':step:1',
      );
      expect(result.continueEvent.reason).toContain('1 of 3');
    }
  });

  it('runSlice marks the job done when cursor reaches totalSteps', async () => {
    const store = new InMemoryJobStore();
    const job = createJob({
      kind: 'research',
      totalSteps: 2,
      initial: { n: 0 },
      now: 1_000,
    });
    store.put(job);

    const r1 = await runSlice(job, {
      stepFn: makeStepFn(5),
      store,
      clientToken: initialToken(job),
    });
    expect(r1.done).toBe(false);
    expect(r1.job.status).toBe('running');

    const r2 = await runSlice(r1.job, {
      stepFn: makeStepFn(5),
      store,
      clientToken: r1.nextToken!,
    });
    expect(r2.done).toBe(true);
    expect(r2.job.status).toBe('done');
    expect(r2.job.cursor).toBe(2);
    expect(r2.continueEvent).toBeUndefined();
  });

  // ---- Idempotency (T-23 "no duplicates") --------------------
  it('runSlice returns cached result on retry with same token', async () => {
    const store = new InMemoryJobStore();
    const job = createJob({
      kind: 'research',
      totalSteps: 3,
      initial: { n: 0 },
      now: 1_000,
    });
    store.put(job);

    const r1 = await runSlice(job, {
      stepFn: makeStepFn(5),
      store,
      clientToken: initialToken(job),
    });

    const r2 = await runSlice(r1.job, {
      stepFn: makeStepFn(5),
      store,
      clientToken: initialToken(job),
    });

    expect(r2.cached).toBe(true);
    expect(r2.job.cursor).toBe(1);
    expect(r2.outcome).toEqual(r1.outcome);
    expect(r2.nextToken).toBe(r1.nextToken);
  });

  it('runSlice does not re-execute on retry (attempts unchanged)', async () => {
    const store = new InMemoryJobStore();
    const job = createJob({
      kind: 'research',
      totalSteps: 3,
      initial: { n: 0 },
      now: 1_000,
    });
    store.put(job);

    let calls = 0;
    const stepFn: StepFn<{ n: number }> = async (state) => {
      calls += 1;
      return {
        state: { n: state.n + 1 },
        artifacts: [],
        subrequestsUsed: 1,
      };
    };

    const r1 = await runSlice(job, {
      stepFn,
      store,
      clientToken: initialToken(job),
    });
    expect(calls).toBe(1);

    await runSlice(r1.job, {
      stepFn,
      store,
      clientToken: initialToken(job),
    });
    // Still 1: cache hit on retry with the same token.
    expect(calls).toBe(1);

    // New token → step 1 runs → calls becomes 2.
    await runSlice(r1.job, {
      stepFn,
      store,
      clientToken: r1.nextToken!,
    });
    expect(calls).toBe(2);
  });

  // ---- Budget -------------------------------------------------
  it('runSlice accepts a step under the subrequest cap', async () => {
    const store = new InMemoryJobStore();
    const job = createJob({
      kind: 'research',
      totalSteps: 1,
      initial: { n: 0 },
      now: 1_000,
    });
    store.put(job);

    const result = await runSlice(job, {
      stepFn: makeStepFn(30), // 30 < 35
      store,
      clientToken: initialToken(job),
    });

    expect(result.budget.exceeded).toBe(false);
    expect(result.budget.used).toBe(30);
    expect(result.job.cursor).toBe(1);
    expect(result.done).toBe(true);
  });

  it('runSlice marks exceeded when over the subrequest cap', async () => {
    const store = new InMemoryJobStore();
    const job = createJob({
      kind: 'research',
      totalSteps: 3,
      initial: { n: 0 },
      now: 1_000,
    });
    store.put(job);

    const result = await runSlice(job, {
      stepFn: makeStepFn(50), // 50 > 35
      store,
      clientToken: initialToken(job),
    });

    expect(result.budget.exceeded).toBe(true);
    expect(result.budget.used).toBe(50);
    expect(result.error).toMatch(/exceeded/);
  });

  it('runSlice does not advance the cursor when exceeded', async () => {
    const store = new InMemoryJobStore();
    const job = createJob({
      kind: 'research',
      totalSteps: 3,
      initial: { n: 0 },
      now: 1_000,
    });
    store.put(job);

    const result = await runSlice(job, {
      stepFn: makeStepFn(50),
      store,
      clientToken: initialToken(job),
    });

    expect(result.job.cursor).toBe(0);
    expect(result.nextToken).toBeUndefined();
    expect(result.continueEvent).toBeUndefined();
  });

  it('runSlice caches exceeded steps to prevent duplicate work', async () => {
    const store = new InMemoryJobStore();
    const job = createJob({
      kind: 'research',
      totalSteps: 3,
      initial: { n: 0 },
      now: 1_000,
    });
    store.put(job);

    let calls = 0;
    const stepFn: StepFn<{ n: number }> = async () => {
      calls += 1;
      return { state: { n: 1 }, artifacts: [], subrequestsUsed: 100 };
    };

    const r1 = await runSlice(job, {
      stepFn,
      store,
      clientToken: initialToken(job),
    });
    expect(calls).toBe(1);

    const r2 = await runSlice(r1.job, {
      stepFn,
      store,
      clientToken: initialToken(job),
    });
    expect(calls).toBe(1); // cached, no re-run
    expect(r2.cached).toBe(true);
    expect(r2.budget.exceeded).toBe(true);
  });

  it('runSlice respects a custom subrequest cap', async () => {
    const store = new InMemoryJobStore();
    const job = createJob({
      kind: 'research',
      totalSteps: 1,
      initial: {},
      now: 1_000,
    });
    store.put(job);

    const result = await runSlice(job, {
      stepFn: async () => ({ state: {}, artifacts: [], subrequestsUsed: 10 }),
      store,
      clientToken: initialToken(job),
      maxSubrequestsPerSlice: 5, // tighter cap
    });

    expect(result.budget.exceeded).toBe(true);
    expect(result.budget.cap).toBe(5);
  });

  // ---- Terminal statuses -------------------------------------
  it('runSlice on a done job returns done: true, cached: true', async () => {
    const store = new InMemoryJobStore();
    const job: JobState<{ n: number }> = {
      ...createJob({
        kind: 'research',
        totalSteps: 1,
        initial: { n: 0 },
        now: 1_000,
      }),
      status: 'done',
      cursor: 1,
    };
    store.put(job);

    const stepFn = vi.fn(makeStepFn(5));
    const result = await runSlice(job, {
      stepFn,
      store,
      clientToken: 'job:x:step:1',
    });

    expect(result.done).toBe(true);
    expect(result.cached).toBe(true);
    expect(stepFn).not.toHaveBeenCalled();
  });

  it('runSlice on a stopped job returns done: true, cached: true', async () => {
    const store = new InMemoryJobStore();
    const job = cancelJob(
      createJob({
        kind: 'research',
        totalSteps: 5,
        initial: {},
        now: 1_000,
      }),
    );
    store.put(job);

    const stepFn = vi.fn(makeStepFn(5));
    const result = await runSlice(job, {
      stepFn,
      store,
      clientToken: initialToken(job),
    });

    expect(result.done).toBe(true);
    expect(result.cached).toBe(true);
    expect(stepFn).not.toHaveBeenCalled();
  });

  it('cancelJob sets status to stopped', () => {
    const job = createJob({
      kind: 'research',
      totalSteps: 3,
      initial: {},
      now: 1_000,
    });
    const stopped = cancelJob(job, 2_000);
    expect(stopped.status).toBe('stopped');
    expect(stopped.updatedAt).toBe(2_000);
  });

  it('cancelJob on a done job is a no-op', () => {
    const job: JobState = {
      ...createJob({ kind: 'research', totalSteps: 1, initial: {}, now: 1_000 }),
      status: 'done',
    };
    expect(cancelJob(job, 2_000).status).toBe('done');
  });

  // ---- StepFn throw ------------------------------------------
  it('runSlice marks status errored when stepFn throws', async () => {
    const store = new InMemoryJobStore();
    const job = createJob({
      kind: 'research',
      totalSteps: 3,
      initial: {},
      now: 1_000,
    });
    store.put(job);

    const result = await runSlice(job, {
      stepFn: async () => {
        throw new Error('step boom');
      },
      store,
      clientToken: initialToken(job),
    });

    expect(result.done).toBe(true);
    expect(result.error).toBe('step boom');
    expect(result.job.status).toBe('errored');
  });

  // ---- Store --------------------------------------------------
  it('InMemoryJobStore put/get/list/delete round-trips', () => {
    const store = new InMemoryJobStore();
    const job = createJob({
      kind: 'research',
      totalSteps: 1,
      initial: { n: 5 },
      now: 1_000,
    });
    store.put(job);
    expect(store.get(job.id)?.state).toEqual({ n: 5 });
    expect(store.list().length).toBe(1);
    store.delete(job.id);
    expect(store.get(job.id)).toBeUndefined();
    expect(store.list().length).toBe(0);
  });

  it('InMemoryJobStore returns clones (mutation-safe)', () => {
    const store = new InMemoryJobStore();
    const job = createJob({
      kind: 'research',
      totalSteps: 1,
      initial: { n: 0 },
      now: 1_000,
    });
    store.put(job);
    const got = store.get(job.id)!;
    (got.state as { n: number }).n = 999;
    expect((store.get(job.id)!.state as { n: number }).n).toBe(0);
  });

  it('JobState survives JSON round-trip', () => {
    const job = createJob({
      kind: 'research',
      totalSteps: 3,
      initial: { n: 0 },
      now: 1_000,
    });
    const roundtripped = JSON.parse(JSON.stringify(job)) as JobState<{ n: number }>;
    expect(roundtripped.id).toBe(job.id);
    expect(roundtripped.cursor).toBe(0);
    expect(roundtripped.stepResults).toEqual({});
  });

  // ---- currentToken helper -----------------------------------
  it('currentToken returns init token before any step', () => {
    const job = createJob({
      kind: 'research',
      totalSteps: 3,
      initial: {},
      now: 1_000,
    });
    expect(currentToken(job)).toBe(`job:${job.id}:init`);
  });

  it('currentToken returns step token after a step', async () => {
    const store = new InMemoryJobStore();
    const job = createJob({
      kind: 'research',
      totalSteps: 3,
      initial: { n: 0 },
      now: 1_000,
    });
    store.put(job);
    const result = await runSlice(job, {
      stepFn: makeStepFn(3),
      store,
      clientToken: initialToken(job),
    });
    expect(currentToken(result.job)).toBe(`job:${job.id}:step:1`);
  });

  // ---- Multi-step end-to-end --------------------------------
  it('completes a 3-step job end-to-end via continue tokens', async () => {
    const store = new InMemoryJobStore();
    const job = createJob({
      kind: 'research',
      totalSteps: 3,
      initial: { n: 0 },
      now: 1_000,
    });
    store.put(job);

    let token = initialToken(job);
    let step = 0;
    const artifacts: unknown[] = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = await runSlice(store.get(job.id)!, {
        stepFn: makeStepFn(3),
        store,
        clientToken: token,
      });
      artifacts.push(...(result.outcome?.artifacts ?? []));
      step += 1;
      if (result.done) {
        expect(result.job.status).toBe('done');
        expect(result.job.cursor).toBe(3);
        break;
      }
      token = result.nextToken!;
    }

    expect(step).toBe(3);
    expect(artifacts.length).toBe(3);
    expect((store.get(job.id)!.state as { n: number }).n).toBe(3);
  });

  // ---- Outbox (T-23) ------------------------------------------
  it('Outbox enqueues items in order', () => {
    const outbox = new Outbox();
    expect(outbox.enqueue('k1', { a: 1 }, 1_000)).toBe(true);
    expect(outbox.enqueue('k2', { a: 2 }, 2_000)).toBe(true);
    expect(outbox.enqueue('k3', { a: 3 }, 3_000)).toBe(true);
    const pending = outbox.pending();
    expect(pending.map((i) => i.key)).toEqual(['k1', 'k2', 'k3']);
  });

  it('Outbox dedupes by idempotency key', () => {
    const outbox = new Outbox();
    expect(outbox.enqueue('dup', { a: 1 })).toBe(true);
    expect(outbox.enqueue('dup', { a: 2 })).toBe(false);
    expect(outbox.size()).toBe(1);
    expect(outbox.has('dup')).toBe(true);
  });

  it('Outbox flushes in order and removes sent items', async () => {
    const outbox = new Outbox();
    outbox.enqueue('k1', { n: 1 });
    outbox.enqueue('k2', { n: 2 });
    outbox.enqueue('k3', { n: 3 });

    const order: number[] = [];
    const result = await outbox.flush((item) => {
      order.push((item.payload as { n: number }).n);
    });

    expect(result.sent).toBe(3);
    expect(result.failed).toBe(0);
    expect(order).toEqual([1, 2, 3]);
    expect(outbox.size()).toBe(0);
  });

  it('Outbox keeps failed items for retry', async () => {
    const outbox = new Outbox();
    outbox.enqueue('k1', { n: 1 });
    outbox.enqueue('k2', { n: 2 });
    outbox.enqueue('k3', { n: 3 });

    const result = await outbox.flush((item) => {
      const n = (item.payload as { n: number }).n;
      if (n === 2) throw new Error('send failed');
    });

    expect(result.sent).toBe(2);
    expect(result.failed).toBe(1);
    expect(outbox.size()).toBe(1);
    expect(outbox.pending()[0].key).toBe('k2');
  });

  it('Outbox clear resets everything', () => {
    const outbox = new Outbox();
    outbox.enqueue('k1', { a: 1 });
    outbox.enqueue('k2', { a: 2 });
    outbox.clear();
    expect(outbox.size()).toBe(0);
    expect(outbox.has('k1')).toBe(false);
    expect(outbox.has('k2')).toBe(false);
  });

  it('Outbox rejects empty keys', () => {
    const outbox = new Outbox();
    expect(() => outbox.enqueue('', { a: 1 })).toThrow(/non-empty/);
  });
});