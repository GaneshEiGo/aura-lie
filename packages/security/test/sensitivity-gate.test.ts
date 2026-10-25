// === FILE START ===
// packages/security/test/sensitivity-gate.test.ts
// PRD 12.3 · F-226 · FR-WF-06 · FR-MEM-08 · T-27.
//
// Section 71.1 fix: S0_EXAMPLES has 115 entries (better coverage). The two
// count assertions now check `>= 100` / `>= 300` rather than `=== 100` /
// `=== 300`. Every other test is unchanged.

import { describe, it, expect } from 'vitest';
import {
  classify,
  classifyWithReason,
  isPrivate,
} from '../src/sensitivity.js';
import {
  canSend,
  selectProviders,
  filterMemoriesForProvider,
  hasPrivateMemories,
} from '../src/lanes.js';
import type {
  ProviderInfo,
  LanePreferences,
  LaneOverride,
} from '../src/lanes.js';

// =============================================================================
// 300+ test cases: 100 S2 + 100 S1 + 115 S0
// =============================================================================

const S2_EXAMPLES: string[] = [
  // Health (20)
  'I was diagnosed with type 2 diabetes last month',
  'My cholesterol is high, my doctor put me on statins',
  "I'm on insulin twice a day for diabetes",
  'My cancer treatment starts next week',
  'I have chronic migraines',
  'My therapist suggested EMDR',
  "I'm seeing a psychiatrist for bipolar disorder",
  'I have an appointment at the hospital tomorrow',
  'My prescription ran out',
  'I was in therapy for a year',
  'My blood pressure is 150 over 95',
  'I have an MRI scheduled',
  'The surgery is on the 15th',
  'My HIV medication is working',
  'I have asthma and carry an inhaler',
  'My blood sugar readings are high',
  'I have a chronic illness',
  'My disability affects my work',
  'The X-ray showed a fracture',
  "I've been having panic attacks",

  // Money (20)
  'My salary is 12 lakh per annum',
  'I have 3 credit cards with a combined limit of 5 lakh',
  'My EMI is 45,000 per month',
  'I owe 2 crore in debt',
  'My PAN is ABCDE1234F',
  'My Aadhaar number is 1234-5678-9012',
  'I have 5 lakh in savings',
  'My CVV is 123',
  'I make $85,000 a year',
  'My bank account number is 9876543210',
  'My SSN is 123-45-6789',
  'I owe ₹50,000 on my credit card',
  'My net worth is around 1.2 crore',
  'My IFSC code is HDFC0001234',
  'My take-home pay is 60K per month',
  "I'm applying for a loan",
  'My mortgage is 30 years',
  'I have significant debt',
  'My investment portfolio is down 20%',
  'My 401k balance is 50K',

  // Relationships (15)
  'My wife and I are going through a divorce',
  'My boyfriend cheated on me',
  'My girlfriend broke up with me',
  'My husband is abusive',
  "We're separated but haven't filed",
  'My mom passed away last year',
  'My dad has cancer',
  "My ex won't leave me alone",
  'My partner and I are in couples therapy',
  'My spouse wants custody',
  "I'm grieving my grandmother",
  'My brother is in rehab',
  'My ex-husband is stalking me',
  'My fiancé called off the wedding',
  "I'm dealing with a difficult breakup",

  // Credentials (15)
  'My password is hunter2',
  'The API key is sk-abc123def456ghi789',
  'My bearer token is eyJhbGciOiJIUzI1NiJ9',
  'The OTP is 827364',
  'My GitHub token is ghp_abc123def456ghi789jkl012',
  'AWS key AKIAIOSFODNN7EXAMPLE',
  'My private key starts with -----BEGIN RSA PRIVATE KEY-----',
  'The secret key is abcdef1234567890',
  "Use my passphrase 'correct-horse-battery'",
  'My card PIN is 4321',
  'My CVV is 876',
  'The database password is admin123',
  'My JWT is eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'The Stripe key is sk_live_abc123def456ghi789',
  'My API secret is xyz789abc123def456',

  // Minors (10)
  'My 8-year-old is having trouble at school',
  'My kid is 12 and struggling',
  "My son's teacher called",
  'My daughter is being bullied',
  'My toddler has a fever',
  'My teenager is going through a phase',
  'My child is 5 years old',
  "My kid's school fees are due",
  "My daughter's exam results came out",
  'My son is being assessed for ADHD',

  // Mental state (10)
  "I'm feeling hopeless",
  "I've been so depressed lately",
  'My anxiety is out of control',
  'I had a panic attack yesterday',
  "I'm seeing a therapist for PTSD",
  'I was diagnosed with bipolar disorder',
  'I feel worthless',
  "I can't stop thinking about my trauma",
  'My OCD has been flaring up',
  "I'm struggling with depression",

  // Legal (10)
  'I have a court hearing on Monday',
  'My lawyer says I might face charges',
  'I was arrested last night',
  'I need bail money',
  "I'm being sued",
  'My FIR was filed',
  "I'm on probation",
  'My divorce attorney is expensive',
  'I have a criminal record',
  "I'm facing eviction",
];

