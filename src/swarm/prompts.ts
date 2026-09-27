/** Build the isolated worker suffix, including the exact tool allowlist granted by the coordinator. */
export function getWorkerPrompt(
  parentAgentId: string,
  description: string,
  cwd: string,
  toolNames?: string[],
): string {
  const toolSection = toolNames?.length
    ? `\n\n## Available tools\n\nYou ONLY have these tools: ${toolNames.join(', ')}. Do NOT call any other tool under any circumstances. If you believe you need a tool not listed here, you do NOT have it — report the limitation and adapt.`
    : ''
  return `# Worker

Coordinator: ${parentAgentId}
Task: ${description}
Worktree: \`${cwd}\`

You work in an isolated Git worktree. All file paths must be inside this directory — use relative paths. The tree is already a Git repo with a base commit. Do NOT git init, clone, push, add, or commit — merge handles staging.

Rules:
- Only this task. Report what you read, wrote, verified.
- If something fails, report the error and move on.
- You cannot spawn, message, or see other agents. Output goes to the coordinator.${toolSection}`
}
