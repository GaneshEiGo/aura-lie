// === FILE START ===
// packages/safety/src/resources.ts
// PRD 11.9 step 4 · F-227.
// Region-aware crisis resources. Data, not prompts. Never hard-coded in a
// model prompt — always fetched from here and shown to the user verbatim.
// Numbers marked [VERIFY] are pending re-check before public release.

export interface SafetyResource {
  region: string;
  name: string;
  number: string;
  description: string;
  verifiedAt: number;
}

export const DEFAULT_REGION = 'IN';

export const SUPPORTED_REGIONS = ['IN', 'US', 'UK', 'EU', 'AU', 'CA'] as const;
export type SupportedRegion = (typeof SUPPORTED_REGIONS)[number];

const VERIFIED = Date.UTC(2026, 9, 2); // PRD research date

export const SAFETY_RESOURCES: Record<SupportedRegion, SafetyResource[]> = {
  IN: [
    {
      region: 'IN',
      name: 'National Emergency',
      number: '112',
      description: 'One number for all emergencies in India.',
      verifiedAt: VERIFIED,
    },
    {
      region: 'IN',
      name: 'Tele-MANAS',
      number: '14416',
      description: 'Free, 24/7 mental health helpline (Government of India).',
      verifiedAt: VERIFIED,
    },
    {
      region: 'IN',
      name: 'KIRAN Mental Health Helpline',
      number: '1800-599-0019',
      description: '24/7 toll-free mental health support, 13 languages.',
      verifiedAt: VERIFIED,
    },
    {
      region: 'IN',
      name: 'Vandrevala Foundation',
      number: '1860-2662-345',
      description: 'Free, confidential mental health counselling.',
      verifiedAt: VERIFIED,
    },
  ],
  US: [
    {
      region: 'US',
      name: 'Suicide and Crisis Lifeline',
      number: '988',
      description: 'Call or text 988, any time, any day.',
      verifiedAt: VERIFIED,
    },
    {
      region: 'US',
      name: 'Emergency Services',
      number: '911',
      description: 'If you are in immediate danger.',
      verifiedAt: VERIFIED,
    },
    {
      region: 'US',
      name: 'Crisis Text Line',
      number: '741741',
      description: 'Text HOME to 741741 to chat with a crisis counsellor.',
      verifiedAt: VERIFIED,
    },
  ],
  UK: [
    {
      region: 'UK',
      name: 'Samaritans',
      number: '116 123',
      description: 'Free, 24/7, confidential emotional support.',
      verifiedAt: VERIFIED,
    },
    {
      region: 'UK',
      name: 'Emergency Services',
      number: '999',
      description: 'If you are in immediate danger.',
      verifiedAt: VERIFIED,
    },
  ],
  EU: [
    {
      region: 'EU',
      name: 'European Emergency Number',
      number: '112',
      description: 'Works across the EU, any time, free.',
      verifiedAt: VERIFIED,
    },
  ],
  AU: [
    {
      region: 'AU',
      name: 'Lifeline',
      number: '13 11 14',
      description: '24/7 crisis support and suicide prevention.',
      verifiedAt: VERIFIED,
    },
    {
      region: 'AU',
      name: 'Emergency Services',
      number: '000',
      description: 'If you are in immediate danger.',
      verifiedAt: VERIFIED,
    },
  ],
  CA: [
    {
      region: 'CA',
      name: 'Suicide Crisis Helpline',
      number: '988',
      description: 'Call or text 988, 24/7.',
      verifiedAt: VERIFIED,
    },
    {
      region: 'CA',
      name: 'Emergency Services',
      number: '911',
      description: 'If you are in immediate danger.',
      verifiedAt: VERIFIED,
    },
  ],
};

/**
 * Return resources for a region. Falls back to the global EU 112 line if the
 * region is unknown, so every caller always gets at least one verified number.
 */
export function getResources(region: string = DEFAULT_REGION): SafetyResource[] {
  const key = region.toUpperCase();
  if (key in SAFETY_RESOURCES) {
    return SAFETY_RESOURCES[key as SupportedRegion].map((r) => ({ ...r }));
  }
  return [{ ...SAFETY_RESOURCES.EU[0] }];
}

/** True when the region is explicitly supported. */
export function isSupportedRegion(region: string): region is SupportedRegion {
  return (SUPPORTED_REGIONS as readonly string[]).includes(region.toUpperCase());
}
// === FILE END ===