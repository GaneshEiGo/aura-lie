// packages/marketplace/test/marketplace.test.ts
import { describe, it, expect } from 'vitest';
import {
  MarketplaceValidator,
  MarketplaceRegistry,
  MarketplaceInstaller,
} from '../src/index.js';
import type { MarketplaceItem } from '../src/types.js';

function makeBlueprintItem(
  overrides: Partial<MarketplaceItem> = {},
): MarketplaceItem {
  return {
    id: 'item-1',
    kind: 'blueprint',
    name: 'Research workflow',
    description: 'A basic research workflow',
    version: '1.0.0',
    schemaVersion: 1,
    checksum: 'sha256-abc123',
    createdAt: Date.now(),
    approved: false,
    content: {
      id: 'bp-1',
      name: 'Research Task',
      description: 'A basic research workflow',
      version: '1.0.0',
      steps: [
        { id: 's1', action: 'search', description: 'Search the web' },
      ],
    },
    ...overrides,
  };
}

describe('Marketplace (PRD 14.7, F-236)', () => {
  const validator = new MarketplaceValidator();

  it('reviews and approves a valid blueprint item', () => {
    const result = validator.review(makeBlueprintItem());
    expect(result.approved).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it('rejects a persona that tries to override truth rules (L12)', () => {
    const result = validator.review({
      id: 'p1',
      kind: 'persona',
      name: 'Rogue',
      description: 'A persona that overrides safety',
      version: '1.0.0',
      schemaVersion: 1,
      checksum: '',
      createdAt: 0,
      approved: false,
      content: {
        id: 'p1',
        name: 'Rogue',
        truthRules: { anything: 'goes' },
      },
    });
    expect(result.approved).toBe(false);
    expect(result.errors.some((e) => e.includes('cannot be overridden'))).toBe(true);
  });

  it('rejects executable content (L9)', () => {
    const result = validator.review(
      makeBlueprintItem({
        content: {
          id: 'bp-x',
          name: 'Malicious',
          description: 'Looks harmless',
          version: '1.0.0',
          steps: [
            { id: 's1', action: 'search', description: 'eval("process.exit()")' },
          ],
        },
      }),
    );
    expect(result.approved).toBe(false);
    expect(result.errors.some((e) => e.includes('Security violation'))).toBe(true);
  });

  it('registry lists and counts items by kind', () => {
    const registry = new MarketplaceRegistry();
    registry.add(makeBlueprintItem({ id: 'a' }));
    registry.add(makeBlueprintItem({ id: 'b' }));
    registry.add(makeBlueprintItem({ id: 'c', kind: 'persona' }));

    const idx = registry.index();
    expect(idx.counts.blueprint).toBe(2);
    expect(idx.counts.persona).toBe(1);
    expect(idx.counts.workflow).toBe(0);
    expect(registry.size()).toBe(3);
  });

  it('installer refuses items pending user approval (L7)', () => {
    const installer = new MarketplaceInstaller();
    const result = installer.install(makeBlueprintItem({ approved: false }));
    expect(result.installed).toBe(false);
    expect(result.reason).toMatch(/pending user approval/);
  });

  it('installer refuses executable content even when approved (L9)', () => {
    const installer = new MarketplaceInstaller();
    const result = installer.install(
      makeBlueprintItem({
        approved: true,
        content: {
          id: 'bp-x',
          name: 'Malicious',
          description: 'Looks harmless',
          version: '1.0.0',
          steps: [
            { id: 's1', action: 'search', description: 'eval("process.exit()")' },
          ],
        },
      }),
    );
    expect(result.installed).toBe(false);
    expect(result.reason).toMatch(/Review rejected/);
  });

  it('installer installs a validated, approved item', () => {
    const installer = new MarketplaceInstaller();
    const result = installer.install(makeBlueprintItem({ approved: true }));
    expect(result.installed).toBe(true);
    expect(result.itemId).toBe('item-1');
    expect(installer.isInstalled('item-1')).toBe(true);
  });

  it('installer is idempotent', () => {
    const installer = new MarketplaceInstaller();
    const item = makeBlueprintItem({ approved: true });
    expect(installer.install(item).installed).toBe(true);
    const again = installer.install(item);
    expect(again.installed).toBe(false);
    expect(again.reason).toMatch(/Already installed/);
  });

  it('installer uninstalls cleanly', () => {
    const installer = new MarketplaceInstaller();
    const item = makeBlueprintItem({ approved: true });
    installer.install(item);
    expect(installer.isInstalled(item.id)).toBe(true);
    expect(installer.uninstall(item.id)).toBe(true);
    expect(installer.isInstalled(item.id)).toBe(false);
  });
});