const S1_EXAMPLES: string[] = [
  // Projects (25)
  "I'm working on a project about climate data",
  'My side project is a note-taking app',
  "I'm building a small tool for my team",
  'My startup idea is a delivery service',
  "I'm launching a newsletter",
  'My project uses React and TypeScript',
  "I'm writing a book about productivity",
  'My thesis is on distributed systems',
  "I'm designing a website",
  'My project site needs updating',
  "I'm prototyping a new feature",
  'My code review is overdue',
  "I'm stuck on this algorithm",
  'My project deadline is Friday',
  'I need to refactor my codebase',
  "I'm learning Rust",
  'My team is growing',
  "I'm mentoring two interns",
  'I need feedback on my draft',
  "I'm planning the architecture",
  'My project budget is 50K rupees',
  "I'm testing in staging",
  'My last commit broke things',
  'I need to deploy soon',
  "I'm writing documentation",

  // Preferences (25)
  'I prefer tea over coffee',
  'I like dark mode',
  'I love minimal interfaces',
  'I hate crowded places',
  'My favorite book is Dune',
  'I enjoy cooking on weekends',
  'I dislike small talk',
  'I prefer async communication',
  'I like working from home',
  'My favorite language is Python',
  'I hate meetings before 10am',
  'I love sci-fi novels',
  'I prefer dark themes',
  'I enjoy hiking',
  'My favorite color is blue',
  'I dislike phone calls',
  'I prefer reading to watching',
  'I like winter',
  'I hate long commutes',
  'I love tea',
  'I prefer handwritten notes',
  'I enjoy board games',
  'My favorite season is autumn',
  'I dislike loud music',
  'I prefer cats to dogs',

  // Plans (25)
  "I'm planning a trip to Japan",
  "I'm going to learn Spanish",
  "I'm considering a career change",
  "I'm thinking about starting a podcast",
  "Next month I'll start a course",
  'My plan is to read 20 books',
  "I'm going to switch jobs",
  'I want to move to a new city',
  "I'll take a sabbatical next year",
  "I'm planning my wedding",
  "I'm going to adopt a dog",
  'I want to learn to surf',
  "I'm planning to visit my parents",
  'My goal is to run a marathon',
  'I want to write more',
  "I'm thinking about quitting caffeine",
  "I'll take a break next week",
  "I'm going to start journaling",
  'I plan to wake up earlier',
  'I want to save more money',
  "I'll try a new recipe",
  "I'm planning to host a dinner",
  'I want to be more consistent',
  "I'll go to the gym more",
  'I want to learn a new language',

  // Routine / work (25)
  'I usually wake up at 6am',
  'I always check email first',
  'I work at a startup',
  'My job involves data analysis',
  'My boss is demanding',
  'My team is remote',
  'I work from 9 to 5',
  'I study computer science',
  'My course ends in May',
  "I'm reading a book on statistics",
  'I live in Bangalore',
  "I'm from Mumbai originally",
  'I moved to Delhi last year',
  'My name is Alex',
  'Call me Sam',
  "I'm 28 years old",
  'My age is 32',
  "I'm learning to cook",
  'I wake up early',
  'I run every morning',
  'I work on machine learning',
  'My company is small',
  "I'm reading three books",
  'I take the metro to work',
  'I usually cook at home',
];

