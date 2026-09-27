/** Application model collection backed by pi-ai providers and auth. */

import {
  createProvider,
  type Api,
  type ApiKeyAuth,
  type Model,
  type Models,
  type MutableModels,
  type Provider,
  type ProviderStreams,
} from '@earendil-works/pi-ai'
import { builtinModels } from '@earendil-works/pi-ai/providers/all'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { googleGenerativeAIApi } from '@earendil-works/pi-ai/api/google-generative-ai.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { loadCustomModels, customModelToModel, type CustomModelDef } from './custom.ts'
import { EncryptedCredentialStore } from './EncryptedCredentialStore.ts'
import { createOpenAICodexOAuth } from './openaiCodexOAuth.ts'

export interface ModelConfig {
  model: Model<Api>
  /** Legacy compatibility field; provider auth is resolved by Models at request time. */
  apiKey: string
}

const modelCollection: MutableModels = builtinModels({ credentials: new EncryptedCredentialStore() })
const openAICodexProvider = modelCollection.getProvider('openai-codex')
if (openAICodexProvider?.auth.oauth) {
  modelCollection.setProvider({
    ...openAICodexProvider,
    auth: {
      ...openAICodexProvider.auth,
      oauth: createOpenAICodexOAuth(openAICodexProvider.auth.oauth),
    },
  })
}
let currentModel: Model<Api> | undefined
let registeredCustomIds = new Set<string>()
let customFingerprint = ''

export function getModels(): Models {
  return modelCollection
}

function envKeyNames(def: CustomModelDef): string[] {
  if (def.apiKeyEnv) return [def.apiKeyEnv, 'API_KEY']
  const byApi: Partial<Record<Api, string[]>> = {
    'openai-completions': ['OPENAI_API_KEY', 'API_KEY'],
    'openai-responses': ['OPENAI_API_KEY', 'API_KEY'],
    'anthropic-messages': ['ANTHROPIC_API_KEY', 'API_KEY'],
    'google-generative-ai': ['GEMINI_API_KEY', 'API_KEY'],
  }
  return byApi[def.api] ?? ['API_KEY']
}

function customApi(def: CustomModelDef): ProviderStreams {
  switch (def.api) {
    case 'openai-completions': return openAICompletionsApi()
    case 'openai-responses': return openAIResponsesApi()
    case 'anthropic-messages': return anthropicMessagesApi()
    case 'google-generative-ai': return googleGenerativeAIApi()
    default: throw new Error(`Custom models using the "${def.api}" API are not supported.`)
  }
}

function customAuth(def: CustomModelDef): ApiKeyAuth {
  const envNames = envKeyNames(def)
  return {
    name: `${def.name} API key`,
    login: async (interaction) => ({
      type: 'api_key',
      key: await interaction.prompt({ type: 'secret', message: `Enter API key for ${def.name}` }),
    }),
    resolve: async ({ ctx, credential, signal }) => {
      signal.throwIfAborted()
      if (credential?.key) {
        return { auth: { apiKey: credential.key }, env: credential.env, source: 'stored credential' }
      }
      for (const name of envNames) {
        const key = await ctx.env(name)
        signal.throwIfAborted()
        if (key) return { auth: { apiKey: key }, source: name }
      }
      return undefined
    },
  }
}

function ensureCustomProviders(): void {
  const definitions = loadCustomModels()
  const fingerprint = JSON.stringify(definitions)
  if (fingerprint === customFingerprint) return

  for (const providerId of registeredCustomIds) modelCollection.deleteProvider(providerId)
  registeredCustomIds = new Set()
  for (const def of definitions) {
    const providerId = `custom:${def.id}`
    const model = customModelToModel(def, providerId)
    const provider = createProvider({
      id: providerId,
      name: def.name,
      baseUrl: def.baseUrl,
      auth: { apiKey: customAuth(def) },
      models: [model],
      api: customApi(def),
    })
    modelCollection.setProvider(provider)
    registeredCustomIds.add(providerId)
  }
  customFingerprint = fingerprint
}

export function resetCustomModelCache(): void {
  customFingerprint = ''
  ensureCustomProviders()
}

