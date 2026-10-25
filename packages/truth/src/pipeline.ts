import { SearchBroker, PageFetcher } from '@aura-lie/search';
import { ClaimExtractor, QuoteSpanVerifier, EntailmentJudge } from '@aura-lie/claim-verify';
import { scoreClaim, summarizeResponse } from './score.js';
import type { VerificationReport, ClaimVerificationResult } from './types.js';

export type LLMCaller = (prompt: string) => Promise<string>;

export class TruthPipeline {
  private extractor = new ClaimExtractor();
  private verifier = new QuoteSpanVerifier();
  private judge = new EntailmentJudge();
  private broker = new SearchBroker();
  private fetcher = new PageFetcher();

  constructor(private llmCaller: LLMCaller) {}

  public async verifyAnswer(answer: string, maxClaims: number = 3): Promise<VerificationReport> {
    const extractPrompt = this.extractor.buildPrompt(answer, maxClaims);
    const extractResponse = await this.llmCaller(extractPrompt);
    const claims = this.extractor.parseResponse(extractResponse);

    if (claims.length === 0) {
      return { overallScore: null, chip: 'RECALL-ONLY', claims: [], checkedCount: 0, checkableCount: 0 };
    }

    const results: ClaimVerificationResult[] = [];

    for (const claim of claims) {
      const claimId = crypto.randomUUID();
      
      try {
        const searchResults = await this.broker.search(claim.text);
        if (searchResults.length === 0) {
          results.push({ claimId, claimText: claim.text, status: 'UNVERIFIED', score: null, quoteMatched: false });
          continue;
        }

        const topSource = searchResults[0];
        const page = await this.fetcher.fetch(topSource.url);

        const judgePrompt = this.judge.buildPrompt(claim.text, page.text);
        const judgeResponse = await this.llmCaller(judgePrompt);
        const judgeResult = this.judge.parseResponse(judgeResponse);

        let quoteMatched = false;
        let entailmentScore = 0;
        
        if (judgeResult.stance === 'supports') entailmentScore = 100;
        else if (judgeResult.stance === 'contradicts') entailmentScore = 0;
        else entailmentScore = 30;

        if (judgeResult.span) {
          const spanCheck = this.verifier.verify(judgeResult.span, page.text);
          quoteMatched = spanCheck.verified;
        }

        // PRD Law L3: Quote match is mandatory for score.
        // If span fails, we cap at 40.
        const scored = scoreClaim({
          factors: { S: topSource.tier === 1 ? 100 : 75, E: entailmentScore, A: 100, F: 100 },
          quoteMatchFailed: !quoteMatched,
          contradictionPenalty: judgeResult.stance === 'contradicts' ? 15 : 0
        });

        results.push({
          claimId,
          claimText: claim.text,
          status: scored.status,
          score: scored.score,
          quoteMatched,
          sourceUrl: topSource.url
        });

      } catch (err) {
        results.push({ claimId, claimText: claim.text, status: 'UNVERIFIED', score: null, quoteMatched: false });
      }
    }

    const summary = summarizeResponse(results, claims.length);
    const checked = results.filter(r => r.score !== null).length;

    return { overallScore: summary.overall, chip: summary.chip, claims: results, checkedCount: checked, checkableCount: claims.length };
  }
}