const S0_EXAMPLES: string[] = [
  // Facts (10)
  'What is the capital of France?',
  'How tall is Mount Everest?',
  'What is the boiling point of water?',
  'Who wrote Pride and Prejudice?',
  'What is the speed of light?',
  'How many continents are there?',
  'What is photosynthesis?',
  'Who painted the Mona Lisa?',
  'What is the largest ocean?',
  'When did World War II end?',
  // Math (10)
  'What is 15 times 27?',
  'Calculate the area of a circle with radius 5',
  'What is the square root of 144?',
  'How do you compute a factorial?',
  'What is the derivative of x squared?',
  'Solve the equation 2x + 5 = 15',
  'Integrate x^2 dx',
  'Differentiate sin(x)',
  'What is the area of a triangle with base 4 and height 6?',
  'Convert 100 degrees Fahrenheit to Celsius',
  // Coding without "I" (20)
  'Reverse a string in Python',
  'Sort an array in JavaScript',
  'Parse JSON in Go',
  'Create a REST API with Express',
  'Fix a null pointer exception in Java',
  'Explain closures in JavaScript',
  'What is dependency injection?',
  'How does async/await work?',
  'What is the difference between SQL and NoSQL?',
  'How to center a div in CSS',
  'What is a binary search tree?',
  'Explain the CAP theorem',
  'What is a monad?',
  'How to use WebSockets',
  'What is a Promise in JavaScript?',
  'How to write a unit test',
  'What is a Git rebase?',
  'Explain the MVC pattern',
  'What is a Kubernetes pod?',
  'How to deploy to Cloudflare Workers',
  // Science (10)
  'What is the theory of relativity?',
  'How does DNA replication work?',
  'What is the chemical formula for water?',
  'How do vaccines work?',
  'What is quantum entanglement?',
  'Explain evolution by natural selection',
  'What is a black hole?',
  'How do neurons transmit signals?',
  'What is the Higgs boson?',
  'How does photosynthesis convert light to energy?',
  // General knowledge (10)
  'Who is the current UN Secretary-General?',
  'What are the primary colors?',
  'When is the next leap year?',
  'What is the GDP of Japan?',
  'How many bones are in the human body?',
  'What are the symptoms of the common cold?',
  'What is the recommended daily water intake?',
  'How is coffee decaffeinated?',
  'What is the difference between a comet and an asteroid?',
  'Who invented the telephone?',
  // Historical / geographic (10)
  'When was the Eiffel Tower built?',
  'Where is the Amazon rainforest located?',
  'Who was the first president of the United States?',
  'What year did the Berlin Wall fall?',
  'Where is Machu Picchu?',
  'What is the tallest building in the world?',
  'What is the smallest country by area?',
  'How many countries are in Africa?',
  'When did humans first land on the moon?',
  'What is the deepest ocean trench?',
  // More facts (30)
  'What is the largest desert?',
  'Who invented the printing press?',
  'When was the internet created?',
  'What is the chemical symbol for gold?',
  'How many teeth does an adult human have?',
  'Define photosynthesis',
  'Explain the water cycle',
  'Describe how a transistor works',
  'List the planets in the solar system',
  'Summarize the causes of World War I',
  'What causes earthquakes?',
  'How does gravity work?',
  'What is the periodic table?',
  'Who discovered penicillin?',
  'What is the boiling point of mercury?',
  'How many planets are in the solar system?',
  'What is the chemical symbol for iron?',
  'How far is the moon from Earth?',
  'What is the largest mammal?',
  'What is the smallest prime number?',
  "What is the square root of 2?",
  "What is Euler's number?",
  'What is the golden ratio?',
  'How many sides does a hexagon have?',
  'What is a pentagon?',
  'What is the Pythagorean theorem?',
  'Explain the Doppler effect',
  'What is the second law of thermodynamics?',
  'What is entropy?',
  'What is the speed of sound?',
  // Creative without personal detail (15)
  'Write a haiku about autumn',
  'Draft a professional email about a meeting reschedule',
  'Create a short poem about the ocean',
  'Write a product description for a coffee mug',
  'Compose a tweet about sustainable fashion',
  'Draft a cover letter template for a software engineer role',
  'Write a scene where a character finds a lost key',
  'Create a slogan for an eco-friendly brand',
  'Write a short story about a robot learning to paint',
  'Draft a thank-you note to a new client',
  'Write a limerick about a cat',
  'Compose a short sonnet about winter',
  'Draft a blog post about remote work',
  'Write a product review for noise-cancelling headphones',
  'Create a tagline for a new coffee shop',
];

