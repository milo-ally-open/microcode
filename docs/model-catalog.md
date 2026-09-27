# Keeping the pi-ai model catalog current

Microcode registers built-in providers with `builtinModels()` from
`@earendil-works/pi-ai`. The context-window limit used by automatic compaction
is read from the selected model's `contextWindow` field. Microcode does not
maintain a separate context-window table for built-in models, so updating the
pi-ai dependency and its lockfile is how catalog changes reach the application.

The catalog is bundled with Microcode. New upstream model data does not appear
in an already-installed build until Microcode is rebuilt and redistributed.

## Updating after a provider changes its models

1. Check the latest compatible releases and review the pi-ai release notes or
   package changes for provider/model catalog updates:

   ```sh
   npm view @earendil-works/pi-ai version
   npm view @earendil-works/pi-agent-core version
   ```

2. Update `@earendil-works/pi-ai` and `@earendil-works/pi-agent-core` together
   to compatible releases. These packages currently share a version number in
   this repository; keep them aligned unless upstream documents otherwise:

   ```sh
   bun add --exact @earendil-works/pi-ai@<version> @earendil-works/pi-agent-core@<version>
   ```

   This updates both `package.json` and `bun.lock`. Commit both files so local,
   CI, and release builds use the same catalog.

3. Review the changed provider/model metadata, especially each changed model's
   `provider`, `id`, `api`, `contextWindow`, `maxTokens`, supported input
   modalities, and pricing metadata. The pricing values are upstream model
   metadata; they are not a statement of a user's actual subscription or API
   bill.

4. Build and package Microcode, then publish the new build. For example:

   ```sh
   bun run build
   bun run package:all
   ```

   Users receive the new catalog when they install that release.

## Custom models

Models supplied through `~/.microcode/config.json` or
`.microcode/config.json` are not in pi-ai's built-in catalog. Their
`contextWindow` remains part of the custom model definition and is used by
automatic compaction for that model.

## How to check where the context limit comes from

The model registry is in `src/models/registry.ts`; it calls `builtinModels()`
and exposes the returned model objects. Compaction reads
`this.model.contextWindow` in `src/session/CompactionManager.ts`. When
investigating stale catalog data, check the installed pi-ai package and its
lockfile-resolved version before changing Microcode's compaction logic.
