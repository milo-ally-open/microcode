# Microcode Packaging

This directory contains CLI/TUI release packaging scripts outside `src/` and
`tests/`.

The scripts are platform-aware and produce native packages for the operating
system they run on:

- Linux: `*-linux-x64.tar.gz` or `*-linux-arm64.tar.gz`
- Windows: `*-windows-x64.zip` or `*-windows-arm64.zip`
- macOS: `*-macos-x64.tar.gz` or `*-macos-arm64.tar.gz`

Build on each target platform to create downloads for Linux, Windows, and
macOS.

## CLI / TUI Package

```sh
bun run package:cli
```

Creates:

- `packaging/out/staging/microcode-cli-v<version>-<platform>-<arch>/`
- `packaging/out/microcode-cli-v<version>-<platform>-<arch>.tar.gz` on Linux/macOS
- `packaging/out/microcode-cli-v<version>-<platform>-<arch>.zip` on Windows

The CLI package contains a standalone `bin/microcode` binary and `install.sh`.
On Windows it also includes `install.cmd`.
