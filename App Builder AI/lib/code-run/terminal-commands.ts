/**
 * Fixed allow-list of commands the in-editor terminal can run. Users type a
 * command, but it is only ever executed if it matches one of these entries
 * exactly (case-insensitive, trimmed) — the typed text is never interpolated
 * into a shell string, so there is no command-injection surface. Each entry
 * maps to a literal argv array executed directly (no `sh -c` string join)
 * inside a throwaway, resource-capped Docker container rooted at that
 * project's own workspace directory.
 */
export type TerminalCommand = {
  /** Exact text the user must type (case-insensitive) to run this command. */
  input: string;
  /** Short description shown in the command palette / `help` output. */
  description: string;
  /** Literal argv executed inside the container — never built from user input. */
  argv: string[];
  /** Whether this command needs outbound network access (e.g. npm registry). */
  needsNetwork?: boolean;
};

export const TERMINAL_ALLOWED_COMMANDS: TerminalCommand[] = [
  {
    input: 'help',
    description: 'List every command this terminal supports',
    argv: [],
  },
  {
    input: 'pwd',
    description: 'Print the current sandbox working directory',
    argv: ['pwd'],
  },
  {
    input: 'ls',
    description: 'List files in the project workspace',
    argv: ['ls', '-la'],
  },
  {
    input: 'cat package.json',
    description: 'Print package.json',
    argv: ['cat', 'package.json'],
  },
  {
    input: 'node -v',
    description: 'Print the sandboxed Node.js version',
    argv: ['node', '-v'],
  },
  {
    input: 'npm -v',
    description: 'Print the sandboxed npm version',
    argv: ['npm', '-v'],
  },
  {
    input: 'npm install',
    description: "Install this artifact's dependencies (network required)",
    argv: ['npm', 'install'],
    needsNetwork: true,
  },
  {
    input: 'npm run build',
    description: 'Run the project build script',
    argv: ['npm', 'run', 'build'],
    needsNetwork: true,
  },
  {
    input: 'npm run lint',
    description: 'Run the project lint script',
    argv: ['npm', 'run', 'lint'],
    needsNetwork: true,
  },
  {
    input: 'npm test',
    description: 'Run the project test script',
    argv: ['npm', 'test'],
    needsNetwork: true,
  },
  {
    input: 'git status',
    description: 'Show the working tree status',
    argv: ['git', 'status'],
  },
  {
    input: 'git log',
    description: 'Show the last 20 commits',
    argv: ['git', 'log', '--oneline', '-20'],
  },
];

export function findTerminalCommand(
  raw: string,
): TerminalCommand | undefined {
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  return TERMINAL_ALLOWED_COMMANDS.find(
    (command) => command.input.toLowerCase() === normalized,
  );
}
