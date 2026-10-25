// === FILE START ===
// packages/canvas/src/snapshots-v2.ts
// PRD §9.11 · §14.3 · FR-MEM-12 · F-050 · F-062 · T-13.
//
// World snapshots: save the state of a project on a date, then compare two
// snapshots. PRD §9.11: "3 meaningful changes, 1 minor, 7 unchanged."
//
// Meaningful vs minor:
//   · Meaningful — any change to `decisions` or `goals`, or the REMOVAL of
//     an open loop (an open loop closing is a completed piece of work)
//   · Minor      — changes to `tasks` or `files`, or the ADDITION of a new
//     open loop
//   · Unchanged  — identical
//
// No imports. Zero npm dependency. T-13 laptop-safety.

export interface ProjectState {
  projectId: string;
  goals: string[];
  tasks: string[];
  openLoops: string[];
  decisions: string[];
  files: string[];
}

export interface Snapshot {
  id: string;
  projectId: string;
  capturedAt: string;
  state: ProjectState;
}

export interface SnapshotDiffDetail {
  category: keyof Omit<ProjectState, 'projectId'>;
  kind: 'added' | 'removed';
  value: string;
  severity: 'meaningful' | 'minor';
}

export interface SnapshotDiff {
  snapshotA: string;
  snapshotB: string;
  meaningfulChanges: number;
  minorChanges: number;
  unchanged: number;
  details: SnapshotDiffDetail[];
}

const MEANINGFUL_ANY_CHANGE: ReadonlySet<keyof Omit<ProjectState, 'projectId'>> = new Set([
  'decisions',
  'goals',
]);

function categoryChanges(
  a: ProjectState,
  b: ProjectState,
  category: keyof Omit<ProjectState, 'projectId'>,
): { added: string[]; removed: string[]; unchanged: number } {
  const setA = new Set(a[category]);
  const setB = new Set(b[category]);
  const added: string[] = [];
  const removed: string[] = [];
  let unchanged = 0;
  for (const v of setB) {
    if (setA.has(v)) unchanged += 1;
    else added.push(v);
  }
  for (const v of setA) {
    if (!setB.has(v)) removed.push(v);
  }
  return { added, removed, unchanged };
}

export function createSnapshot(
  projectId: string,
  state: Omit<ProjectState, 'projectId'>,
  capturedAt: string,
  id?: string,
): Snapshot {
  if (typeof projectId !== 'string' || projectId.length === 0) {
    throw new Error('createSnapshot: projectId must be a non-empty string');
  }
  return {
    id: id ?? `snap-${projectId}-${capturedAt}`,
    projectId,
    capturedAt,
    state: {
      projectId,
      goals: [...state.goals],
      tasks: [...state.tasks],
      openLoops: [...state.openLoops],
      decisions: [...state.decisions],
      files: [...state.files],
    },
  };
}

export function diffSnapshots(a: Snapshot, b: Snapshot): SnapshotDiff {
  if (a.projectId !== b.projectId) {
    throw new Error(
      `diffSnapshots: cannot compare snapshots of different projects (${a.projectId} vs ${b.projectId})`,
    );
  }

  const categories: Array<keyof Omit<ProjectState, 'projectId'>> = [
    'decisions',
    'goals',
    'openLoops',
    'tasks',
    'files',
  ];

  const details: SnapshotDiffDetail[] = [];
  let meaningful = 0;
  let minor = 0;
  let unchanged = 0;

  for (const cat of categories) {
    const { added, removed, unchanged: u } = categoryChanges(a.state, b.state, cat);
    unchanged += u;

    const isMeaningfulCategory = MEANINGFUL_ANY_CHANGE.has(cat);

    for (const v of added) {
      // Removal of an open loop is meaningful; addition is minor.
      const severity: 'meaningful' | 'minor' = isMeaningfulCategory
        ? 'meaningful'
        : 'minor';
      details.push({ category: cat, kind: 'added', value: v, severity });
      if (severity === 'meaningful') meaningful += 1;
      else minor += 1;
    }
    for (const v of removed) {
      // Any decision/goal change is meaningful. Removing an open loop is
      // meaningful (the loop closed). Removing a task or file is minor.
      const severity: 'meaningful' | 'minor' =
        isMeaningfulCategory || cat === 'openLoops' ? 'meaningful' : 'minor';
      details.push({ category: cat, kind: 'removed', value: v, severity });
      if (severity === 'meaningful') meaningful += 1;
      else minor += 1;
    }
  }

  return {
    snapshotA: a.id,
    snapshotB: b.id,
    meaningfulChanges: meaningful,
    minorChanges: minor,
    unchanged,
    details,
  };
}
// === FILE END ===