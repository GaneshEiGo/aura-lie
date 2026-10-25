// === FILE START ===
// packages/agents/src/cli-v2.ts
// PRD §14.6 · FR-DEV-05 · T-13.
//
// The Aura-lie CLI. `parseCli(argv)` turns a token vector into a typed command.
// `renderHelp()` produces the deterministic help text. `renderCommand()`
// produces the exact HTTP call the command resolves to — the CLI is a thin
// wrapper over the same REST contract the SDK uses, so there is one source of
// truth.
//
// Supported commands:
//   aura health
//   aura chat <message>
//   aura verify <claimId>
//   aura memory list
//   aura memory add <text>
//   aura memory forget <id>
//   aura quota
//   aura receipt
//   aura mission create <goal>
//   aura mission get <id>
//   aura help
//   aura version
//
// Only relative imports (from the sibling rest-api-v2 module).

import type { HttpMethod } from './rest-api-v2.js';
import { matchRoute } from './rest-api-v2.js';

export type CliCommandName =
  | 'health'
  | 'chat'
  | 'verify'
  | 'memory-list'
  | 'memory-add'
  | 'memory-forget'
  | 'quota'
  | 'receipt'
  | 'mission-create'
  | 'mission-get'
  | 'help'
  | 'version';

export interface CliCommand {
  name: CliCommandName;
  args: string[];
}

export interface CliResolution {
  method: HttpMethod;
  path: string;
  body: unknown;
  auth: 'public' | 'bearer';
}

export const VERSION = '1.0.0';

export function parseCli(argv: readonly string[]): CliCommand {
  if (argv.length === 0) return { name: 'help', args: [] };
  const head = argv[0]!;
  const rest = argv.slice(1);

  switch (head) {
    case 'health':
      return { name: 'health', args: [] };
    case 'chat':
      if (rest.length === 0) throw new Error('chat: message required');
      return { name: 'chat', args: [rest.join(' ')] };
    case 'verify':
      if (rest.length === 0) throw new Error('verify: claimId required');
      return { name: 'verify', args: [rest[0]!] };
    case 'quota':
      return { name: 'quota', args: [] };
    case 'receipt':
      return { name: 'receipt', args: [] };
    case 'help':
      return { name: 'help', args: [] };
    case 'version':
      return { name: 'version', args: [] };
    case 'memory': {
      const sub = rest[0];
      if (sub === 'list') return { name: 'memory-list', args: [] };
      if (sub === 'add') {
        if (rest.length < 2) throw new Error('memory add: text required');
        return { name: 'memory-add', args: [rest.slice(1).join(' ')] };
      }
      if (sub === 'forget') {
        if (rest.length < 2) throw new Error('memory forget: id required');
        return { name: 'memory-forget', args: [rest[1]!] };
      }
      throw new Error(`memory: unknown subcommand "${sub ?? ''}"`);
    }
    case 'mission': {
      const sub = rest[0];
      if (sub === 'create') {
        if (rest.length < 2) throw new Error('mission create: goal required');
        return { name: 'mission-create', args: [rest.slice(1).join(' ')] };
      }
      if (sub === 'get') {
        if (rest.length < 2) throw new Error('mission get: id required');
        return { name: 'mission-get', args: [rest[1]!] };
      }
      throw new Error(`mission: unknown subcommand "${sub ?? ''}"`);
    }
    default:
      throw new Error(`unknown command "${head}"`);
  }
}

export function resolveCli(cmd: CliCommand): CliResolution {
  switch (cmd.name) {
    case 'health':
      return { method: 'GET', path: '/health', body: null, auth: 'public' };
    case 'chat':
      return {
        method: 'POST',
        path: '/v1/chat',
        body: { message: cmd.args[0]! },
        auth: 'bearer',
      };
    case 'verify':
      return {
        method: 'POST',
        path: '/v1/verify',
        body: { claimId: cmd.args[0]! },
        auth: 'bearer',
      };
    case 'memory-list':
      return { method: 'GET', path: '/v1/memory', body: null, auth: 'bearer' };
    case 'memory-add':
      return {
        method: 'POST',
        path: '/v1/memory',
        body: { text: cmd.args[0]!, sensitivity: 'S0' },
        auth: 'bearer',
      };
    case 'memory-forget':
      return {
        method: 'DELETE',
        path: `/v1/memory/${cmd.args[0]!}`,
        body: null,
        auth: 'bearer',
      };
    case 'quota':
      return { method: 'GET', path: '/v1/quota', body: null, auth: 'bearer' };
    case 'receipt':
      return { method: 'GET', path: '/v1/receipt', body: null, auth: 'bearer' };
    case 'mission-create':
      return {
        method: 'POST',
        path: '/v1/missions',
        body: { goal: cmd.args[0]!, tasks: [] },
        auth: 'bearer',
      };
    case 'mission-get':
      return {
        method: 'GET',
        path: `/v1/missions/${cmd.args[0]!}`,
        body: null,
        auth: 'bearer',
      };
    case 'help':
    case 'version':
      return { method: 'GET', path: '/health', body: null, auth: 'public' };
  }
}

export function renderHelp(): string {
  const lines: string[] = [];
  lines.push('aura-lie CLI ' + VERSION);
  lines.push('');
  lines.push('Usage: aura <command> [args]');
  lines.push('');
  lines.push('Commands:');
  lines.push('  health                  Check the service is alive');
  lines.push('  chat <message>          Send one message');
  lines.push('  verify <claimId>        Re-verify a claim');
  lines.push('  memory list             List memories');
  lines.push('  memory add <text>       Add one memory');
  lines.push('  memory forget <id>      Forget one memory');
  lines.push('  quota                   Show current quota');
  lines.push('  receipt                 Show the monthly receipt');
  lines.push('  mission create <goal>   Create a mission');
  lines.push('  mission get <id>        Fetch a mission');
  lines.push('  version                 Print the CLI version');
  lines.push('  help                    Print this text');
  return lines.join('\n');
}

export function renderCommand(cmd: CliCommand): string {
  if (cmd.name === 'help') return renderHelp();
  if (cmd.name === 'version') return 'aura-lie CLI ' + VERSION;
  const r = resolveCli(cmd);
  if (matchRoute(r.method, r.path) === null) {
    throw new Error(`cli: ${r.method} ${r.path} is not in the route table`);
  }
  const bodyPart = r.body === null ? '' : ' ' + JSON.stringify(r.body);
  return `${r.method} ${r.path}${bodyPart}`;
}
// === FILE END ===