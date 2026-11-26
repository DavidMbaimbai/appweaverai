/**
 * Registry of programming languages the AI agent can generate plain-code
 * (non-web) programs in, plus everything needed to execute them safely in a
 * throwaway Docker container (lib/code-run/run-code.ts) and to prompt the
 * agent correctly (lib/agent/prompts.ts).
 *
 * Each entry runs fully offline (no network) inside the container — no
 * package installs are supported, only each language's standard library.
 */
export type CodeLanguageId =
  | 'python'
  | 'javascript'
  | 'typescript'
  | 'java'
  | 'go'
  | 'c'
  | 'cpp'
  | 'rust'
  | 'ruby'
  | 'php'
  | 'csharp';

export type CodeLanguageDef = {
  id: CodeLanguageId;
  label: string;
  /** Docker image used to build/run the program. */
  image: string;
  /** Conventional entry filename the agent should create. */
  entryFile: string;
  /** File extension (without dot) used to find an entry file if the exact name isn't present. */
  extension: string;
  /** Shell command run inside the container, cwd = /workspace (a writable copy of the artifact's files). */
  command: string;
  /** Short guidance injected into the agent's system prompt. */
  agentGuidance: string;
};

export const CODE_LANGUAGES: Record<CodeLanguageId, CodeLanguageDef> = {
  python: {
    id: 'python',
    label: 'Python',
    image: 'python:3.12-alpine',
    entryFile: 'main.py',
    extension: 'py',
    command: 'python main.py',
    agentGuidance:
      'Write a single self-contained Python 3 program in `main.py` using only the standard library (no pip installs — the runner is offline). Print output with `print()` so behavior is visible when run.',
  },
  javascript: {
    id: 'javascript',
    label: 'JavaScript (Node.js)',
    image: 'node:20-alpine',
    entryFile: 'main.js',
    extension: 'js',
    command: 'node main.js',
    agentGuidance:
      'Write a single self-contained Node.js program in `main.js` using only Node built-in modules (no npm installs — the runner is offline). Use `console.log()` so behavior is visible when run.',
  },
  typescript: {
    id: 'typescript',
    label: 'TypeScript',
    image: 'denoland/deno:alpine',
    entryFile: 'main.ts',
    extension: 'ts',
    command: 'deno run --allow-read --allow-write --quiet main.ts',
    agentGuidance:
      'Write a single self-contained TypeScript program in `main.ts` runnable by Deno, using only Deno/TypeScript built-ins (no npm/deno.land imports — the runner is offline). Use `console.log()` so behavior is visible when run.',
  },
  java: {
    id: 'java',
    label: 'Java',
    image: 'eclipse-temurin:21-jdk-alpine',
    entryFile: 'Main.java',
    extension: 'java',
    command: 'javac Main.java && java Main',
    agentGuidance:
      'Write a single self-contained Java program in `Main.java` with `public class Main` and a `public static void main(String[] args)` entry point, using only the Java standard library (no external dependencies — the runner is offline). Use `System.out.println()` so behavior is visible when run.',
  },
  go: {
    id: 'go',
    label: 'Go',
    image: 'golang:1.22-alpine',
    entryFile: 'main.go',
    extension: 'go',
    command: 'go run main.go',
    agentGuidance:
      'Write a single self-contained Go program in `main.go` with `package main` and `func main()`, using only the Go standard library (no external modules — the runner is offline). Use `fmt.Println()` so behavior is visible when run.',
  },
  c: {
    id: 'c',
    label: 'C',
    image: 'gcc:13',
    entryFile: 'main.c',
    extension: 'c',
    command: 'gcc -O2 -o /tmp/app main.c && /tmp/app',
    agentGuidance:
      'Write a single self-contained C program in `main.c` using only the C standard library (no external dependencies — the runner is offline). Use `printf()` so behavior is visible when run.',
  },
  cpp: {
    id: 'cpp',
    label: 'C++',
    image: 'gcc:13',
    entryFile: 'main.cpp',
    extension: 'cpp',
    command: 'g++ -O2 -std=c++17 -o /tmp/app main.cpp && /tmp/app',
    agentGuidance:
      'Write a single self-contained C++ program in `main.cpp` using only the C++ standard library (no external dependencies — the runner is offline). Use `std::cout` so behavior is visible when run.',
  },
  rust: {
    id: 'rust',
    label: 'Rust',
    image: 'rust:1.79-slim',
    entryFile: 'main.rs',
    extension: 'rs',
    command: 'rustc -O -o /tmp/app main.rs && /tmp/app',
    agentGuidance:
      'Write a single self-contained Rust program in `main.rs` with `fn main()`, using only the Rust standard library (no external crates — the runner is offline). Use `println!()` so behavior is visible when run.',
  },
  ruby: {
    id: 'ruby',
    label: 'Ruby',
    image: 'ruby:3.3-alpine',
    entryFile: 'main.rb',
    extension: 'rb',
    command: 'ruby main.rb',
    agentGuidance:
      'Write a single self-contained Ruby program in `main.rb` using only the Ruby standard library (no gem installs — the runner is offline). Use `puts` so behavior is visible when run.',
  },
  php: {
    id: 'php',
    label: 'PHP',
    image: 'php:8.3-cli-alpine',
    entryFile: 'main.php',
    extension: 'php',
    command: 'php main.php',
    agentGuidance:
      'Write a single self-contained PHP program in `main.php` (starting with `<?php`) using only PHP built-ins (no composer installs — the runner is offline). Use `echo`/`print` so behavior is visible when run.',
  },
  csharp: {
    id: 'csharp',
    label: 'C#',
    image: 'mcr.microsoft.com/dotnet/sdk:8.0',
    entryFile: 'Program.cs',
    extension: 'cs',
    command:
      'mkdir -p /tmp/proj && cp Program.cs /tmp/proj/UserProgram.cs.bak && cd /tmp/proj && dotnet new console --force >/dev/null && cp UserProgram.cs.bak Program.cs && dotnet run --verbosity quiet',
    agentGuidance:
      'Write a single self-contained C# program in `Program.cs` using top-level statements, using only the .NET base class library (no NuGet installs — the runner is offline). Use `Console.WriteLine()` so behavior is visible when run.',
  },
};

