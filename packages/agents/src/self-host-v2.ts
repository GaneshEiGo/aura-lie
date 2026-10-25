// === FILE START ===
// packages/agents/src/self-host-v2.ts
// PRD §14.8 · §17.8 · §H.3 · Appendix H · F-283 · T-13.
//
// The self-host guide as data. Ten steps from §H.3, fourteen [VERIFY] checks
// from §17.8, and the exact secret names from §H.2 — all frozen as data so
// the CLI, the docs and the "Deploy your own" page can all render from one
// source of truth.
//
// `runDoctor(config)` is a deterministic, offline preflight. It never runs a
// shell command. It checks the shape of what the caller collected and returns
// errors/notes so the operator can fix problems before deployment.
//
// Zero external imports.

export interface SelfHostStep {
  id: number;
  title: string;
  description: string;
  /** A command the operator runs, or an action they take in a browser. */
  command: string;
  /** How to know this step succeeded. */
  verifyHint: string;
}

export const SELF_HOST_STEPS: readonly SelfHostStep[] = Object.freeze([
  Object.freeze({
    id: 1,
    title: 'Create the Cloudflare account',
    description: 'Sign up at dash.cloudflare.com. Add no payment method.',
    command: '(browser) create account, do not add a card',
    verifyHint: 'Billing page shows "no payment method"',
  }),
  Object.freeze({
    id: 2,
    title: 'Fork and clone the repo',
    description:
      'Fork the GitHub repo, clone it locally, install Node (version in .nvmrc) and pnpm.',
    command: 'git clone <your-fork-url> && cd aura-lie',
    verifyHint: '`node --version` and `pnpm --version` both print',
  }),
  Object.freeze({
    id: 3,
    title: 'Run the preflight doctor',
    description: 'Install dependencies and check the environment.',
    command: 'pnpm install && pnpm doctor',
    verifyHint: 'doctor exits 0 and prints "no card needed"',
  }),
  Object.freeze({
    id: 4,
    title: 'Log in to Cloudflare',
    description: 'Authorize wrangler to act on your account.',
    command: 'pnpm wrangler login',
    verifyHint: 'wrangler prints "Successfully logged in"',
  }),
  Object.freeze({
    id: 5,
    title: 'Create D1 and KV',
    description: 'Provision the database and the namespace, and write IDs to wrangler.toml.',
    command: 'pnpm cf:setup',
    verifyHint: 'wrangler.toml now contains database_id and namespace id',
  }),
  Object.freeze({
    id: 6,
    title: 'Generate and store secrets',
    description:
      'Create the master key and the VAPID keypair, then store them with wrangler secret put.',
    command: 'pnpm gen:keys && pnpm wrangler secret put MASTER_KEY',
    verifyHint: 'wrangler secret list shows MASTER_KEY and VAPID_*',
  }),
  Object.freeze({
    id: 7,
    title: 'Deploy',
    description: 'Ship the Worker. Note the workers.dev address.',
    command: 'pnpm deploy',
    verifyHint: 'You can open the workers.dev URL in a browser',
  }),
  Object.freeze({
    id: 8,
    title: 'Register a passkey',
    description:
      'Open the deployed URL on your phone and register a passkey. Aura-lie works on the Workers AI binding with zero keys.',
    command: '(browser) open URL → register passkey',
    verifyHint: 'The home page shows the wordmark and one input box',
  }),
  Object.freeze({
    id: 9,
    title: 'Install to the home screen (iPhone)',
    description:
      'On iOS, Share → Add to Home Screen. Push only works from the installed PWA.',
    command: '(browser) Share → Add to Home Screen',
    verifyHint: 'The home screen icon opens the app in standalone mode',
  }),
  Object.freeze({
    id: 10,
    title: 'Optional: add provider keys',
    description:
      'Each key you add is verified with a one-token test. Skip any provider that asks for a card.',
    command: '(browser) Settings → Models → add key',
    verifyHint: 'The test call turns green and the key is stored encrypted in D1',
  }),
]);

export interface VerifyCheck {
  id: number;
  topic: string;
  where: string;
}

