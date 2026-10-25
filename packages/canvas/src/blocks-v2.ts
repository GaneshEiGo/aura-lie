// === FILE START ===
// packages/canvas/src/blocks-v2.ts
// PRD §7.12 · FR-CANVAS-02 · T-13.
//
// PRD §7.12 response blocks:
//   "The renderer chooses presentation from intent and content. Authors
//    never format by hand."
//
// Intent → block mapping (PRD §7.12 table):
//   normal answer → paragraphs
//   comparison    → interactive table
//   process       → numbered steps or timeline
//   research      → evidence blocks with source cards
//   code          → code panel
//   planning      → checklist
//   math          → KaTeX  (handled by the renderer; block type is 'paragraph'
//                           with a `math` flag in the actual UI. v1 uses
//                           paragraph fallback so this module has no KaTeX
//                           dependency — the renderer decides.)
//   uncertainty   → unknowns panel
//   troubleshooting → decision tree
//   action        → task card
//
// Anti-over-formatting rule (Section 99's most important invariant):
//   · Unrecognised intents fall back to 'paragraph'.
//   · A casual question MUST NOT silently become a comparison table just
//     because the model wrote a bulleted list.
//   · This is enforced at the type level: `chooseBlock` returns
//     'paragraph' for every non-matching input.
//
// T-13 laptop-safety: no imports at all.

export type BlockType =
  | 'paragraph'
  | 'comparison-table'
  | 'numbered-steps'
  | 'timeline'
  | 'evidence-blocks'
  | 'code-panel'
  | 'checklist'
  | 'unknowns-panel'
  | 'decision-tree'
  | 'task-card';

export type Intent =
  | 'answer'
  | 'comparison'
  | 'process'
  | 'research'
  | 'code'
  | 'planning'
  | 'uncertainty'
  | 'troubleshooting'
  | 'action'
  | 'unknown';

/** The complete, frozen set of allowed block types. */
export const ALL_BLOCK_TYPES: readonly BlockType[] = Object.freeze([
  'paragraph',
  'comparison-table',
  'numbered-steps',
  'timeline',
  'evidence-blocks',
  'code-panel',
  'checklist',
  'unknowns-panel',
  'decision-tree',
  'task-card',
] as const);

/**
 * Map an intent to the block the renderer should use. Unknown intents
 * (including future ones cast at runtime) fall back to 'paragraph' — the
 * least-formatted, least-surprising option.
 */
export function chooseBlock(intent: Intent): BlockType {
  switch (intent) {
    case 'answer':
      return 'paragraph';
    case 'comparison':
      return 'comparison-table';
    case 'process':
      return 'numbered-steps';
    case 'research':
      return 'evidence-blocks';
    case 'code':
      return 'code-panel';
    case 'planning':
      return 'checklist';
    case 'uncertainty':
      return 'unknowns-panel';
    case 'troubleshooting':
      return 'decision-tree';
    case 'action':
      return 'task-card';
    case 'unknown':
      return 'paragraph';
    default:
      // Unknown future intents must degrade to the least formatted block.
      return 'paragraph';
  }
}
// === FILE END ===