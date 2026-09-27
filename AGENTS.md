# Repository instructions

## Working agreements
- Read the relevant source and tests before making claims or edits. Treat repository behavior as unverified until supported by code or an allowed test; distinguish confirmed facts from hypotheses.
- Respect the requested scope. For read-only audits, do not edit files, run commands that modify the repository or user environment, or start/dispatch workers. Do not delegate to subagents unless explicitly asked.
- Check the working tree before editing. Preserve all existing user/Codex changes: never discard, overwrite, stash, reset, or commit them unless explicitly asked. If a target file is being edited concurrently, stop and coordinate rather than overwrite it.
- Make the smallest focused change. Do not remove unrelated functionality, introduce dependencies, or add compatibility layers for obsolete data without an explicit requirement.
- Keep secrets out of output and logs. Do not repeat API keys, OAuth codes/tokens, or other credentials found in source, logs, URLs, or screenshots.

## Project-specific guidance
- This is a TypeScript/Bun project. Use the package manager and versions declared in `package.json`; do not assume npm scripts that are not defined there.
- Preserve the single-Agent core and shared TUI/GUI runtime. Do not reintroduce multi-Agent swarm/worker behavior unless explicitly requested. Keep independent capabilities (for example, general task management and Git/worktree functionality) separate from orchestration features.
- When changing Agent behavior, inspect the full path across message conversion, system prompts, tool registration/discovery, permissions, model selection, and session persistence. Keep user-facing capability claims consistent with tools actually exposed at runtime.
- Update or add focused tests for behavior changes. The test script is `bun test ./test` (`bun run test`); build scripts include `bun run build` and `bun run build:gui`. Builds generate output, so do not run them during an explicitly read-only task or when generated-file changes are outside scope. There is no lint script currently declared in `package.json`.
- Do not hand-edit generated build/package output such as `dist/` or `packaging/out/` unless the task explicitly requires it.

## Reporting and verification
- For audits and reviews, cite concrete `file:line` locations and relevant symbols. Separate source-proven conclusions from behavior that still needs runtime verification.
- Report which checks were actually run and their results; do not imply that tests/builds passed if they were not run.
- For changes, summarize modified files and verification performed, including any checks skipped and why.