export const VERIFY_CHECKS: readonly VerifyCheck[] = Object.freeze([
  Object.freeze({ id: 1, topic: 'Current free limits per model (Groq, Cerebras, Mistral, NIM, GitHub Models)', where: 'Each provider console' }),
  Object.freeze({ id: 2, topic: 'Gemini free quotas and whether grounding is free', where: 'AI Studio' }),
  Object.freeze({ id: 3, topic: 'Data-use terms per provider', where: 'Each provider terms page' }),
  Object.freeze({ id: 4, topic: 'Mistral Experiment tier: training opt-in required?', where: 'Mistral console' }),
  Object.freeze({ id: 5, topic: 'Payload-less Web Push from a Worker', where: 'Your phone, W4 spike' }),
  Object.freeze({ id: 6, topic: 'Workers AI embedding model + 768-dim output', where: 'Cloudflare docs' }),
  Object.freeze({ id: 7, topic: 'GitHub private repo free minutes', where: 'GitHub billing' }),
  Object.freeze({ id: 8, topic: 'Exa free credit amount and balance endpoint', where: 'Exa dashboard' }),
  Object.freeze({ id: 9, topic: 'Crossref polite-pool and PubMed E-utilities rules', where: 'Their docs' }),
  Object.freeze({ id: 10, topic: 'Open-Meteo terms for your use', where: 'Open-Meteo site' }),
  Object.freeze({ id: 11, topic: 'Tele-MANAS 14416 and 112 currency in India', where: 'Official sites' }),
  Object.freeze({ id: 12, topic: 'Workers Builds free minutes', where: 'Cloudflare docs' }),
  Object.freeze({ id: 13, topic: 'Durable Objects and Queues free-plan limits', where: 'Cloudflare dashboard' }),
  Object.freeze({ id: 14, topic: 'Licences of public claim-verification datasets', where: 'Dataset pages' }),
]);

export const SECRET_NAMES: readonly string[] = Object.freeze([
  'MASTER_KEY',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
  'GROQ_API_KEY',
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  'CEREBRAS_API_KEY',
  'MISTRAL_API_KEY',
  'NVIDIA_API_KEY',
  'GITHUB_MODELS_TOKEN',
  'TAVILY_API_KEY',
  'EXA_API_KEY',
  'SERPER_API_KEY',
  'TELEGRAM_BOT_TOKEN',
]);

export function validateStep(step: SelfHostStep): boolean {
  return (
    typeof step.id === 'number' &&
    Number.isInteger(step.id) &&
    step.id > 0 &&
    typeof step.title === 'string' &&
    step.title.length > 0 &&
    typeof step.description === 'string' &&
    step.description.length > 0 &&
    typeof step.command === 'string' &&
    step.command.length > 0 &&
    typeof step.verifyHint === 'string' &&
    step.verifyHint.length > 0
  );
}

export interface DoctorConfig {
  nodeVersion: string;
  pnpmVersion: string;
  hasCard: boolean;
  hasAiBinding: boolean;
  hasSecret: readonly string[];
}

export interface DoctorResult {
  ok: boolean;
  errors: string[];
  notes: string[];
}

export function runDoctor(config: DoctorConfig): DoctorResult {
  const errors: string[] = [];
  const notes: string[] = [];

  if (config.hasCard) {
    errors.push('a payment method is attached — remove it before deploying');
  }
  if (!config.hasAiBinding) {
    errors.push('the Workers AI binding is missing — the zero-key path needs it');
  }
  if (!config.hasSecret.includes('MASTER_KEY')) {
    errors.push('MASTER_KEY is not set — required for encrypted D1 secrets');
  }
  if (typeof config.nodeVersion !== 'string' || config.nodeVersion.length === 0) {
    errors.push('nodeVersion is empty — install Node (see .nvmrc)');
  }
  if (typeof config.pnpmVersion !== 'string' || config.pnpmVersion.length === 0) {
    errors.push('pnpmVersion is empty — install pnpm');
  }
  if (config.hasSecret.length === 1 && config.hasSecret[0] === 'MASTER_KEY') {
    notes.push(
      'only MASTER_KEY is set — add provider keys in Settings → Models when you want faster paths',
    );
  }

  return { ok: errors.length === 0, errors, notes };
}

export function renderStep(step: SelfHostStep): string {
  return `Step ${step.id}. ${step.title} — ${step.description} · ${step.command}`;
}

export function renderVerifyChecklist(): string {
  return VERIFY_CHECKS.map(
    (c) => `[VERIFY ${c.id}] ${c.topic} (${c.where})`,
  ).join('\n');
}
// === FILE END ===