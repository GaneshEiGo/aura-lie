/**
 * PRD Section 13.9: Import scan (T-30).
 * Ensures no local-model runtimes, WASM runtimes, or container tooling are imported.
 */
export class ImportScanner {
  private readonly BLOCKED_PACKAGES = [
    'ollama',
    'llama.cpp',
    'webllm',
    'transformers.js',
    'tensorflow',
    '@tensorflow/tfjs',
    'onnxruntime',
    'onnxruntime-node',
    'wasm',
    'pyodide',
    'webcontainer',
    'dockerode'
  ];

  public scanDependencies(packageJson: any): { passed: boolean, violations: string[] } {
    const violations: string[] = [];
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies
    };

    for (const dep of Object.keys(allDeps)) {
      if (this.BLOCKED_PACKAGES.some(blocked => dep.includes(blocked))) {
        violations.push(`Blocked local-compute dependency found: ${dep}`);
      }
    }

    return {
      passed: violations.length === 0,
      violations
    };
  }
}