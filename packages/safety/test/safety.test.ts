import { describe, it, expect } from 'vitest';
import { ImportScanner } from '../src/import-scanner.js';
import { BudgetMonitor } from '../src/budget-monitor.js';

describe('Laptop Safety (PRD 13.9, L2)', () => {
  it('should block local-compute dependencies', () => {
    const scanner = new ImportScanner();
    const pkgJson = {
      dependencies: {
        'react': '^18.0.0',
        'ollama': '^0.1.0'
      }
    };

    const result = scanner.scanDependencies(pkgJson);
    expect(result.passed).toBe(false);
    expect(result.violations[0]).toContain('ollama');
  });

  it('should pass for safe dependencies', () => {
    const scanner = new ImportScanner();
    const pkgJson = {
      dependencies: {
        'react': '^18.0.0',
        'hono': '^4.0.0'
      }
    };

    const result = scanner.scanDependencies(pkgJson);
    expect(result.passed).toBe(true);
    expect(result.violations.length).toBe(0);
  });

  it('should monitor memory budget', () => {
    const monitor = new BudgetMonitor();
    expect(monitor.checkMemoryUsage(100).withinBudget).toBe(true);
    expect(monitor.checkMemoryUsage(200).withinBudget).toBe(false);
  });

  it('should monitor CPU budget', () => {
    const monitor = new BudgetMonitor();
    expect(monitor.checkCpuUsage(0.5).withinBudget).toBe(true);
    expect(monitor.checkCpuUsage(2.0).withinBudget).toBe(false);
  });
});