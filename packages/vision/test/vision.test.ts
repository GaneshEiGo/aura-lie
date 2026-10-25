import { describe, it, expect, vi } from 'vitest';
import { ImagePreparer } from '../src/prep.js';
import { ImageAnalyzer } from '../src/analyzer.js';
import type { ImagePayload } from '../src/types.js';

describe('Vision Analyzer (PRD 14.2)', () => {
  const preparer = new ImagePreparer();
  const analyzer = new ImageAnalyzer();

  const mockImage: ImagePayload = {
    base64: 'data:image/png;base64,...',
    mimeType: 'image/png',
    sizeBytes: 1024 * 1024 // 1MB
  };

  it('should throw an error if image is too large', async () => {
    const largeImage = { ...mockImage, sizeBytes: 6 * 1024 * 1024 }; // 6MB
    await expect(preparer.prepare(largeImage)).rejects.toThrow('Image exceeds 5MB limit');
  });

  it('should downscale a valid image', async () => {
    const prepared = await preparer.prepare(mockImage);
    expect(prepared.sizeBytes).toBeLessThanOrEqual(mockImage.sizeBytes);
  });

  it('should refuse to analyze S2 images', async () => {
    const mockLLM = vi.fn();
    const result = await analyzer.analyze('test image', 'S2', mockLLM);
    
    expect(result.analyzed).toBe(false);
    expect(result.reason).toContain('Sensitive image');
    expect(mockLLM).not.toHaveBeenCalled();
  });

  it('should analyze S0 images using the LLM', async () => {
    const mockLLM = vi.fn().mockResolvedValue('A chart showing battery efficiency at 41%.');
    const result = await analyzer.analyze('battery chart', 'S0', mockLLM);
    
    expect(result.analyzed).toBe(true);
    expect(result.text).toContain('41%');
    expect(mockLLM).toHaveBeenCalledTimes(1);
  });
});