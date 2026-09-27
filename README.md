# Microcode

A Light AI-powered coding assistant.

## Prerequisites

- [Bun](https://bun.sh) >= 1.3.5

## Install

```bash
bun install
bun run build
```

This compiles a standalone `microcode` executable (zero runtime dependencies) and installs it to:

| Platform | Install path | Available immediately? |
|---|---|---|
| Linux / macOS | `~/.local/bin/microcode` | Yes (`~/.local/bin` is in PATH by default) |
| Windows | `%LOCALAPPDATA%\microcode\microcode.exe` | Depends — if not in PATH, restart your terminal after build |

## Usage

```bash
# Start a new session
microcode

# Resume the last session for this directory
microcode --resume

# Resume a specific session by ID
microcode --resume abc12345

# Show version
microcode --version

# Show help
microcode --help
```

### Development

```bash
bun run dev        # Start in dev mode (bun source)
```

## Release Packages

Release packaging lives in `packaging/`, separate from `src/` and `tests/`.

```bash
bun run package:cli  # Build a downloadable CLI/TUI package
```

Outputs are written to `packaging/out/`:

| Package | Output |
|---|---|
| CLI / TUI | `microcode-cli-v<version>-<platform>-<arch>.tar.gz` on Linux/macOS, `.zip` on Windows |

The CLI package contains a standalone `bin/microcode` binary plus install
helpers. Build the package on each target operating system to produce native
Linux, Windows, and macOS downloads. See `packaging/README.md` for details.

## Configuration

### API Keys & Model Selection

Set the env var for your model's protocol. The model's API protocol determines which key is used:

| Protocol             | API Key            | Base URL           | Model           |
|----------------------|--------------------|--------------------|-----------------|
| openai-completions   | `OPENAI_API_KEY`   | `OPENAI_BASE_URL`  | `OPENAI_MODEL`  |
| anthropic-messages   | `ANTHROPIC_API_KEY`| `ANTHROPIC_BASE_URL`| `ANTHROPIC_MODEL`|
| google-generative-ai | `GEMINI_API_KEY`   | `GEMINI_BASE_URL`  | `GEMINI_MODEL`  |
| any (fallback)       | `API_KEY`          | `BASE_URL`         | `MODEL`         |

Built-in models and their context-window limits come from the pinned pi-ai model catalog. Run `microcode model list` to see the models available in the installed version. See [docs/specs/model_integration_spec.md](docs/specs/model_integration_spec.md) for how to update the catalog when providers add or change models.

Switch models at runtime with the `/model` slash command, or use the `--model` CLI flag:

```bash
microcode --model gemini-2.5-flash
```

### Custom Models

Define your own models in `~/.microcode/config.json` (user-level) or `.microcode/config.json` (project-level). Project overrides user for models with the same ID.

```json
{
  "models": [
    {
      "id": "my-model",
      "name": "My Model",
      "api": "openai-completions",
      "baseUrl": "https://api.example.com/v1",
      "apiKeyEnv": "MY_API_KEY",
      "reasoning": false,
      "input": ["text"],
      "contextWindow": 128000,
      "maxTokens": 4096
    }
  ]
}
```

**Fields:**

| Field | Required | Type | Description |
|---|---|---|---|
| `id` | yes | string | Unique identifier. `/model <id>` to switch. Same ID as a built-in model overrides it. |
| `name` | yes | string | Display name shown in `/model` list |
| `api` | yes | string | Protocol: `openai-completions`, `anthropic-messages`, `google-generative-ai` |
| `baseUrl` | yes | string | API endpoint URL (not affected by env var overrides) |
| `contextWindow` | yes | number | Context window size in tokens |
| `maxTokens` | yes | number | Maximum output tokens |
| `apiKeyEnv` | no | string | Env var holding the API key. Falls back to protocol default if unset. |
| `reasoning` | no | boolean | Whether the model supports reasoning/thinking (default: `false`) |
| `thinkingFormat` | no | string | When `reasoning: true`: `openai`, `deepseek`, `openrouter`, `together`, `zai`, `qwen`, `qwen-chat-template` |
| `input` | no | string[] | Input modalities: `["text"]` or `["text", "image"]` (default: `["text"]`) |
| `headers` | no | object | Custom HTTP headers added to each request |
| `cost` | no | object | `{ "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }` for display only |

Custom models appear in the `/model` list alongside built-in ones. You can also list all models from the command line:

```bash
microcode model list
```

### MCP Servers

Add MCP servers to `~/.microcode/config.json` (user-level) or `.microcode/config.json` (project-level):

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["path/to/server.js"]
    }
  }
}
```

## Slash Commands

- `/clear` — Clear conversation history
- `/compact` — Compress conversation context
- `/model` — Show or switch model
- `/thinking` — Show or set thinking depth
- `/permission` — Show or switch permission mode
- `/skills` — List available skills
- `/help` — Show available commands

## Skills

Skills are loaded from `SKILL.md` files in `~/.microcode/skills/` or `.microcode/skills/`. Invoke a skill with `/<skill-name>` to load its instructions into the system prompt.

## Sessions

Sessions are saved to `~/.microcode/sessions/`. Use `microcode --resume` to continue where you left off.
