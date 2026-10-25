// packages/track-record/src/types.ts
// PRD 8.11 / FR-TRUTH-21 / F-256.
// Owner labels past claims; calibration is tracked with ECE on a held-out split.

export type LabelOutcome = 'correct' | 'incorrect';

export interface Label {
  id: string;
  claimId: string;
  turnId: string;
  predictedScore: number; // 0..100
  outcome: LabelOutcome;
  labelledAt: number;     // epoch ms
  note?: string;
}

export interface CorrectionEntry {
  id: string;
  claimId: string;
  turnId: string;
  from: LabelOutcome;
  to: LabelOutcome;
  at: number;
}

export interface ReliabilityBin {
  bin: number;       // 0..9
  low: number;       // inclusive, 0..90 in steps of 10
  high: number;      // exclusive, 10..100 in steps of 10
  count: number;
  avgScore: number;  // 0..100
  accuracy: number;  // 0..1 (correct / count)
}

export interface ReliabilityDiagram {
  bins: ReliabilityBin[];
  totalLabels: number;
}

export type CalibrationStatus =
  | 'insufficient-data'
  | 'heuristic'
  | 'calibrated';

export interface TrackRecordState {
  status: CalibrationStatus;
  labelCount: number;
  ece: number;
  eceHoldout: number;
  holdoutSize: number;
  threshold: number;
  weeklyWrongCount: number;
  totalWrongCount: number;
  labelText: string;
  lastUpdated: number;
}