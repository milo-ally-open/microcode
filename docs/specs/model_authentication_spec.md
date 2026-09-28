# Model provider authentication specification

- Status: In progress (provider-driven discovery implemented; OAuth lifecycle hardening remains)
- Updated: 2026-09-28
- Scope: provider authentication in Microcode's Pi-backed model access layer
- Baseline: `@earendil-works/pi-ai@0.87.1` and `@earendil-works/pi-agent-core@0.87.1`, as pinned in `package.json`

## 1. Purpose

Make authentication consistent across every model provider registered by Pi while preserving the authentication method the provider actually supports. A user should be able to select a provider, see its available sign-in methods, complete an OAuth browser/device flow or enter an API credential, and then use the provider without Microcode implementing token refresh or request signing itself.

“All Pi providers” does **not** mean inventing an OAuth flow for every vendor. OAuth requires a vendor-supported client/authorization contract and entitlement. Providers without a usable OAuth contract remain API-key, cloud-identity, or gateway providers. A subscription sold as an API-compatible coding plan is still an API-key integration; it is not automatically OAuth.

## 2. Current implementation

`src/models/registry.ts` creates one shared `Models` collection with `builtinModels({ credentials: new EncryptedCredentialStore() })` and retains Pi's provider OAuth implementations unchanged. `src/models/authChoices.ts` derives interactive login choices from each provider's OAuth and API-key auth descriptors. The TUI therefore exposes every OAuth provider in the pinned Pi catalog, including the two non-subscription account-linking providers, without provider-specific UI branches.

`/login` in `src/tui/app.ts` selects a provider from `models.getProviders()`, calls `models.login(providerId, type, interaction)`, opens `auth_url` and `device_code` verification URLs, accepts provider prompts, and reports success only when login resolves. `/auth` calls `models.checkAuth()` and `/logout` calls `models.logout()`.

At startup, `src/entry.ts` invokes `registerBunOAuthFlows()` so the Pi OAuth implementations are bundled into standalone Bun executables. The shared `EncryptedCredentialStore` implements Pi's `CredentialStore`; it encrypts stored credentials with AES-GCM and keeps its encryption key in the operating-system credential vault. A local compile and compiled `--help` startup smoke passed; this verifies packaging/startup but is not an end-to-end vendor OAuth authorization test.

The installed `pi-ai@0.87.1` provider catalog was enumerated directly from `builtinProviders()`. It currently exposes six subscription OAuth providers, two other OAuth providers, and API-key authentication for all listed providers except Codex, which is OAuth-only:

| Pi provider ID | Auth in `pi-ai@0.87.1` | Product/notes |
|---|---|---|
| `anthropic` | API key + subscription OAuth | Claude Pro/Max OAuth implementation is supplied by Pi. |
| `openai-codex` | Subscription OAuth | ChatGPT/Codex plan flow; Pi supplies browser and device-code methods, both used without a Microcode wrapper. |
| `github-copilot` | API key/token + subscription OAuth | Pi handles account OAuth and model availability metadata. |
| `kimi-coding` | API key + subscription OAuth | Kimi Code OAuth uses a device authorization flow. |
| `xai` | API key + subscription OAuth | Pi labels OAuth for SuperGrok/X Premium. |
| `meta` | API key + subscription OAuth | Pi labels OAuth for the Muse subscription. |
| `openrouter` | API key + OAuth (not marked subscription) | OAuth provisions a user-controlled API key; do not present it as a subscription login. |
| `radius` | API key + OAuth (not marked subscription) | Gateway authentication; not a vendor consumer subscription. |

The remaining built-in provider IDs expose API-key authentication in this pinned package:

`amazon-bedrock`, `ant-ling`, `azure-openai-responses`, `baseten`, `cerebras`, `cloudflare-ai-gateway`, `cloudflare-workers-ai`, `deepseek`, `fireworks`, `google`, `google-vertex`, `groq`, `huggingface`, `minimax`, `minimax-cn`, `mistral`, `moonshotai`, `moonshotai-cn`, `nvidia`, `openai`, `opencode`, `opencode-go`, `qwen-token-plan`, `qwen-token-plan-cn`, `qwen-token-plan-individual`, `together`, `vercel-ai-gateway`, `xiaomi`, `xiaomi-token-plan-ams`, `xiaomi-token-plan-cn`, `xiaomi-token-plan-sgp`, `zai`, and `zai-coding-cn`.

