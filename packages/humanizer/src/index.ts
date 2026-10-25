export * from './filler.js';
export * from './identity.js';
export * from './emoji.js';
export * from './styles.js';

import { stripFiller } from './filler.js';
import { enforceIdentity } from './identity.js';
import { enforceEmojiLimit } from './emoji.js';
import { applyStyle, type StyleMode } from './styles.js';

export function humanize(query: string, rawResponse: string, style: StyleMode = 'default'): string {
  const identityChecked = enforceIdentity(query, rawResponse);
  if (identityChecked !== rawResponse) return identityChecked;

  let cleaned = stripFiller(rawResponse);
  cleaned = enforceEmojiLimit(cleaned, 1);
  cleaned = applyStyle(cleaned, style);

  return cleaned.trim();
}