import { CostGuardViolation } from './types.js';

/**
 * The ONLY hosts Aura-lie is allowed to talk to.
 * If a host is not here, it throws a CostGuardViolation.
 * This guarantees Layer 1 of the Zero Rupee Law.
 */
const ALLOWED_HOSTS = new Set([
  'api.groq.com',
  'generativelanguage.googleapis.com',
  'api.cloudflare.com',
  'api.cerebras.ai',
  'api.mistral.ai',
  'integrate.api.nvidia.com',
  'models.inference.ai.azure.com', // GitHub Models
  'api.openrouter.ai',
  'api.tavily.com',
  'api.exa.ai',
  'google.serper.dev',
  'r.jina.ai',
  'en.wikipedia.org',
  'www.wikidata.org',
  'export.arxiv.org',
  'api.crossref.org',
  'eutils.ncbi.nlm.nih.gov',
  'api.open-meteo.com'
]);

/**
 * Deny-listed terms in URLs that indicate billing/upgrade paths.
 * Even on an allowed host, we block these paths to be absolutely safe.
 */
const DENIED_PATHS = [
  '/billing',
  '/upgrade',
  '/checkout',
  '/payment',
  '/subscribe'
];

export function validateEgress(urlString: string): void {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new CostGuardViolation('Invalid URL format');
  }

  if (url.protocol !== 'https:') {
    throw new CostGuardViolation('Only HTTPS is allowed');
  }

  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new CostGuardViolation(url.hostname);
  }

  const lowerPath = url.pathname.toLowerCase();
  for (const denied of DENIED_PATHS) {
    if (lowerPath.includes(denied)) {
      throw new CostGuardViolation(url.hostname + url.pathname);
    }
  }
}

/**
 * The Single Guarded Fetch Wrapper. 
 * Every outbound request in the Worker MUST use this.
 */
export async function guardedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  
  validateEgress(url);

  // Execute the fetch
  return fetch(input, init);
}