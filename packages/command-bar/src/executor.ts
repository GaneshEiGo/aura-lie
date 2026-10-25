import type { CommandItem } from './types.js';
import { CommandRegistry } from './registry.js';

export class CommandExecutor {
  constructor(private registry: CommandRegistry) {}

  public async execute(commandId: string): Promise<boolean> {
    const cmd = this.registry.findById(commandId);
    if (!cmd) return false;

    try {
      await cmd.action();
      return true;
    } catch (err) {
      console.error(`Failed to execute command ${commandId}:`, err);
      return false;
    }
  }
}