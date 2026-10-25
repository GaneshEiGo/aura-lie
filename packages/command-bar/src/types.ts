export type CommandCategory = 'Ask' | 'Modes' | 'Verify' | 'Go to' | 'Personas' | 'Appearance' | 'System' | 'Data';

export interface CommandItem {
  id: string;
  category: CommandCategory;
  label: string;
  action: () => void | Promise<void>;
}

export interface CommandResult {
  item: CommandItem;
  score: number;
}