This inventory is a snapshot of the exact dependency in the lockfile, not a promise that future Pi releases expose the same catalog. Pi's README currently documents fewer OAuth providers than the installed package's provider factories and bundled OAuth loader; implementation and package version are the runtime authority.

## 3. Product and policy boundaries

### 3.1 Subscription OAuth versus API credentials

Represent these as distinct auth choices:

- **Subscription OAuth**: provider metadata marks `auth.oauth.isSubscription === true`. Run only that provider's `OAuthAuth.login`, `refresh`, and `toAuth` implementation.
- **OAuth / account linking**: `auth.oauth` exists but is not marked as a model subscription (currently OpenRouter and Radius in the baseline). Use provider-supplied copy; never claim the flow spends a consumer subscription allowance.
- **API key / access token**: provider exposes `auth.apiKey.login`. Use Pi's login and request-auth pipeline; keep subscription-plan API keys bound to their required provider and endpoint.
- **Cloud identity / ambient credentials**: provider supports platform identity such as AWS/Google Cloud credentials. Show setup guidance when supported, but do not convert cloud credentials into a generic OAuth login.

If a provider exposes multiple methods, let the user choose. Do not silently prefer a stored API key over a requested subscription login, or label an API token as OAuth.

### 3.2 Do not transfer first-party CLI credentials

Microcode must not read another CLI's credential files, keychain entries, browser cookies, or device identity to impersonate that CLI. It must not scrape private endpoints or reuse a provider's first-party client ID where that use is not permitted. Add/enable subscription auth only through the provider implementation shipped by Pi or a vendor-approved integration contract, and re-check that contract before advertising the flow.

Google is an explicit exclusion for consumer Gemini Code Assist OAuth in this baseline: Google's Gemini CLI terms state that directly accessing the service through third-party software violates the applicable policy, and Google's June 2026 transition notice says Gemini CLI stops serving consumer Google AI Pro/Ultra requests from June 18, 2026. Microcode continues to support the public Gemini API key and Google Cloud/Vertex paths; it must not import Gemini CLI tokens. See References.

For other provider OAuth flows, Pi package support proves a technical implementation exists, not that all account tiers, geographies, commercial redistribution, or third-party use are approved. Keep vendor-policy validation as a release gate. If the policy is unclear, expose API credentials or supported cloud identity only and record the OAuth integration as gated rather than claiming it is universally supported.

### 3.3 Plan API keys remain API-key flows

Alibaba Model Studio separates Token Plan, Coding Plan, and pay-as-you-go keys and base URLs. The current Pi `qwen-token-plan*` providers represent the Token Plan endpoints; they must not be treated as Alibaba Coding Plan merely because both are monthly/plan products. If Coding Plan is added, it needs the exact plan-specific API key, endpoint, compatible API, model allowlist, and use restrictions supplied by Alibaba. The same rule applies to regional Xiaomi Token Plan providers and Z.AI Coding Plan: retain each plan-specific provider ID, credential environment name, and endpoint.

Never fall back from a plan-specific credential to a generic key or rewrite its base URL in a way that can move requests onto another billing product without an explicit user choice. Report provider ID, endpoint class, and auth source in status without printing the secret.

## 4. Required target behavior

### 4.1 Provider-driven discovery

Generate the login method list from the live Pi Provider descriptor:

1. Add a subscription OAuth choice only if `provider.auth.oauth` exists and `isSubscription` is true.
2. Add an account-linking OAuth choice if OAuth exists but is not a subscription.
3. Add API-key login if `provider.auth.apiKey.login` exists.
4. Do not display unavailable methods or a generic OAuth option for API-key-only providers.
5. Use provider name/auth metadata for labels. In particular, replace the current hard-coded `OAuth subscription` label and `Sign in in your browser` description, which are inaccurate for OpenRouter, Radius, and device-code flows.

An upstream Pi provider added in a dependency update should be discoverable without a new provider-specific branch in `src/tui/app.ts`. Provider-specific exceptions belong in the Pi provider implementation; keep Microcode's UI provider-neutral.