function applyEnvOverrides(model: Model<Api>): Model<Api> {
  if (String(model.provider).startsWith('custom:')) return model
  const globalBase = process.env.BASE_URL
  if (globalBase) return { ...model, baseUrl: globalBase }
  const key = model.api === 'anthropic-messages'
    ? 'ANTHROPIC_BASE_URL'
    : model.api === 'google-generative-ai'
      ? 'GEMINI_BASE_URL'
      : model.api === 'openai-completions' || model.api === 'openai-responses'
        ? 'OPENAI_BASE_URL'
        : undefined
  const baseUrl = key ? process.env[key] : undefined
  return baseUrl ? { ...model, baseUrl } : model
}

export function getAllModels(): Model<Api>[] {
  ensureCustomProviders()
  const customIds = new Set(getCustomModelDefs().map((model) => model.id))
  return modelCollection.getModels()
    .filter((model) => !(!String(model.provider).startsWith('custom:') && customIds.has(model.id)))
    .map(applyEnvOverrides)
}

export function getCustomModelDefs(): CustomModelDef[] {
  return loadCustomModels()
}

const MODEL_ENV_KEYS = ['MODEL', 'OPENAI_MODEL', 'ANTHROPIC_MODEL', 'GEMINI_MODEL'] as const

function envModel(): string | undefined {
  return MODEL_ENV_KEYS.map((key) => process.env[key]).find(Boolean)
}

function candidatesFor(modelId: string): Model<Api>[] {
  const all = getAllModels()
  const exact = all.filter((model) => model.id === modelId || `${model.provider}/${model.id}` === modelId)
  return exact.length > 0
    ? exact
    : all.filter((model) => model.id.includes(modelId) || modelId.includes(model.id))
}

export function getCurrentModel(): Model<Api> {
  if (currentModel) return currentModel
  const wanted = envModel() ?? 'deepseek-v4-pro'
  const candidates = candidatesFor(wanted)
  if (candidates.length === 0) throw new Error(`Model "${wanted}" was not found.`)
  const model = candidates[0]
  currentModel = applyEnvOverrides(model)
  return currentModel
}

export function setCurrentModel(model: Model<Api>): void {
  currentModel = model
}

export function findModel(modelId: string, api?: Api, provider?: string): Model<Api> | undefined {
  const all = getAllModels()
  if (provider) return all.find((model) => model.id === modelId && model.provider === provider && (!api || model.api === api))
  if (api) return all.find((model) => model.id === modelId && model.api === api)
  return all.find((model) => `${model.provider}/${model.id}` === modelId) ?? all.find((model) => model.id === modelId)
}

export function resolveApiKey(model: Model<Api>): string | undefined {
  const legacyApiKeyEnv = (model as Model<Api> & { apiKeyEnv?: string }).apiKeyEnv
  if (legacyApiKeyEnv && process.env[legacyApiKeyEnv]) return process.env[legacyApiKeyEnv]
  const customDef = getCustomModelDefs().find((def) =>
    def.id === model.id && (String(model.provider) === 'custom' || String(model.provider) === `custom:${def.id}`)
  )
  const names = customDef ? envKeyNames(customDef) : [
    ...(model.provider === 'anthropic' ? ['ANTHROPIC_API_KEY', 'ANTHROPIC_OAUTH_TOKEN'] : []),
    ...(model.provider === 'google' ? ['GEMINI_API_KEY'] : []),
    ...(model.provider === 'openai' ? ['OPENAI_API_KEY'] : []),
    ...(model.provider === 'deepseek' ? ['DEEPSEEK_API_KEY'] : []),
    ...(model.provider === 'xiaomi' ? ['XIAOMI_API_KEY'] : []),
    'API_KEY',
  ]
  return names.map((name) => process.env[name]).find(Boolean)
}

export function getModelConfig(modelId?: string, api?: Api, provider?: string): ModelConfig {
  const model = modelId ? findModel(modelId, api, provider) ?? getCurrentModel() : getCurrentModel()
  return { model, apiKey: resolveApiKey(model) ?? '' }
}
