/**
 * Scans user input for accidentally pasted API keys and masks them before they leave the device.
 */
export function maskInputSecrets(text: string): { maskedText: string; hasSecrets: boolean } {
  let maskedText = text;
  let hasSecrets = false;

  const patterns = [
    { regex: /(?:sk|pk)_(?:live|test)_[0-9a-zA-Z]{24,}/g, replace: '[REDACTED_API_KEY]' },
    { regex: /AIza[0-9A-Za-z-_]{35}/g, replace: '[REDACTED_GOOGLE_KEY]' },
    { regex: /gsk_[0-9a-zA-Z]{48}/g, replace: '[REDACTED_GROQ_KEY]' },
    { regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, replace: '[REDACTED_PRIVATE_KEY]' }
  ];

  for (const p of patterns) {
    if (p.regex.test(text)) {
      hasSecrets = true;
      maskedText = maskedText.replace(p.regex, p.replace);
    }
  }

  return { maskedText, hasSecrets };
}