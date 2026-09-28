import { createHash, randomUUID } from 'crypto'
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { basename, dirname, join } from 'path'
import { getProjectConfigPath, getUserConfigPath } from './config.ts'
import { getMcpConfigDigest, parseMcpJson } from './parseConfig.ts'
import type { McpServerConfig, ResolvedMcpServer } from './types.ts'

export interface McpCapabilitiesResult {
  servers: ResolvedMcpServer[]
  connectable: Record<string, McpServerConfig>
  diagnostics: string[]
}

export function safeMcpConfigSummary(config: McpServerConfig): string {
  if ('command' in config) {
    const args: string[] = []
    const original = config.args ?? []
    const secretValues = Object.values(config.env ?? {}).filter(Boolean)
    let redactNext = false
    for (const arg of original) {
      if (redactNext) { args.push('[redacted]'); redactNext = false; continue }
      if (/^(?:--?)?(?:api[-_]?key|token|secret|password|credential|authorization)$/i.test(arg)) {
        args.push(arg); redactNext = true; continue
      }
      if (/^(?:-H|--header|--headers|--auth|--password|-u)$/i.test(arg)) { args.push(arg); redactNext = true; continue }
      if (/^(?:--?)?(?:api[-_]?key|token|secret|password|credential|authorization)=/i.test(arg)) {
        args.push(`${arg.slice(0, arg.indexOf('=') + 1)}[redacted]`); continue
      }
      if (secretValues.some((secret) => arg.includes(secret)) || /^(?:sk-|gh[pousr]_|xox[baprs]-|eyJ[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{40,})/.test(arg)) {
        args.push('[redacted]'); continue
      }
      args.push(arg)
    }
    return `stdio → ${basename(config.command) || 'command configured'}${args.length ? ` ${args.join(' ')}` : ''}`
  }
  let endpoint = config.url
  try { endpoint = new URL(config.url).origin } catch {}
  return `${config.type} → ${endpoint}`
}

interface Candidate extends ResolvedMcpServer {
  priority: number
  trustKey?: string
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`
}

function trustIdentity(scope: 'user' | 'project', packageName: string, name: string): string {
  return `${scope}:${packageName}:${name}`
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch { return null }
}

async function getTrustedDigest(configPath: string, key: string): Promise<string | undefined> {
  const config = await readJson(configPath)
  const map = config?.mcpTrust
  if (!map || typeof map !== 'object' || Array.isArray(map)) return undefined
  const record = (map as Record<string, unknown>)[key]
  return record && typeof record === 'object' && !Array.isArray(record) && typeof (record as Record<string, unknown>).digest === 'string'
    ? (record as Record<string, string>).digest
    : undefined
}

async function setTrustedDigest(configPath: string, key: string, value?: string): Promise<void> {
  let config: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(await readFile(configPath, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected a JSON object')
    config = parsed as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`Cannot update MCP trust in ${configPath}: existing config is invalid and was left unchanged (${error instanceof Error ? error.message : String(error)})`)
    }
  }
  const current = config.mcpTrust && typeof config.mcpTrust === 'object' && !Array.isArray(config.mcpTrust)
    ? config.mcpTrust as Record<string, unknown>
    : {}
  const next = { ...current }
  if (value) next[key] = { digest: value }
  else delete next[key]
  config.mcpTrust = next
  await mkdir(dirname(configPath), { recursive: true })
  const temp = `${configPath}.tmp-${process.pid}-${randomUUID()}`
  try {
    await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temp, configPath)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
}

async function discoverPackages(
  root: string,
  scope: 'system' | 'user' | 'project',
  diagnostics: string[],
): Promise<Candidate[]> {
  const found: Candidate[] = []
  let entries
  try {
    const info = await lstat(root)
    if (!info.isDirectory() || info.isSymbolicLink()) {
      diagnostics.push(`${root}: MCP package root must be a real directory`)
      return found
    }
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') diagnostics.push(`${root}: ${error instanceof Error ? error.message : String(error)}`)
    return found
  }
  for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (scope !== 'system' && entry.name.startsWith('.')) continue
    if (entry.name === 'node_modules' || !entry.isDirectory()) continue
    const packageDir = join(root, entry.name)
    const configPath = join(packageDir, 'mcp.json')
    try {
      const packageInfo = await lstat(packageDir)
      const fileInfo = await lstat(configPath)
      if (packageInfo.isSymbolicLink() || !packageInfo.isDirectory() || fileInfo.isSymbolicLink() || !fileInfo.isFile()) {
        diagnostics.push(`${configPath}: MCP package and mcp.json must be regular paths`)
        continue
      }
      if (fileInfo.size > 32 * 1024) {
        diagnostics.push(`${configPath}: mcp.json exceeds 32768 bytes`)
        continue
      }
      const parsed = parseMcpJson(await readFile(configPath, 'utf8'), configPath)
      diagnostics.push(...parsed.diagnostics)
      for (const [name, config] of parsed.servers) {
        const effectiveConfig: McpServerConfig = 'command' in config ? { ...config, cwd: config.cwd ?? packageDir } : config
        const configDigest = digest({ configDigest: getMcpConfigDigest(effectiveConfig), packageName: entry.name, scope })
        const priority = scope === 'system' ? 100 : scope === 'project' ? 40 : 20
        const trustKey = scope === 'system' ? undefined : trustIdentity(scope, entry.name, name)
        found.push({ name, config: effectiveConfig, scope, packageName: entry.name, sourcePath: configPath, digest: configDigest, trustedBy: scope === 'system' ? 'system' : undefined, priority, trustKey })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') diagnostics.push(`${configPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return found
}

async function discoverLegacy(configPath: string, scope: 'user' | 'project', diagnostics: string[]): Promise<Candidate[]> {
  let config: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(await readFile(configPath, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      diagnostics.push(`${configPath}: config.json must contain a JSON object`)
      return []
    }
    config = parsed as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      diagnostics.push(`${configPath}: config.json could not be read as valid JSON`)
    }
    return []
  }
  const map = config.mcpServers
  if (map === undefined) return []
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    diagnostics.push(`${configPath}: mcpServers must be an object`)
    return []
  }
  const parsed = parseMcpJson(JSON.stringify({ mcpServers: map }), configPath)
  diagnostics.push(...parsed.diagnostics)
  const priority = scope === 'project' ? 50 : 30
  return [...parsed.servers].map(([name, serverConfig]) => ({
    name, config: serverConfig, scope: 'legacy', sourcePath: configPath,
    digest: digest(serverConfig), trustedBy: 'explicit-config', priority,
  }))
}

