/**
 * Entry point for microcode.
 * Used both in dev mode (bun run ./src/entry.ts) and as the compiled binary
 * (bun build ./src/entry.ts --compile).
 */
import { ensureBootstrapMacro } from './macro'
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth'

declare const MACRO: {
  VERSION: string
}

try {
  process.title = 'microcode'
} catch {}

ensureBootstrapMacro()
// pi-ai keeps OAuth implementations behind dynamic imports in normal runtimes.
// Register the statically bundled flows so Bun --compile binaries can load them.
registerBunOAuthFlows()

if (process.argv.length === 3 && (process.argv[2] === '--version' || process.argv[2] === '-v')) {
  console.log(`${MACRO.VERSION} (Microcode)`)
  process.exit(0)
}

await import('./main.tsx')
