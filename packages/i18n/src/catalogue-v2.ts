// === FILE START ===
// packages/i18n/src/catalogue-v2.ts
// PRD §6.9 · §2.8 · FR-I18N-01.
//
// Message catalogues for English and Hindi. Every UI string lives here —
// never hard-coded in components. Type-safe lookup via `t()`.
//
// Key conventions:
//   · dotted namespaces (home.*, thought.*, quota.*, …)
//   · {name} placeholders substituted via `t(key, locale, params)`
//   · every key in `en` MUST have a matching key in `hi`
//   · every value in `hi` MUST be non-empty
//
// File naming: `-v2` suffix avoids collisions with any pre-existing file.

export type Locale = 'en' | 'hi';

export type CatalogueEntry = Readonly<Record<string, string>>;

export interface Catalogue {
  readonly en: CatalogueEntry;
  readonly hi: CatalogueEntry;
}

export const CATALOGUE: Catalogue = Object.freeze({
  en: Object.freeze({
    // Home / first run
    'home.headline': 'What are we solving?',
    'home.firstRun': 'Works right now. No setup needed.',
    'home.greeting': 'Hello. I show my work.',
    'home.placeholder': 'Ask anything…',

    // Chat / answer
    'chat.placeholder': 'Ask Aura-lie…',
    'chat.mode.instant': 'Instant',
    'chat.mode.think': 'Think',
    'chat.mode.research': 'Research',
    'chat.mode.council': 'Council',
    'chat.tldrBanner': 'In one line: {summary}',

    // Thinking
    'thought.line': 'Thought for {seconds} s · {sources} sources · {checks} checks',
    'thought.noReasoning':
      'No reasoning stream from this model. The Summary shows what Aura-lie actually did.',

    // Fact pill / drawer
    'fact.verified': 'Verified',
    'fact.supported': 'Supported',
    'fact.mixed': 'Mixed',
    'fact.weak': 'Weak',
    'fact.conflicted': 'Conflicted',
    'fact.unverified': "I couldn't find a source for this. It's from my own recall.",
    'fact.recallOnly': "I didn't check this one. Search quota is low. Verify later?",
    'fact.quoteRejected': "I dropped a citation because the quote wasn't in the page.",

    // Quota / core mode / offline
    'quota.low': "The fast model is nearly used up today. I'll switch to the next one.",
    'quota.coreMode':
      "Cloud models are resting until {resetTime}. I can still search your notes, calculate and set reminders, and I'll answer when they're back.",
    'offline.body': "No internet. Showing what's on this device.",
    'promise.queued': "Queued. I'll answer when the models reset (about {hours} h) and tell you.",

    // Memory
    'memory.used': 'Used {count} memory from {date}. View · Edit · Forget',

    // Sensitive content
    'sensitive.image': 'Sensitive image. Not analysed, by design.',

    // Proactive / autonomy
    'proactive.consent': 'Want me to text first? Pick how often. You can pause me with one tap.',
    'proactive.dismiss': 'Not useful · Never about this',
    'autonomy.paused': 'Autonomy paused. Nothing will run in the background. Resume',
    'approval.body': 'Aura-lie wants to create {count} files. Approve · Review · Reject',

    // Cost / receipt
    'cost.receipt': '₹0.00 this month · 0 rupees, ever',

    // Identity (HR-04 — never pretend to be human)
    'identity.human': "No. I'm Aura-lie, an AI. I'm built to sound natural, not to pretend.",

    // Data ownership
    'wipe.body':
      "This erases everything on this device and your server copy. It can't be undone. Wipe",
    'backup.reminder': "It's been {days} days since your last backup. Export now?",

    // Council
    'council.simulated': 'Simulated dissent (single model). Not independent.',
    'council.retry': 'Run again on a different model family?',

    // Privacy ledger
    'privacy.ledger':
      'Sent to {group}: your question and {memories} memory ({bytes} bytes). Nothing else left this device.',

    // Onboarding
    'install.ios':
      'Tap Share, then Add to Home Screen. Notifications only work from the installed app.',

    // Verification
    'verify.later': 'Checked {checked} of {total} claims. Search quota is low.',
  }),
  hi: Object.freeze({
    // Home / first run
    'home.headline': 'हम क्या हल कर रहे हैं?',
    'home.firstRun': 'अभी काम करता है। कोई सेटअप ज़रूरी नहीं।',
    'home.greeting': 'नमस्ते। मैं अपना काम दिखाता हूँ।',
    'home.placeholder': 'कुछ भी पूछें…',

    // Chat / answer
    'chat.placeholder': 'Aura-lie से पूछें…',
    'chat.mode.instant': 'तुरंत',
    'chat.mode.think': 'सोचें',
    'chat.mode.research': 'शोध',
    'chat.mode.council': 'परिषद',
    'chat.tldrBanner': 'एक पंक्ति में: {summary}',

    // Thinking
    'thought.line': '{seconds} सेकंड सोचा · {sources} स्रोत · {checks} जाँच',
    'thought.noReasoning':
      'इस मॉडल से कोई तर्क स्ट्रीम नहीं आई। सारांश दिखाता है कि Aura-lie ने वास्तव में क्या किया।',

    // Fact pill / drawer
    'fact.verified': 'सत्यापित',
    'fact.supported': 'समर्थित',
    'fact.mixed': 'मिश्रित',
    'fact.weak': 'कमज़ोर',
    'fact.conflicted': 'विरोधाभासी',
    'fact.unverified': 'मुझे इसका स्रोत नहीं मिला। यह मेरी अपनी याद से है।',
    'fact.recallOnly': 'मैंने इसे नहीं जाँचा। खोज कोटा कम है। बाद में सत्यापित करें?',
    'fact.quoteRejected': 'मैंने एक उद्धरण हटा दिया क्योंकि वह पृष्ठ में नहीं था।',

    // Quota / core mode / offline
    'quota.low': 'तेज़ मॉडल आज लगभग खत्म हो गया है। मैं अगले पर स्विच करूँगा।',
    'quota.coreMode':
      'क्लाउड मॉडल {resetTime} तक विश्राम कर रहे हैं। मैं अभी भी आपके नोट्स खोज सकता हूँ, गणना कर सकता हूँ और रिमाइंडर सेट कर सकता हूँ, और जब वे वापस आएँगे तो जवाब दूँगा।',
    'offline.body': 'इंटरनेट नहीं है। इस डिवाइस पर जो है वह दिखा रहा हूँ।',
    'promise.queued':
      'कतार में। मॉडल रीसेट होने पर (लगभग {hours} घंटे) मैं जवाब दूँगा और आपको बताऊँगा।',

    // Memory
    'memory.used': '{date} की {count} याददाश्त उपयोग हुई। देखें · संपादित करें · भूलें',

    // Sensitive content
    'sensitive.image': 'संवेदनशील छवि। डिज़ाइन द्वारा विश्लेषण नहीं किया गया।',

    // Proactive / autonomy
    'proactive.consent': 'क्या आप चाहते हैं कि मैं पहले संदेश भेजूँ? कितनी बार चुनें। आप एक टैप से मुझे रोक सकते हैं।',
    'proactive.dismiss': 'उपयोगी नहीं · इसके बारे में कभी नहीं',
    'autonomy.paused': 'स्वायत्तता रुकी हुई। पृष्ठभूमि में कुछ नहीं चलेगा। फिर शुरू करें',
    'approval.body': 'Aura-lie {count} फ़ाइलें बनाना चाहता है। स्वीकृत करें · समीक्षा करें · अस्वीकार करें',

    // Cost / receipt
    'cost.receipt': 'इस महीने ₹0.00 · कभी भी 0 रुपये',

    // Identity
    'identity.human': 'नहीं। मैं Aura-lie हूँ, एक AI। मैं स्वाभाविक सुनने के लिए बना हूँ, नक़ल करने के लिए नहीं।',

    // Data ownership
    'wipe.body':
      'यह इस डिवाइस और आपकी सर्वर कॉपी पर सब कुछ मिटा देगा। इसे पूर्ववत नहीं किया जा सकता। मिटाएँ',
    'backup.reminder': 'आपके अंतिम बैकअप से {days} दिन हो गए हैं। अभी निर्यात करें?',

    // Council
    'council.simulated': 'नकली मतभेद (एकल मॉडल)। स्वतंत्र नहीं।',
    'council.retry': 'एक अलग मॉडल परिवार पर दोबारा चलाएँ?',

    // Privacy ledger
    'privacy.ledger':
      '{group} को भेजा गया: आपका प्रश्न और {memories} याददाश्त ({bytes} बाइट)। इस डिवाइस से और कुछ नहीं गया।',

    // Onboarding
    'install.ios':
      'Share टैप करें, फिर Add to Home Screen। सूचनाएँ केवल इंस्टॉल किए गए ऐप से काम करती हैं।',

    // Verification
    'verify.later': '{total} में से {checked} दावे जाँचे गए। खोज कोटा कम है।',
  }),
} as const);