export async function discoverMcpCapabilities(cwd: string): Promise<McpCapabilitiesResult> {
  const userHome = join(homedir(), '.microcode')
  const projectHome = join(cwd, '.microcode')
  const diagnostics: string[] = []
  const candidates = [
    ...await discoverPackages(join(userHome, 'mcp', '.system'), 'system', diagnostics),
    ...await discoverPackages(join(userHome, 'mcp'), 'user', diagnostics),
    ...await discoverLegacy(getUserConfigPath(), 'user', diagnostics),
    ...await discoverPackages(join(projectHome, 'mcp'), 'project', diagnostics),
    ...await discoverLegacy(getProjectConfigPath(cwd), 'project', diagnostics),
  ].sort((a, b) => b.priority - a.priority || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

  const selected = new Map<string, Candidate>()
  for (const item of candidates) {
    const current = selected.get(item.name)
    if (current) {
      diagnostics.push(current.scope === 'system'
        ? `MCP server "${item.name}" conflicts with reserved system server; ${item.scope} server ignored.`
        : `MCP server "${item.name}" from ${item.sourcePath ?? item.scope} conflicts with ${current.sourcePath ?? current.scope}; ${current.scope} source selected.`)
      continue
    }
    selected.set(item.name, item)
  }

  // Any system identifier remains reserved even if a higher-level source was encountered first.
  const systemNames = new Set(candidates.filter((item) => item.scope === 'system').map((item) => item.name))
  for (const [name, item] of [...selected]) {
    if (systemNames.has(name) && item.scope !== 'system') {
      selected.delete(name)
      const system = candidates.find((candidate) => candidate.name === name && candidate.scope === 'system')
      if (system) selected.set(name, system)
      diagnostics.push(`MCP server "${name}" conflicts with reserved system server; ${item.scope} server ignored.`)
    }
  }

  const resolved: ResolvedMcpServer[] = []
  const connectable: Record<string, McpServerConfig> = {}
  for (const item of selected.values()) {
    let trustedBy = item.trustedBy
    if (!trustedBy && item.trustKey) {
      const trustPath = item.scope === 'project' ? getProjectConfigPath(cwd) : getUserConfigPath()
      if (await getTrustedDigest(trustPath, item.trustKey) === item.digest) trustedBy = 'user-approval'
    }
    const server = { name: item.name, config: item.config, scope: item.scope, packageName: item.packageName, sourcePath: item.sourcePath, pluginId: item.pluginId, digest: item.digest, trustedBy }
    resolved.push(server)
    if (trustedBy) connectable[item.name] = item.config
    else diagnostics.push(`MCP server "${item.name}" from ${item.sourcePath} is untrusted and was not connected.`)
  }
  return { servers: resolved, connectable, diagnostics }
}

export async function setMcpDirectoryTrust(cwd: string, server: ResolvedMcpServer, trusted: boolean): Promise<void> {
  if (server.scope !== 'user' && server.scope !== 'project') throw new Error(`MCP server "${server.name}" cannot be trusted through the directory MCP flow.`)
  if (!server.packageName) throw new Error(`MCP server "${server.name}" is not a directory package.`)
  const key = trustIdentity(server.scope, server.packageName, server.name)
  const path = server.scope === 'project' ? getProjectConfigPath(cwd) : getUserConfigPath()
  await setTrustedDigest(path, key, trusted ? server.digest : undefined)
}
