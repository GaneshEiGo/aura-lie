// packages/track-record/src/labels.ts
// In-memory label store. Persistence (IndexedDB) lives in apps/web.

import type { CorrectionEntry, Label, LabelOutcome } from './types.js';

export interface RecordLabelParams {
  claimId: string;
  turnId: string;
  predictedScore: number;
  outcome: LabelOutcome;
  note?: string;
  at?: number;
}

export interface RecordLabelResult {
  label: Label;
  correction?: CorrectionEntry;
}

export class LabelStore {
  private labels: Label[] = [];
  private corrections: CorrectionEntry[] = [];
  private idCounter = 0;

  record(params: RecordLabelParams): RecordLabelResult {
    if (
      typeof params.predictedScore !== 'number' ||
      params.predictedScore < 0 ||
      params.predictedScore > 100
    ) {
      throw new Error('predictedScore must be a number between 0 and 100');
    }
    const at = params.at ?? Date.now();

    const existing = this.labels.find((l) => l.claimId === params.claimId);
    if (existing) {
      // Same outcome = no-op; a person clicking the same button twice.
      if (existing.outcome === params.outcome) {
        if (params.note !== undefined) existing.note = params.note;
        return { label: { ...existing } };
      }
      const correction: CorrectionEntry = {
        id: this.nextId('corr'),
        claimId: existing.claimId,
        turnId: existing.turnId,
        from: existing.outcome,
        to: params.outcome,
        at,
      };
      this.corrections.push(correction);
      existing.outcome = params.outcome;
      existing.labelledAt = at;
      if (params.note !== undefined) existing.note = params.note;
      return { label: { ...existing }, correction };
    }

    const label: Label = {
      id: this.nextId('label'),
      claimId: params.claimId,
      turnId: params.turnId,
      predictedScore: params.predictedScore,
      outcome: params.outcome,
      labelledAt: at,
      note: params.note,
    };
    this.labels.push(label);
    return { label: { ...label } };
  }

  remove(claimId: string): boolean {
    const before = this.labels.length;
    this.labels = this.labels.filter((l) => l.claimId !== claimId);
    return this.labels.length < before;
  }

  list(): Label[] {
    return this.labels.map((l) => ({ ...l }));
  }

  correctionsList(): CorrectionEntry[] {
    return this.corrections.map((c) => ({ ...c }));
  }

  size(): number {
    return this.labels.length;
  }

  clear(): void {
    this.labels = [];
    this.corrections = [];
    this.idCounter = 0;
  }

  private nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}-${this.idCounter.toString().padStart(6, '0')}`;
  }
}