// =============================================================================
// Sanity — corpus size (>=, not ==, because better coverage is fine)
// =============================================================================

describe('test corpus integrity', () => {
  it('has at least 100 S2 cases', () => {
    expect(S2_EXAMPLES.length).toBeGreaterThanOrEqual(100);
  });
  it('has at least 100 S1 cases', () => {
    expect(S1_EXAMPLES.length).toBeGreaterThanOrEqual(100);
  });
  it('has at least 100 S0 cases', () => {
    expect(S0_EXAMPLES.length).toBeGreaterThanOrEqual(100);
  });
  it('has at least 300 cases total', () => {
    expect(
      S2_EXAMPLES.length + S1_EXAMPLES.length + S0_EXAMPLES.length,
    ).toBeGreaterThanOrEqual(300);
  });
});

// =============================================================================
// Classification correctness
// =============================================================================

describe('classify — S2 corpus', () => {
  it('every S2 example classifies as S2', () => {
    const failures: string[] = [];
    for (const text of S2_EXAMPLES) {
      const c = classify(text);
      if (c !== 'S2') failures.push(`"${text}" → ${c}`);
    }
    if (failures.length > 0) console.log('\nS2 misses:\n' + failures.join('\n'));
    expect(failures.length).toBe(0);
  });
});

describe('classify — S1 corpus', () => {
  it('every S1 example classifies as S1', () => {
    const failures: string[] = [];
    for (const text of S1_EXAMPLES) {
      const c = classify(text);
      if (c !== 'S1') failures.push(`"${text}" → ${c}`);
    }
    if (failures.length > 0) console.log('\nS1 misses:\n' + failures.join('\n'));
    expect(failures.length).toBe(0);
  });
});

describe('classify — S0 corpus', () => {
  it('every S0 example classifies as S0', () => {
    const failures: string[] = [];
    for (const text of S0_EXAMPLES) {
      const c = classify(text);
      if (c !== 'S0') failures.push(`"${text}" → ${c}`);
    }
    if (failures.length > 0) console.log('\nS0 misses:\n' + failures.join('\n'));
    expect(failures.length).toBe(0);
  });
});

// =============================================================================
// T-27 GATE — 0 leaks
// =============================================================================

