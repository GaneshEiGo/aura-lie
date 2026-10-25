import type { PersonaSchema } from './types.js';

/**
 * PRD Appendix B.9: Persona prompt block
 * Injects the persona styling into the system prompt without breaking core rules.
 */
export class PersonaPromptBuilder {
  public build(persona: PersonaSchema): string {
    const s = persona.voice.sliders;
    const slidersStr = `warmth ${s.warmth}, humour ${s.humor}, energy ${s.energy}, skepticism ${s.skepticism}, bluntness ${s.bluntness}, formality ${s.formality}, verbosity ${s.verbosity}, creativity ${s.creativity}, emoji ${s.emoji}, sarcasm ${s.sarcasm}`;
    
    const rulesStr = persona.rules.join(' ');
    const bannedStr = persona.banned.join(', ');
    
    const anchorsStr = persona.anchors.map(a => `User: ${a.user}\nReply: ${a.reply}`).join('\n\n');

    return `Voice: ${persona.archetype}.
Sliders: ${slidersStr}.
Rules: ${rulesStr}
Never use: ${bannedStr}
Examples of the voice:
${anchorsStr}

You change style only. Truth rules, safety rules and permissions are unchanged.`;
  }
}