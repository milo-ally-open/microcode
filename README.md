<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/microcode-logo-dark.png">
    <img src="assets/microcode-logo-light.png" alt="Microcode logo" width="128">
  </picture>
</p>

<h1 align="center">Microcode</h1>

<p align="center">
  A terminal-native AI coding assistant for understanding and changing code—built around a focused, keyboard-friendly TUI.
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#tui-input">TUI guide</a> ·
  <a href="#models-and-authentication">Models</a> ·
  <a href="#skills-plugins-and-project-instructions">Extensibility</a>
</p>

## Features

- **Work in the terminal:** stream assistant responses alongside tool activity in a persistent conversation.
- **Understand and change code:** search and read project files, make edits, and run shell commands through configurable permission modes.
- **Choose your model:** use supported built-in providers or define custom models; adjust thinking depth per request.
- **Extend the workflow:** load repository guidance, Skills, MCP servers, and Microcode plugins.
- **Pick up where you left off:** save sessions locally, resume them with rendered conversation history, and scroll through long runs.
- **Handle Git interactively:** inspect changes, manage branches and staging, commit, fetch, pull, push, and work with stashes.

## Contents

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [TUI input](#tui-input)
- [Slash commands](#slash-commands)
- [Models and authentication](#models-and-authentication)
- [Skills, plugins, and project instructions](#skills-plugins-and-project-instructions)
- [MCP servers](#mcp-servers)
- [Permissions](#permissions)
- [Sessions](#sessions)
- [Release packages](#release-packages)

## Requirements

- [Bun](https://bun.sh) 1.3.14 or later to develop and build from source.
- A terminal with Unicode support. Some TUI interactions, including mouse-wheel scrolling, depend on terminal mouse-reporting support.

## Quick start

Build and install from a repository checkout:

```bash
bun install
bun run build
```

The build creates a standalone executable and installs it to:

| Platform | Install path |
|---|---|
| Linux / macOS | `~/.local/bin/microcode` |
| Windows | `%LOCALAPPDATA%\microcode\bin\microcode.exe` |

On Windows, add `%LOCALAPPDATA%\microcode\bin` to `PATH` if the build reports that the command is not available in your current shell. The executable has no Bun runtime dependency.

To run directly from source while developing:

```bash
bun run dev
```

Run tests with `bun test ./tests`.

Then launch Microcode in the project you want to work on:

```bash
microcode                         # Start in the current directory
microcode --resume                # Resume the latest session for this directory
microcode --resume abc12345       # Resume a session by ID prefix
microcode --model openai-codex/gpt-5.6-luna
microcode --permission plan
microcode --thinking high
microcode --help
```

Other non-interactive commands:

```bash
microcode model list
microcode mcp list                 # List configured servers
microcode mcp list --scope project # Filter by scope: user, project, or all
microcode --version
```

## TUI input

| Input | Action |
|---|---|
| `/` | Browse slash commands; choose actions from the on-screen list |
| `$` | Find a Skill as soon as the character is typed; `$skill-name` includes its instructions in the request |
| `@` | Search for and attach workspace files to a request |
| `#` | Find an enabled plugin and include its description and invocable Skill guidance |
| `! command` | Run a shell command and show its output in the conversation |
| `!! command` | Run a shell command without adding its output to the Agent context |
| `Ctrl+V` / `Shift+Insert` | Attach an image from the clipboard when supported by the terminal and model |

Autocomplete menus appear above the input. While viewing older conversation history, use the mouse wheel or PageUp/PageDown to scroll continuously; select **Return to bottom** to follow the latest output again. The input and footer stay anchored while chat output grows.

## Slash commands

| Command | Description |
|---|---|
| `/help` | Show commands and keyboard shortcuts |
| `/clear` | Clear the current conversation view and Agent context |
| `/new` | Start a new conversation session |
| `/session` | Browse and load saved sessions |
| `/compact [instructions]` | Compress conversation context |
| `/export` | Export the current conversation as JSONL into `.microcode/` |
| `/status` | Show context usage, token statistics, and model details |
| `/model [provider/model]` | Browse, select, or switch models |
| `/thinking [level]` | Show or set thinking depth |
| `/permission [mode]` | Show or set the permission mode |
| `/login [provider]` | Sign in to a provider using the available authentication options |
| `/logout [provider]` | Sign out of a provider |
| `/auth` | Show provider authentication status |
| `/mcp` | Show MCP server status |
| `/skills` | Browse and manage Skills |
| `/plugins` | Browse plugins and enable or disable them by scope |
| `/git [action]` | Open the Git action menu or run a supported Git action |
| `/tasks` | Browse task lists and prioritize unfinished work in this session |
| `/instructions [reload]` | Show loaded project instructions or reload them |
| `/init` | Analyze the project and propose a `MICRO.md` project guide for review |
| `/exit` | Exit Microcode |

`/git` supports status, diffs, branches, add/stage, unstage, discard, commit, log, fetch, pull, push, and stash workflows. The interactive menus guide selection; remote and destructive actions require confirmation.

## Models and authentication

The model's API protocol determines the environment variables used for its API key, base URL, and optional model override:

| Protocol | API key | Base URL | Model override |
|---|---|---|---|
| OpenAI-compatible completions | `OPENAI_API_KEY` | `OPENAI_BASE_URL` | `OPENAI_MODEL` |
| Anthropic Messages | `ANTHROPIC_API_KEY` | `ANTHROPIC_BASE_URL` | `ANTHROPIC_MODEL` |
| Google Generative AI | `GEMINI_API_KEY` | `GEMINI_BASE_URL` | `GEMINI_MODEL` |
| Fallback | `API_KEY` | `BASE_URL` | `MODEL` |

Provider sign-in is also available through `/login`; use `/auth` to inspect authentication status. Built-in models and authentication methods are sourced from the pinned Pi packages. To see the catalog available in your build, run `microcode model list`.

### Custom models

Add models to `~/.microcode/config.json` for your user account or `.microcode/config.json` for the current project. Project definitions take precedence over user definitions with the same ID.

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

Supported `api` values are `openai-completions`, `anthropic-messages`, and `google-generative-ai`. Optional fields include `apiKeyEnv`, `reasoning`, `thinkingFormat`, `input` (for example, `["text", "image"]`), `headers`, and display-only `cost`. Custom models are available in `/model` and `microcode model list`.

See [the model integration spec](docs/specs/model_integration_spec.md) for the model catalog, authentication, and update policy.

## Skills, plugins, and project instructions

### Skills

Skills are directories containing a `SKILL.md` file. Microcode discovers:

- User Skills in `~/.microcode/skills/`
- Project Skills in `.microcode/skills/`
- Built-in Skills managed by Microcode

Project Skills take precedence over user Skills with the same name; built-in names are reserved. Type `$` to browse available Skills, then select one. Plugin Skills use the namespaced form `$plugin-name:skill-name`. A Skill adds instructions to that request; it does not grant additional tool permissions.

### Plugins

Microcode plugins are packages that can bundle Skills and MCP server definitions. They are discovered from:

- User: `~/.microcode/plugins/<plugin-name>/`
- Project: `.microcode/plugins/<plugin-name>/`

A package has a `plugin.json` manifest and may include a `skills/` directory and/or an `mcp.json` file. For example:

```text
my-plugin/
├── plugin.json
├── mcp.json          # optional
└── skills/           # optional
    └── review/
        └── SKILL.md
```

The required manifest fields are `name` (lowercase kebab-case), `version` (semantic version), and `description`:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "A short description of this package"
}
```

Use `/plugins` to inspect the list and choose which plugins are enabled in each scope. Packages are disabled unless enabled in Microcode. Only the documented package components are loaded; plugin manifests do not run arbitrary hooks or commands. Plugin Skills and MCP servers are namespaced, and plugin-provided MCP servers are connected when their plugin is enabled.

### Project instructions

Microcode loads `AGENTS.md`, `CLAUDE.md`, and `MICRO.md` files from the project root down to the current working directory, subject to a combined size limit. `/instructions` shows the loaded files; `/instructions reload` discovers them again. `/init` proposes a `MICRO.md` guide and asks before applying it.

## MCP servers

Standalone MCP configuration can live in `~/.microcode/config.json` or `.microcode/config.json`:

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

Directory packages are also supported: put an `mcp.json` containing an `mcpServers` object under `~/.microcode/mcp/<package>/` or `.microcode/mcp/<package>/`. Supported transports include local stdio and secure remote MCP endpoints. Microcode discovers and connects configured servers at startup; `/mcp` shows runtime status and `microcode mcp list` lists discovered configuration. MCP tools still follow Microcode's permission policy. MCP `env` and `headers` values are stored as configuration strings: keep credentials in local, untracked configuration and do not commit them.

## Permissions

The default `interactive` mode allows reads and asks before write, edit, and shell operations. Set a mode at launch with `--permission` (or `--permission-mode`) or change it with `/permission`:

| Mode | Behavior |
|---|---|
| `interactive` | Ask before write/edit/shell operations |
| `auto-approve` | Run tools without interactive approval prompts |
| `plan` | Read-only; block write, edit, and shell operations |

Review tool requests and permission prompts before approving them, especially when using external MCP servers.

## Sessions

Sessions are stored locally under `~/.microcode/sessions/`. `microcode --resume` opens the latest session for the current working directory; `microcode --resume <id-prefix>` opens a matching session. Resumed messages are rendered in the conversation immediately and can be browsed with the mouse wheel or PageUp/PageDown. Use `/session` to choose from saved sessions or `/new` to begin another conversation.

## Release packages

The CLI/TUI package scripts are in `packaging/`:

```bash
bun run package:cli
```

Artifacts are written to `packaging/out/` as platform-specific `.tar.gz` (Linux/macOS) or `.zip` (Windows) packages. Build on each target operating system for a native executable. See [packaging/README.md](packaging/README.md) for install details.
