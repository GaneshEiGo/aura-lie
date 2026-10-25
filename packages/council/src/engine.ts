import type { CouncilMember, CouncilDraft, CouncilResult } from './types.js';

/**
 * PRD Section 7.9: Council, debate, challenge, second opinion.
 * Handles independent drafts from multiple families and honest dissent tracking.
 */
export class CouncilEngine {
  public async run(
    question: string,
    members: CouncilMember[],
    llmCaller: (prompt: string, modelId: string) => Promise<string>
  ): Promise<CouncilResult> {
    // 1. Get independent drafts
    const drafts = await Promise.all(members.map(async (member) => {
      const prompt = `You are ${member.name} (${member.role}). Answer the following question independently. Provide a vote (yes/no/abstain) and your reasoning. Question: ${question}`;
      const response = await llmCaller(prompt, member.modelId);
      
      // Simulate parsing the vote from the response
      const vote = response.toLowerCase().includes('yes') ? 'yes' : (response.toLowerCase().includes('no') ? 'no' : 'abstain');
      
      return {
        memberId: member.id,
        content: response,
        vote,
        reasoning: `Response from ${member.modelId}` // Mock
      } as CouncilDraft;
    }));

    // 2. Check for independent families (e.g., "groq/llama", "gemini/pro" -> "groq", "gemini")
    const families = new Set(members.map(m => m.modelId.split('-')[0]));
    const isSimulated = families.size < 2;

    // 3. Synthesize the final answer
    const synthesisPrompt = `Synthesize the following drafts into a final answer, highlighting any dissent:\n\n${drafts.map(d => `${d.memberId}: ${d.content}`).join('\n\n')}`;
    const synthesis = await llmCaller(synthesisPrompt, members[0].modelId);

    // 4. Calculate dissent
    const dissentCount = drafts.filter(d => d.vote === 'no').length;

    return {
      drafts,
      synthesis,
      dissentCount,
      isSimulated
    };
  }
}