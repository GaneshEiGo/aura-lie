/**
 * Normalizes text for quote matching.
 * Strips extra spaces, handles case insensitivity.
 */
export function normalizeText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * PRD §8.4: The quote-span check.
 * A quote is accepted ONLY if it is a substring of the fetched page text.
 * Quotes are capped at 25 words.
 */
export function isQuoteValid(quote: string, pageText: string): boolean {
  if (!quote || !pageText) return false;

  // 1. Enforce max 25 words limit
  const wordCount = quote.trim().split(/\s+/).length;
  if (wordCount > 25) return false;

  // 2. Check substring existence in normalized text
  const normalizedQuote = normalizeText(quote);
  const normalizedPage = normalizeText(pageText);

  return normalizedPage.includes(normalizedQuote);
}