export type MessageKey = keyof typeof CATALOGUE.en;

/** Substitute {name} placeholders. */
export function interpolate(
  template: string,
  params: Record<string, string | number> = {},
): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, name: string) => {
    const v = params[name];
    if (v === undefined || v === null) return `{${name}}`;
    return String(v);
  });
}

/**
 * Look up a message. Falls back to English when the requested locale is
 * missing the key, then falls back to the key itself (visible in UI so
 * missing strings are impossible to miss during review).
 */
export function t(
  key: MessageKey,
  locale: Locale = 'en',
  params: Record<string, string | number> = {},
): string {
  const primary = CATALOGUE[locale]?.[key];
  if (typeof primary === 'string' && primary.length > 0) {
    return interpolate(primary, params);
  }
  const fallback = CATALOGUE.en[key];
  if (typeof fallback === 'string' && fallback.length > 0) {
    return interpolate(fallback, params);
  }
  return String(key);
}

/** Keys present in `en` but missing from `hi`. Used by tests to catch drift. */
export function missingFromHindi(): string[] {
  const enKeys = Object.keys(CATALOGUE.en);
  return enKeys.filter((k) => !(k in CATALOGUE.hi));
}

/** Keys present in `hi` but missing from `en`. Used by tests to catch drift. */
export function extraInHindi(): string[] {
  const hiKeys = Object.keys(CATALOGUE.hi);
  return hiKeys.filter((k) => !(k in CATALOGUE.en));
}

/** All keys in the English catalogue (the canonical set). */
export function allKeys(): MessageKey[] {
  return Object.keys(CATALOGUE.en) as MessageKey[];
}
// === FILE END ===