describe('T-27 sensitivity gate', () => {
  const trainingRisk: ProviderInfo = { id: 'gemini', lane: 'training-risk' };
  const privateLane: ProviderInfo = { id: 'groq', lane: 'private' };
  const prefsNoOptIn: LanePreferences = { allowTrainingRiskForS1: false };
  const prefsOptIn: LanePreferences = { allowTrainingRiskForS1: true };

  it('0 leaks: no S2 case reaches training-risk without override', () => {
    let s2Count = 0;
    let leaks = 0;
    const leakTexts: string[] = [];
    for (const text of [...S2_EXAMPLES, ...S1_EXAMPLES, ...S0_EXAMPLES]) {
      const c = classify(text);
      if (c !== 'S2') continue;
      s2Count += 1;
      const result = canSend(text, trainingRisk, prefsNoOptIn);
      if (result.allowed) {
        leaks += 1;
        leakTexts.push(`"${text}"`);
      }
    }
    if (leaks > 0) console.log('\nLEAKS:\n' + leakTexts.join('\n'));
    // eslint-disable-next-line no-console
    console.log(`T-27: ${s2Count} S2 cases, ${leaks} leaks (need 0)`);
    expect(s2Count).toBeGreaterThanOrEqual(100);
    expect(leaks).toBe(0);
  });

  it('0 leaks: no S1 case reaches training-risk without opt-in', () => {
    let leaks = 0;
    for (const text of [...S1_EXAMPLES, ...S0_EXAMPLES]) {
      if (classify(text) !== 'S1') continue;
      const result = canSend(text, trainingRisk, prefsNoOptIn);
      if (result.allowed) leaks += 1;
    }
    expect(leaks).toBe(0);
  });

  it('S2 with explicit override is allowed to training-risk', () => {
    const override: LaneOverride = { allowTrainingRiskForS2: true };
    const result = canSend(
      'My therapist suggested EMDR',
      trainingRisk,
      prefsNoOptIn,
      override,
    );
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('explicit');
  });

  it('S1 with user opt-in is allowed to training-risk', () => {
    const result = canSend('I prefer tea over coffee', trainingRisk, prefsOptIn);
    expect(result.allowed).toBe(true);
  });

  it('S0 is always allowed to any lane', () => {
    expect(canSend('What is 2 + 2?', trainingRisk, prefsNoOptIn).allowed).toBe(true);
    expect(canSend('What is 2 + 2?', privateLane, prefsNoOptIn).allowed).toBe(true);
  });

  it('S2 to private lane is always allowed', () => {
    for (const text of S2_EXAMPLES) {
      expect(canSend(text, privateLane, prefsNoOptIn).allowed).toBe(true);
    }
  });
});

// =============================================================================
// FR-WF-06
// =============================================================================

describe('FR-WF-06 sensitivity classes gate providers', () => {
  const trainingRisk: ProviderInfo = { id: 'gemini', lane: 'training-risk' };
  const prefs: LanePreferences = { allowTrainingRiskForS1: false };

  it('blocks S1 to training-risk without opt-in', () => {
    const result = canSend('I prefer tea over coffee', trainingRisk, prefs);
    expect(result.allowed).toBe(false);
    expect(result.reason.toLowerCase()).toContain('private');
  });

  it('allows S1 to training-risk with opt-in', () => {
    const result = canSend('I prefer tea over coffee', trainingRisk, {
      allowTrainingRiskForS1: true,
    });
    expect(result.allowed).toBe(true);
  });
});

// =============================================================================
// FR-MEM-08
// =============================================================================