### 4.2 Login lifecycle

The interactive flow must:

1. Pass an `AbortSignal` to `models.login()` and every prompt callback.
2. Render provider prompts including `select`, `secret`, `text`, and `manual_code`.
3. On `auth_url`, validate and open the HTTP(S) URL; retain a visible copyable fallback.
4. On `device_code`, show both verification URL and user code, open the URL, and leave the code visible while polling.
5. Surface provider `info`/`progress` messages without exposing access or refresh tokens.
6. Show success only after `models.login()` resolves and the credential store has accepted the credential.
7. On Escape/cancellation, abort the provider flow, clean prompt/browser callback resources, and do not leave a partial credential.
8. On error, show an actionable sanitized message. Never put authorization codes, callback query values, refresh tokens, or keys in logs/status output.

Browser opening is a convenience, not evidence of authorization. Device-code authorization still requires the user to approve in the browser; completion must be reported only after token exchange and Pi persistence succeed.

### 4.3 Credential lifecycle and model requests

- Keep Pi `Models` as the only runtime boundary for provider login, auth resolution, refresh, and logout.
- Keep the injected `EncryptedCredentialStore` as the credential persistence implementation. Do not create a parallel OAuth token file or provider-specific token cache.
- Let provider `refresh()` and `toAuth()` produce request credentials and account-specific base URLs. Use Pi's locked `CredentialStore.modify()` refresh semantics.
- Keep stored credentials keyed by provider ID, matching Pi's current store contract. Multi-account profiles are outside this spec.
- Continue API-key environment support; status may report variable/source name but never its value.
- Keep custom models API-key-only in this iteration. Adding user-authored OAuth callbacks through JSON is out of scope; it requires a reviewed, executable provider extension mechanism rather than arbitrary config code.

## 5. Implementation plan

### Phase A — normalize the existing Pi-backed flow

1. **Implemented:** auth choices and labels derive from provider OAuth/API-key metadata; non-subscription OAuth is not called subscription sign-in.
2. **Partially verified:** the Bun OAuth loader registration remains in place; standalone compilation and `--help` startup passed. A real provider login against a dedicated test account remains a manual smoke test.
3. **Implemented:** removed Microcode's duplicate Codex OAuth wrapper; Pi 0.87.1 remains responsible for browser and device-code methods.
4. **Implemented:** catalog-driven tests cover all eight OAuth providers and API-key login availability for every built-in provider in the pinned package.
5. **Remaining:** add interaction tests for URL opening, device-code rendering, manual-code prompts, cancellation, token refresh/store behavior, logout, and login failures. Keep external network/token exchange in manual smoke testing with dedicated non-production test accounts; never make normal CI call vendor OAuth endpoints.

### Phase B — subscription products exposed by current Pi

Use Pi's existing OAuth factories for the six subscription providers in Section 2. The goal is parity of discovery, user feedback, cancellation, credential persistence, and status—not a second implementation of each vendor protocol. Record vendor policy/availability by region/account tier before release. If an upstream provider lacks required behavior or policy basis, propose the change upstream first and leave that provider's OAuth gated until resolved.

### Phase C — Pi-supported providers that use API credentials

Keep API key, cloud identity, or gateway auth on the Pi provider path for all API-only provider IDs in Section 2. For plan-specific endpoints absent from Pi (for example, Alibaba Coding Plan if not represented in a later locked Pi version), first verify the vendor's endpoint, API dialect, plan limits, and permitted use. Prefer contributing a provider to `earendil-works/pi` and updating the paired `pi-ai` / `pi-agent-core` exact versions, rather than adding ad hoc OAuth or one-off stream code to Microcode. A custom model can be documented as a temporary compatible-API route only when it can safely bind its own base URL and key.

### Phase D — dependency update policy

The project pins `pi-ai` and `pi-agent-core` to the same exact version. For every upgrade, compare provider IDs, auth descriptors, OAuth loaders, API adapters, callback/device-code behavior, and standalone Bun bundling before changing either pin. Update `package.json`, `bun.lock`, and catalog-driven tests together. Do not promise a provider login based only on upstream `main`, a README, or a community report; verify the exact package release that Microcode builds.

