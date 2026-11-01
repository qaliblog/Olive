<p align="center">The open source AI coding agent.</p>
<p align="center">
  <a href="https://olive.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/@olive/cli"><img alt="npm" src="https://img.shields.io/npm/v/@olive/cli?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/olive/actions/workflows/release.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/olive/release.yml?style=flat-square&branch=dev" /></a>
</p>

---

### Installation

```bash
# YOLO
curl -fsSL https://olive.ai/v2/install | bash

# Package managers
npm i -g @olive/cli@latest      # or bun/pnpm/yarn
brew install anomalyco/tap/olive-v2 # macOS and Linux (recommended, always up to date)
brew install olive              # macOS and Linux (official brew formula, updated less)
sudo pacman -S olive            # Arch Linux (Stable)
paru -S olive-beta              # Arch Linux (Latest from AUR)
mise use -g olive               # Any OS
nix run github:anomalyco/olive  # Nix
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Desktop App (BETA)

Olive is also available as a desktop application. Download it from [olive.ai/download](https://olive.ai/download).

| Platform              | Download                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `olive-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `olive-desktop-mac-x64.dmg`     |
| Windows               | `olive-desktop-win-x64.exe`     |
| Linux                 | `.deb`, `.rpm`, or `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask olive-desktop
```

#### Installation Directory

The install script installs Olive to `$HOME/.olive/bin`.

### Agents

Olive includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://olive.ai/v2/docs/agents).

### Documentation

For more info on how to configure Olive, [**head over to our docs**](https://olive.ai/v2/docs).

### Development

Olive needs Bun 1.4.4 (`packageManager` in `package.json`). From the repository root:

```bash
bun install
bun dev            # run the CLI and TUI from source, in this directory
bun dev <dir>      # or open another project
```

Other interfaces have their own root scripts:

```bash
bun dev serve --port 4096   # server only, for the web app
bun run dev:web             # web app
bun run dev:desktop         # Electron desktop app
bun run dev:live <dir>      # development TUI against your installed background service
```

Build the standalone `olive` binary for the current platform:

```bash
cd packages/cli
bun run build               # packages/cli/dist/<target>/bin/olive
bun run build:node          # Node single executable in packages/cli/dist/node
```

`bun run pack` from the root produces the npm artifacts in `dist/npm` and `dist/archives`.

Verify a change with `bun run check` (lint plus typechecks for every package). Tests run per package, never from the root:

```bash
cd packages/cli && bun test
cd packages/core && bun test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the package layout and pull request rules, and [instructions.txt](./instructions.txt) for the full build and run reference.

> [!NOTE]
> Olive does not check for, notify about, or install updates. There is no self-update path and no update server traffic; `olive --version` reports the version you built.

### Contributing

If you're interested in contributing to Olive, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on Olive

If you are working on a project that's related to Olive and is using "olive" as part of its name, for example "olive-dashboard" or "olive-mobile", please add a note to your README to clarify that it is not built by the Olive team and is not affiliated with us in any way.

---

**Join our community** [Discord](https://discord.gg/olive) | [X.com](https://x.com/olive)