export const CODE_LANGUAGE_OPTIONS: { id: CodeLanguageId; label: string }[] =
  Object.values(CODE_LANGUAGES).map(({ id, label }) => ({ id, label }));

export type LanguageCatalogGroup = {
  category: string;
  languages: string[];
};

/** User-facing language catalogue. Generation accepts catalogue entries even when
 * the live runner does not yet have a dedicated compiler image for them. */
export const LANGUAGE_CATALOG: LanguageCatalogGroup[] = [
  {
    category: 'Popular programming languages',
    languages: [
      'Python', 'Java', 'JavaScript', 'TypeScript', 'C', 'C++', 'C#',
      'Go', 'Rust', 'Kotlin', 'Swift', 'PHP', 'Ruby', 'Dart', 'Scala',
      'R', 'MATLAB', 'Objective-C', 'Perl', 'Lua', 'Groovy', 'Julia',
      'Elixir', 'Erlang', 'Haskell', 'Clojure', 'F#', 'OCaml', 'Fortran',
      'COBOL', 'Assembly', 'Visual Basic .NET', 'Delphi (Object Pascal)',
      'Pascal', 'Ada', 'Prolog', 'Lisp', 'Scheme', 'Smalltalk', 'Crystal',
      'Nim', 'Zig', 'D', 'V', 'Pony', 'Mojo', 'Apex', 'Solidity', 'Vyper',
    ],
  },
  {
    category: 'Web development',
    languages: [
      'HTML', 'CSS', 'JavaScript', 'TypeScript', 'PHP', 'Python', 'Ruby',
      'Java', 'C#', 'Go', 'Dart', 'Elm', 'PureScript', 'CoffeeScript',
      'WebAssembly (WASM)', 'WebGPU Shading Language (WGSL)',
    ],
  },
  {
    category: 'Mobile app development',
    languages: [
      'Kotlin', 'Java', 'Swift', 'Objective-C', 'Dart', 'JavaScript',
      'TypeScript', 'C#', 'C++', 'Lua',
    ],
  },
  {
    category: 'Database and query languages',
    languages: [
      'SQL', 'PL/SQL', 'T-SQL', 'PL/pgSQL', 'GraphQL', 'SPARQL', 'Cypher',
      'XQuery', 'LINQ', 'PartiQL', 'MongoDB Query Language (MQL)',
    ],
  },
  {
    category: 'Data science, AI and machine learning',
    languages: [
      'Python', 'R', 'Julia', 'MATLAB', 'Scala', 'Java', 'C++',
      'JavaScript', 'TypeScript', 'Mojo', 'Wolfram Language', 'SAS', 'Stata',
    ],
  },
  {
    category: 'Game development',
    languages: [
      'C++', 'C#', 'C', 'Java', 'JavaScript', 'TypeScript', 'Lua',
      'GDScript', 'Python', 'Rust', 'Swift', 'Kotlin',
    ],
  },
  {
    category: 'Systems and embedded',
    languages: [
      'C', 'C++', 'Rust', 'Assembly', 'Zig', 'Ada', 'Embedded C', 'Verilog',
      'VHDL', 'SystemVerilog', 'eBPF C',
    ],
  },
  {
    category: 'Functional programming',
    languages: [
      'Haskell', 'Elixir', 'Erlang', 'Clojure', 'F#', 'OCaml', 'Lisp',
      'Scheme', 'Elm', 'PureScript', 'Scala', 'ReasonML', 'Gleam',
    ],
  },
  {
    category: 'Shell scripting and automation',
    languages: [
      'Bash', 'PowerShell', 'Zsh', 'Fish', 'Batch', 'AWK', 'Perl', 'Python',
      'JavaScript', 'Ruby',
    ],
  },
  {
    category: 'Smart contracts and blockchain',
    languages: [
      'Solidity', 'Vyper', 'Rust', 'Move', 'Cairo', 'Yul', 'Michelson',
      'Clarity',
    ],
  },
  {
    category: 'Hardware description',
    languages: [
      'Verilog', 'VHDL', 'SystemVerilog', 'Chisel',
      'Bluespec SystemVerilog', 'SystemC',
    ],
  },
  {
    category: 'Markup, styling and configuration',
    languages: [
      'HTML', 'CSS', 'XML', 'JSON', 'YAML', 'TOML', 'Markdown', 'SVG',
      'Sass (SCSS)', 'Less', 'Stylus', 'AsciiDoc', 'reStructuredText',
    ],
  },
  {
    category: 'Infrastructure, DevOps and build',
    languages: [
      'HCL', 'Nix', 'Dockerfile', 'Makefile', 'Starlark',
      'Terraform Configuration Language', 'Cue', 'Jsonnet', 'Dhall',
    ],
  },
  {
    category: 'Legacy and specialised',
    languages: [
      'COBOL', 'FORTRAN', 'RPG', 'ABAP', 'PL/I', 'FoxPro', 'ActionScript',
      'ColdFusion (CFML)', 'BASIC', 'QBasic', 'Logo', 'Scratch', 'GAMS',
      'SAS',
    ],
  },
];

export function isCodeLanguageId(
  value: string | null | undefined,
): value is CodeLanguageId {
  return Boolean(value) && value! in CODE_LANGUAGES;
}

export function getCodeLanguage(id: string | null | undefined) {
  return isCodeLanguageId(id) ? CODE_LANGUAGES[id] : null;
}