## 6. Verification and acceptance criteria

The implementation derived from this spec is acceptable when:

- Every provider in the pinned Pi catalog appears once in `/auth`; its available login methods match `Provider.auth` metadata.
- Every Pi provider marked `isSubscription: true` appears as subscription OAuth, and no non-subscription OAuth provider is described as consuming a subscription.
- API-key-only providers never show an OAuth option; API-key input uses the provider's Pi login method and encrypted store.
- Browser callback, device-code, manual-code, cancellation, refresh, logout, and failure cases have focused tests with no real provider secrets.
- A successful login survives process restart, `/auth` reports the correct method/source, and a request uses Pi-resolved auth; refresh preserves updated credentials and does not race across concurrent requests.
- Compiled Bun CLI includes every OAuth loader shipped by the exact pinned package. Unsupported loaders fail with a clear message rather than a dynamic-import/bundling error.
- Plan-specific API keys are paired with their matching provider endpoint/model catalog; no generic-key or base-URL fallback can silently switch billing products.
- Vendor policy/eligibility has an owner, source URL, last-checked date, and release decision for each subscription OAuth provider. Unknown status is surfaced as gated, not stated as supported.
- No credential value, OAuth code, device token, refresh token, or browser callback query is emitted to application logs or TUI status.

Run repository tests and a Bun compiled-binary OAuth smoke test when implementing this spec. Keep live vendor OAuth checks manual and account-authorized. Tests/builds were not run as part of writing this specification.

## 7. Non-goals

- Adding a generic OAuth proxy that reuses one vendor's subscription token against another provider.
- Extracting tokens from official vendor CLIs, browser profiles, OS keychains other than Microcode's own encryption-key storage, or cookie stores.
- Advertising every Pi provider as a subscription service.
- Persisting multiple named accounts per provider.
- Implementing provider-specific streaming/API protocols in Microcode when a Pi API adapter exists.

## 8. Repository anchors

- `src/models/registry.ts`: `builtinModels`, custom provider auth, legacy environment key resolution.
- `src/models/authChoices.ts`: provider-driven interactive auth method discovery and labels.
- `src/models/EncryptedCredentialStore.ts`: Pi credential-store adapter and encrypted persistence.
- `src/entry.ts`: static Pi OAuth loader registration for Bun compile.
- `src/tui/app.ts`: `/login`, `/logout`, `/auth`, prompt callbacks, URL opening, auth method labels.
- `tests/models/authChoices.test.ts`: OAuth-provider catalog and API-key-login discovery coverage.
- `docs/specs/model_integration_spec.md`: Pi model catalog upgrade/version policy.

## 9. References

References were checked on 2026-09-28. The installed package source at the exact locked version remains the source of truth for Microcode runtime behavior.

- Pi `pi-ai` provider/auth design and OAuth contract: <https://github.com/earendil-works/pi/blob/main/packages/ai/README.md#oauth-providers>
- Pi built-in provider registration: <https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/all.ts>
- Pi Kimi Code subscription provider: <https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/kimi-coding.ts>
- Pi xAI subscription provider: <https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/xai.ts>
- Pi standalone Bun OAuth loader registration: <https://github.com/earendil-works/pi/blob/main/packages/ai/src/bun-oauth.ts>
- Google Gemini CLI authentication setup: <https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/authentication.mdx>
- Google Gemini CLI third-party OAuth/service policy: <https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md>
- Google June 2026 Gemini CLI consumer subscription transition: <https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/>
- Alibaba Qwen Code plan/authentication setup: <https://help.aliyun.com/zh/model-studio/qwen-code>
- Alibaba Token Plan API endpoint and key separation: <https://help.aliyun.com/zh/model-studio/token-plan-team-quickstart>
- Alibaba Coding Plan allowed use and API key endpoint: <https://help.aliyun.com/zh/model-studio/coding-plan-faq>
- Anthropic Claude Pro/Max access to Claude Code: <https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan>
- OpenAI Codex CLI sign-in and ChatGPT plan use: <https://help.openai.com/en/articles/11381614-api-codex-cli-and-sign-in-with-chatgpt>
