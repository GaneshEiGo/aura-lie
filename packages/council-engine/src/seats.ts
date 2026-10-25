// packages/council-engine/src/seats.ts
// PRD 7.9: "Real council: at least two models from different families, called
// separately, plus role personas... Labelled 'Council: model A, model B, model C'."
// "Simulated dissent: one model role-playing several seats in a single call.
// Labelled 'Simulated dissent (single model)'."

import type {
  AvailableFamily,
  CouncilLabelling,
  CouncilSeat,
  SeatAssembly,
  SeatRequest,
} from './types.js';

/**
 * Assembles council seats from:
 *   - the requested personas/roles (per CouncilTurn)
 *   - the available model families the router has quota for
 *
 * Guarantees:
 *   - If at least two distinct families are available, the seats are
 *     labelled `real` and each seat is assigned to a different family when
 *     possible (round-robin so judges/critics see diversity — PRD 7.4
 *     "diversity_bonus").
 *   - If only one family is available, the seats are labelled `simulated`
 *     even if the caller asked for multiple personas.
 */
export function buildSeats(
  requested: SeatRequest[],
  available: AvailableFamily[],
): SeatAssembly {
  if (requested.length === 0) {
    return {
      seats: [],
      labelling: 'simulated',
      label: 'Simulated dissent (single model)',
    };
  }

  if (available.length === 0) {
    return {
      seats: [],
      labelling: 'simulated',
      label: 'Simulated dissent (single model)',
    };
  }

  const distinctFamilies = new Set(available.map((a) => a.family));

  if (distinctFamilies.size >= 2) {
    const seats: CouncilSeat[] = requested.map((req, idx) => {
      // Prefer the requested family if it's available; else round-robin
      // to the next available family to guarantee at least two distinct
      // families are actually seated.
      const preferred = available.find((a) => a.family === req.family);
      if (preferred) {
        return {
          role: req.role,
          persona: req.persona,
          family: preferred.family,
          modelId: preferred.modelId,
        };
      }
      const fallback = available[idx % available.length];
      return {
        role: req.role,
        persona: req.persona,
        family: fallback.family,
        modelId: fallback.modelId,
      };
    });

    // Final safety: if round-robin still produced a single family (e.g. all
    // requests mentioned the same family and it doesn't exist in `available`),
    // force diversity by reassigning seats.
    if (countDistinct(seats.map((s) => s.family)) < 2) {
      const families = available.map((a) => a.family);
      seats.forEach((seat, idx) => {
        seat.family = families[idx % families.length];
        const match = available.find((a) => a.family === seat.family);
        if (match) seat.modelId = match.modelId;
      });
    }

    return {
      seats,
      labelling: 'real',
      label: `Council: ${uniqueFamilies(seats).join(', ')}`,
    };
  }

  // Only one family available — simulated.
  const single = available[0];
  const seats: CouncilSeat[] = requested.map((req) => ({
    role: req.role,
    persona: req.persona,
    family: single.family,
    modelId: single.modelId,
  }));

  return {
    seats,
    labelling: 'simulated',
    label: 'Simulated dissent (single model)',
  };
}

function countDistinct<T>(items: T[]): number {
  return new Set(items).size;
}

function uniqueFamilies(seats: CouncilSeat[]): string[] {
  return Array.from(new Set(seats.map((s) => s.family)));
}

export function makeLabelling(labelling: CouncilLabelling): string {
  return labelling === 'real'
    ? 'Council: model A, model B, model C'
    : 'Simulated dissent (single model)';
}