import { SecurityError } from './types.js';

/**
 * Prevents SSRF (Server-Side Request Forgery) by blocking private IP ranges, 
 * localhost, and cloud metadata endpoints (like 169.254.169.254).
 */
export function isSafeUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    
    // 1. Must be HTTPS
    if (url.protocol !== 'https:') return false;

    const hostname = url.hostname.toLowerCase();

    // 2. Block localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return false;

    // 3. Block metadata endpoints
    if (hostname === '169.254.169.254') return false;

    // 4. Block private IP ranges (naive regex check, but effective for basic strings)
    if (/^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/.test(hostname)) return false;

    // 5. Block cloud metadata domains
    if (hostname.includes('metadata.google.internal') || hostname.includes('instance-data')) return false;

    return true;
  } catch {
    return false;
  }
}

export function assertSafeUrl(urlString: string): void {
  if (!isSafeUrl(urlString)) {
    throw new SecurityError('SSRF_BLOCKED', `Blocked unsafe URL: ${urlString}`);
  }
}