import type { Sensitivity, AnalysisResult } from './types.js';

/**
 * PRD Section 14.2: Vision and files.
 * Enforces the privacy gate: S2 images are never sent to external models.
 */
export class ImageAnalyzer {
  public async analyze(
    imageDescription: string, 
    sensitivity: Sensitivity, 
    llmCaller: (prompt: string) => Promise<string>
  ): Promise<AnalysisResult> {
    
    // 1. Privacy Gate (Law L7)
    if (sensitivity === 'S2') {
      return {
        analyzed: false,
        reason: 'Sensitive image. Not analyzed, by design.'
      };
    }

    // 2. Analyze (S0 or S1)
    const prompt = `Analyze the following image and provide a detailed description. Image context: ${imageDescription}`;
    
    try {
      const result = await llmCaller(prompt);
      return {
        analyzed: true,
        text: result
      };
    } catch (err: any) {
      return {
        analyzed: false,
        reason: `Analysis failed: ${err.message}`
      };
    }
  }
}