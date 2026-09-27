import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { OAuthAuth, OAuthCredential, ProviderAuthInteraction } from '@earendil-works/pi-ai'

const clientId = 'app_EMoamEEZ73f0CkXaXp7hrann'
const authUrl = 'https://auth.openai.com/oauth/authorize'
const tokenUrl = 'https://auth.openai.com/oauth/token'
const redirectUri = 'http://localhost:1455/auth/callback'
const accountClaim = 'https://api.openai.com/auth'

type BrowserCallback = { code: string; state: string | null }

function page(title: string, detail: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{background:#09090b;color:#fafafa;font:16px system-ui;display:grid;place-items:center;min-height:90vh}main{text-align:center}h1{font-size:32px}p{color:#a1a1aa}</style></head><body><main><h1>${title}</h1><p>${detail}</p></main></body></html>`
}

function startCallbackServer(state: string): Promise<{
  wait: Promise<BrowserCallback>
  close: () => Promise<void>
}> {
  let resolveCode!: (value: BrowserCallback) => void
  let rejectCode!: (error: Error) => void
  const wait = new Promise<BrowserCallback>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })
  const server = createServer((request, response) => {
    const callback = new URL(request.url ?? '/', redirectUri)
    if (callback.pathname !== '/auth/callback') {
      response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(page('Authentication failed', 'Callback route not found.'))
      return
    }
    const returnedState = callback.searchParams.get('state')
    const code = callback.searchParams.get('code')
    if (returnedState !== state) {
      response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(page('Authentication failed', 'The sign-in state did not match. Return to Microcode and start login again.'))
      return
    }
    if (!code) {
      response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(page('Authentication failed', 'The authorization response did not include a code.'))
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(page('Authentication successful', 'OpenAI sign-in was returned to Microcode. You can close this tab.'))
    resolveCode({ code, state: returnedState })
  })

  const listening = new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('listening', onListening)
      reject(error.code === 'EADDRINUSE'
        ? new Error('OpenAI Codex login port 1455 is already in use. Close the other Microcode login and retry.')
        : new Error(`Could not start the OpenAI Codex callback server: ${error.message}`))
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(1455, '127.0.0.1')
  })

  return listening.then(() => ({
    wait,
    close: () => new Promise<void>((resolve) => {
      if (!server.listening) return resolve()
      server.close(() => resolve())
    }),
  }), async (error) => {
    server.close()
    throw error
  })
}

function readAccountId(accessToken: string): string {
  try {
    const payload = accessToken.split('.')[1]
    if (!payload) throw new Error('Invalid token')
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    const accountId = claims?.[accountClaim]?.chatgpt_account_id
    if (typeof accountId === 'string' && accountId) return accountId
  } catch {}
  throw new Error('OpenAI returned a token without a ChatGPT account ID.')
}

function parseManualCode(input: string, state: string): string {
  const value = input.trim()
  let code = value
  let returnedState: string | null = null
  try {
    const url = new URL(value)
    code = url.searchParams.get('code') ?? ''
    returnedState = url.searchParams.get('state')
  } catch {
    if (value.includes('#')) {
      const [parsedCode, parsedState] = value.split('#', 2)
      code = parsedCode ?? ''
      returnedState = parsedState ?? null
    } else if (value.includes('code=')) {
      const params = new URLSearchParams(value)
      code = params.get('code') ?? ''
      returnedState = params.get('state')
    }
  }
  if (returnedState && returnedState !== state) throw new Error('OpenAI sign-in state mismatch. Start /login openai-codex again.')
  if (!code) throw new Error('The pasted OpenAI callback did not contain an authorization code.')
  return code
}

async function exchangeCode(code: string, verifier: string, signal: AbortSignal): Promise<OAuthCredential> {
  const timeout = AbortSignal.timeout(45_000)
  const requestSignal = AbortSignal.any([signal, timeout])
  let response: Response
  try {
    response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      }),
      signal: requestSignal,
    })
  } catch (error) {
    if (timeout.aborted && !signal.aborted) throw new Error('OpenAI sign-in timed out while exchanging the authorization code. Check your network and try again.')
    throw error
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`OpenAI sign-in failed while exchanging the authorization code (${response.status})${body ? `: ${body}` : ''}`)
  }
  const token = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number }
  if (!token.access_token || !token.refresh_token || typeof token.expires_in !== 'number') {
    throw new Error('OpenAI returned an incomplete sign-in response.')
  }
  return {
    type: 'oauth',
    access: token.access_token,
    refresh: token.refresh_token,
    expires: Date.now() + token.expires_in * 1000,
    accountId: readAccountId(token.access_token),
  }
}

async function browserLogin(interaction: ProviderAuthInteraction): Promise<OAuthCredential> {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(16).toString('hex')
  const url = new URL(authUrl)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', 'openid profile email offline_access')
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  url.searchParams.set('id_token_add_organizations', 'true')
  url.searchParams.set('codex_cli_simplified_flow', 'true')
  url.searchParams.set('originator', 'pi')

  const callbackServer = await startCallbackServer(state)
  const manualAbort = new AbortController()
  let onAbort: (() => void) | undefined
  try {
    onAbort = () => manualAbort.abort()
    interaction.signal.addEventListener('abort', onAbort, { once: true })
    interaction.signal.throwIfAborted()
    interaction.notify({ type: 'auth_url', url: url.toString(), instructions: 'Complete sign-in in your browser. Microcode will continue automatically.' })

    const manualCode = interaction.prompt({
      type: 'manual_code',
      message: 'Waiting for the OpenAI browser callback. Paste the full callback URL here only if the browser cannot return to Microcode:',
      placeholder: redirectUri,
      signal: manualAbort.signal,
    }).then((value) => ({ kind: 'manual' as const, value }), (error: unknown) => ({ kind: 'prompt_error' as const, error }))

    const outcome = await Promise.race([
      callbackServer.wait.then((value) => ({ kind: 'callback' as const, value })),
      manualCode,
    ])
    let code: string
    if (outcome.kind === 'callback') {
      code = outcome.value.code
      manualAbort.abort()
      interaction.notify({ type: 'progress', message: 'Browser callback received. Finishing OpenAI sign-in…' })
    } else if (outcome.kind === 'manual') {
      code = parseManualCode(outcome.value, state)
    } else {
      throw outcome.error instanceof Error ? outcome.error : new Error(String(outcome.error))
    }
    await callbackServer.close()
    interaction.signal.throwIfAborted()
    return await exchangeCode(code, verifier, interaction.signal)
  } finally {
    if (onAbort) interaction.signal.removeEventListener('abort', onAbort)
    manualAbort.abort()
    await callbackServer.close()
  }
}

export function createOpenAICodexOAuth(original: OAuthAuth): OAuthAuth {
  return {
    ...original,
    async login(interaction) {
      const method = await interaction.prompt({
        type: 'select',
        message: 'Select OpenAI Codex login method:',
        options: [
          { id: 'browser', label: 'Browser login (default)' },
          { id: 'device_code', label: 'Device code login (headless)' },
        ],
      })
      if (method === 'browser') return browserLogin(interaction)
      if (method === 'device_code') {
        return original.login({
          ...interaction,
          prompt: (prompt) => prompt.type === 'select'
            ? Promise.resolve('device_code')
            : interaction.prompt(prompt),
        })
      }
      throw new Error(`Unknown OpenAI Codex login method: ${method}`)
    },
  }
}
