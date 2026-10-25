// packages/marketplace/src/installer.ts
// PRD 10.9 + L7: installers must ask first, log every action,
// and refuse anything the validator rejects.

import type {
  InstallOptions,
  InstallResult,
  MarketplaceItem,
} from './types.js';
import { MarketplaceValidator } from './validator.js';

export class MarketplaceInstaller {
  private readonly validator: MarketplaceValidator;
  private readonly installed = new Set<string>();

  constructor(validator?: MarketplaceValidator) {
    this.validator = validator ?? new MarketplaceValidator();
  }

  install(item: MarketplaceItem, _options?: InstallOptions): InstallResult {
    if (this.installed.has(item.id)) {
      return {
        installed: false,
        reason: 'Already installed',
        itemId: item.id,
      };
    }

    const review = this.validator.review(item);
    if (!review.approved) {
      return {
        installed: false,
        reason: `Review rejected: ${review.errors.join('; ')}`,
        itemId: item.id,
      };
    }

    // L7: user must approve the item before install.
    if (!item.approved) {
      return {
        installed: false,
        reason:
          'Item is pending user approval (set item.approved = true after review)',
        itemId: item.id,
      };
    }

    this.installed.add(item.id);
    return { installed: true, itemId: item.id };
  }

  uninstall(id: string): boolean {
    return this.installed.delete(id);
  }

  isInstalled(id: string): boolean {
    return this.installed.has(id);
  }

  listInstalled(): string[] {
    return Array.from(this.installed);
  }
}