// === FILE START ===
// packages/truth-score/src/track-record.ts
// PRD 8.11 · FR-TRUTH-21 · T-07 · F-256.
//
// The Track Record: a calibration curve comparing the score we *predicted*
// for a claim against whether the claim turned out to be *correct*.
//
// · `addLabel(claimId, predictedScore, actualCorrect)` — one label per
//   claim (upsert: a second call replaces the first).
// · `getCalibration(binsCount = 10)` — reliability diagram + ECE.
// · `removeLabel(claimId)` — for "I changed my mind".
//
// ECE (Expected Calibration Error):
//   For each bin: weight = count / total
//                 error  = |actualAccuracy - meanPredicted|
//   ECE = Σ (weight × error)
//
// T-07 gate: ECE ≤ 0.10 (before calibration) then ≤ 0.08 (target).
// When ECE ≤ 0.10, `meetsT07Gate` is true and the UI may drop the
// "heuristic" label once ECE ≤ 0.08 and sample size ≥ 500 (per PRD L10).

export interface CalibrationPair {
  claimId: string;
  /** 0..100, matching ClaimVerdict.score. */
  predictedScore: number;
  /** True if the claim turned out to be correct. */
  actualCorrect: boolean;
  /** ms since epoch. */
  labelledAt: number;
}

export interface ReliabilityBin {
  rangeStart: number;
  rangeEnd: number;
  count: number;
  correctCount: number;
  /** 0..1. Average predicted score in this bin (normalized). */
  meanPredicted: number;
  /** 0..1. correctCount / count. */
  actualAccuracy: number;
}

export interface CalibrationReport {
  bins: ReliabilityBin[];
  /** Expected Calibration Error, 0..1. */
  ece: number;
  sampleSize: number;
  /** T-07 hard gate: ECE ≤ 0.10. */
  meetsT07Gate: boolean;
  /** Stricter target from PRD 8.11: ECE ≤ 0.08 AND sampleSize ≥ 500. */
  meetsTarget: boolean;
}

const T07_GATE = 0.10;
const CALIBRATION_TARGET = 0.08;
const CALIBRATION_MIN_SAMPLES = 500;

export interface TrackRecordOptions {
  now?: () => number;
}

export class TrackRecord {
  private labels = new Map<string, CalibrationPair>();
  private readonly now: () => number;

  constructor(opts: TrackRecordOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
  }

  /** Add or replace a label for claimId. */
  addLabel(
    claimId: string,
    predictedScore: number,
    actualCorrect: boolean,
  ): void {
    if (typeof claimId !== 'string' || claimId.length === 0) {
      throw new Error(
        'TrackRecord.addLabel: claimId must be a non-empty string',
      );
    }
    if (
      !Number.isFinite(predictedScore) ||
      predictedScore < 0 ||
      predictedScore > 100
    ) {
      throw new Error(
        `TrackRecord.addLabel: predictedScore must be 0..100 (got ${predictedScore})`,
      );
    }
    const label: CalibrationPair = {
      claimId,
      predictedScore,
      actualCorrect,
      labelledAt: this.now(),
    };
    // Upsert
    this.labels.set(claimId, label);
  }

  removeLabel(claimId: string): boolean {
    return this.labels.delete(claimId);
  }

  hasLabel(claimId: string): boolean {
    return this.labels.has(claimId);
  }

  getLabelCount(): number {
    return this.labels.size;
  }

  getAllLabels(): ReadonlyArray<CalibrationPair> {
    return Array.from(this.labels.values());
  }

  /** Compute the reliability diagram + ECE. */
  getCalibration(binsCount: number = 10): CalibrationReport {
    if (!Number.isInteger(binsCount) || binsCount <= 0) {
      throw new Error(
        `TrackRecord.getCalibration: binsCount must be a positive integer (got ${binsCount})`,
      );
    }
    const binWidth = 100 / binsCount;
    const all = Array.from(this.labels.values());
    const total = all.length;

    const raw = Array.from({ length: binsCount }, () => ({
      predictedSum: 0,
      count: 0,
      correctCount: 0,
    }));

    for (const label of all) {
      const idx = Math.min(
        binsCount - 1,
        Math.floor(label.predictedScore / binWidth),
      );
      raw[idx].predictedSum += label.predictedScore;
      raw[idx].count += 1;
      if (label.actualCorrect) raw[idx].correctCount += 1;
    }

    let ece = 0;
    const bins: ReliabilityBin[] = raw.map((bin, i) => {
      const rangeStart = i * binWidth;
      const rangeEnd = (i + 1) * binWidth;
      if (bin.count === 0) {
        return {
          rangeStart,
          rangeEnd,
          count: 0,
          correctCount: 0,
          meanPredicted: 0,
          actualAccuracy: 0,
        };
      }
      const meanPredicted = bin.predictedSum / bin.count / 100;
      const actualAccuracy = bin.correctCount / bin.count;
      const error = Math.abs(actualAccuracy - meanPredicted);
      const weight = bin.count / total;
      ece += weight * error;
      return {
        rangeStart,
        rangeEnd,
        count: bin.count,
        correctCount: bin.correctCount,
        meanPredicted,
        actualAccuracy,
      };
    });

    return {
      bins,
      ece,
      sampleSize: total,
      meetsT07Gate: ece <= T07_GATE,
      meetsTarget:
        ece <= CALIBRATION_TARGET && total >= CALIBRATION_MIN_SAMPLES,
    };
  }
}
// === FILE END ===