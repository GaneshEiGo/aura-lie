import type { ImagePayload } from './types.js';

export class ImagePreparer {
  private readonly MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
  private readonly TARGET_RESOLUTION = 1.5; // Megapixels

  public async prepare(payload: ImagePayload): Promise<ImagePayload> {
    if (payload.sizeBytes > this.MAX_SIZE_BYTES) {
      throw new Error('Image exceeds 5MB limit');
    }

    // In a real implementation, this would use the Canvas API to downscale.
    // We simulate the downscaling here.
    return {
      ...payload,
      sizeBytes: Math.min(payload.sizeBytes, this.TARGET_RESOLUTION * 1024 * 1024)
    };
  }
}