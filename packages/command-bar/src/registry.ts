import type { CommandItem } from './types.js';

export class CommandRegistry {
  private commands: CommandItem[] = [];

  public register(command: CommandItem): void {
    this.commands.push(command);
  }

  public getAll(): CommandItem[] {
    return this.commands;
  }

  public findById(id: string): CommandItem | undefined {
    return this.commands.find(c => c.id === id);
  }
}