describe('FR-MEM-08 privacy zones', () => {
  const privateLane: ProviderInfo = { id: 'groq', lane: 'private' };
  const trainingRisk: ProviderInfo = { id: 'gemini', lane: 'training-risk' };

  it('excludes S2 memories for private-lane providers', () => {
    const memories = [
      { sensitivity: 'S0' as const, text: 'prefers tea' },
      { sensitivity: 'S1' as const, text: 'lives in Bangalore' },
      { sensitivity: 'S2' as const, text: 'has diabetes' },
    ];
    const filtered = filterMemoriesForProvider(memories, privateLane);
    expect(filtered.length).toBe(2);
    expect(filtered.every((m) => m.sensitivity !== 'S2')).toBe(true);
  });

  it('excludes S2 memories for training-risk providers', () => {
    const memories = [
      { sensitivity: 'S2' as const, text: 'salary is 12 lakh' },
    ];
    expect(filterMemoriesForProvider(memories, trainingRisk).length).toBe(0);
  });

  it('keeps S0 and S1 memories', () => {
    const memories = [
      { sensitivity: 'S0' as const, text: 'a' },
      { sensitivity: 'S1' as const, text: 'b' },
    ];
    expect(filterMemoriesForProvider(memories, trainingRisk).length).toBe(2);
  });

  it('hasPrivateMemories detects any S2 memory', () => {
    expect(hasPrivateMemories([{ sensitivity: 'S2' as const }])).toBe(true);
    expect(
      hasPrivateMemories([
        { sensitivity: 'S0' as const },
        { sensitivity: 'S1' as const },
      ]),
    ).toBe(false);
  });
});

// =============================================================================
// Privacy zones
// =============================================================================

describe('privacy zones', () => {
  it('a matched zone upgrades to S2', () => {
    const c = classify('Project X-19 is behind schedule', {
      privacyZones: ['project x-19', 'x-19'],
    });
    expect(c).toBe('S2');
  });

  it('no match falls through to normal classification', () => {
    const c = classify('What is 2 + 2?', { privacyZones: ['xyz'] });
    expect(c).toBe('S0');
  });

  it('isPrivate reflects classify === S2', () => {
    expect(isPrivate('My salary is 12 lakh')).toBe(true);
    expect(isPrivate('What is 2 + 2?')).toBe(false);
  });
});

// =============================================================================
// selectProviders
// =============================================================================

describe('selectProviders', () => {
  const providers: ProviderInfo[] = [
    { id: 'groq', lane: 'private' },
    { id: 'gemini', lane: 'training-risk' },
    { id: 'openrouter', lane: 'training-risk' },
  ];

  it('S0 gets all providers', () => {
    const selected = selectProviders('What is 2 + 2?', providers, {
      allowTrainingRiskForS1: false,
    });
    expect(selected.length).toBe(3);
  });

  it('S1 gets only private by default', () => {
    const selected = selectProviders('I prefer tea over coffee', providers, {
      allowTrainingRiskForS1: false,
    });
    expect(selected.length).toBe(1);
    expect(selected[0].lane).toBe('private');
  });

  it('S2 gets only private by default', () => {
    const selected = selectProviders('My salary is 12 lakh', providers, {
      allowTrainingRiskForS1: false,
    });
    expect(selected.length).toBe(1);
    expect(selected[0].lane).toBe('private');
  });

  it('S2 gets no providers when only training-risk exists', () => {
    const onlyTrainingRisk: ProviderInfo[] = [
      { id: 'gemini', lane: 'training-risk' },
    ];
    const selected = selectProviders('My salary is 12 lakh', onlyTrainingRisk, {
      allowTrainingRiskForS1: false,
    });
    expect(selected.length).toBe(0);
  });
});

// =============================================================================
// classifyWithReason — shape
// =============================================================================

describe('classifyWithReason — shape', () => {
  it('S2 result includes reasons', () => {
    const r = classifyWithReason('My salary is 12 lakh');
    expect(r.class).toBe('S2');
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.matcher).toBe('rule');
  });

  it('S0 result has empty reasons', () => {
    const r = classifyWithReason('What is 2 + 2?');
    expect(r.class).toBe('S0');
    expect(r.reasons).toEqual([]);
    expect(r.matcher).toBe('default');
  });

  it('empty input returns S0', () => {
    expect(classify('')).toBe('S0');
    expect(classify('   ')).toBe('S0');
  });

  it('privacy zone match reports matcher="zone"', () => {
    const r = classifyWithReason('Discussing project X-19', {
      privacyZones: ['x-19'],
    });
    expect(r.matcher).toBe('zone');
    expect(r.class).toBe('S2');
  });
});
// === FILE END ===