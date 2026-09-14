-- Lets a single artifact be a plain-code program in any supported
-- programming language (Python, Java, Go, C, C++, Rust, Ruby, PHP, C#,
-- TypeScript-via-Deno) instead of the default web stacks. Null means the
-- artifact keeps today's behaviour (auto-detected web stack + iframe preview).
ALTER TABLE "artifacts" ADD COLUMN IF NOT EXISTS "coding_language" TEXT;
