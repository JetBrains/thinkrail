# Official links, docs, updates & community

## Official links

- **Website & downloads:** https://thinkrail.ai/
- **Documentation:** https://thinkrail.ai/docs/
  - Build an extension: https://thinkrail.ai/docs/build-an-extension/
  - Extension reference: https://thinkrail.ai/docs/extension-reference/
- **Blog (deep dives & release notes):** https://thinkrail.ai/blog/
  - Introducing ThinkRail: https://thinkrail.ai/blog/introducing-thinkrail/
  - Isolated Workspaces: https://thinkrail.ai/blog/thinkrail-workspaces/
  - Spec-Driven Development: https://thinkrail.ai/blog/thinkrail-sdd/
  - Pi philosophy, skills & desktop apps: https://thinkrail.ai/blog/thinkrail-pi-skills-and-desktop-apps/
  - GUI overview: https://thinkrail.ai/blog/gui-overview/
- **Community extensions catalog:** https://thinkrail.ai/extensions/
- **GitHub repository:** https://github.com/JetBrains/thinkrail
- **Releases & changelogs:** https://github.com/JetBrains/thinkrail/releases
- **Issues & feature requests:** https://github.com/JetBrains/thinkrail/issues
- **Discord community:** https://thinkrail.ai/discord
- **Contact / feedback:** **Settings › Share feedback** inside the app, or `info@thinkrail.ai`

## Standalone `pi` packages published by ThinkRail

Users who also run plain `pi` in the terminal can install ThinkRail's interactive tools there too:

- `@thinkrail/pi-ask-user-question` — `pi install npm:@thinkrail/pi-ask-user-question`
- `@thinkrail/pi-visualize` — `pi install npm:@thinkrail/pi-visualize`
- `@thinkrail/pi-next-steps` — `pi install npm:@thinkrail/pi-next-steps`

## Installing, updating & uninstalling

- **Desktop app:** download from https://thinkrail.ai/#install or GitHub Releases (macOS 14+ DMG
  for Apple Silicon/Intel, Windows x64 installer ZIP, Linux x64/ARM64 tarball requiring glibc 2.38+,
  GTK 3, WebKitGTK 4.1, Ayatana AppIndicator 3, librsvg 2, `libnotify-bin`). Switch between
  **stable** and **nightly** channels and install updates in **Settings › Updates**.
- **CLI:**
  - macOS / Linux / Git Bash:
    `curl -fsSL https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh | bash`
  - Windows PowerShell:
    `powershell -c "irm https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1 | iex"`
  - Supports `--channel stable|nightly` and `--version <ver>` (env vars `THINKRAIL_CHANNEL`,
    `THINKRAIL_VERSION` on Windows).
  - Run `thinkrail` (or `thinkrail ~/path/to/repo`), `thinkrail --version`, `thinkrail --help`, or
    `thinkrail uninstall` (`--remove-data` also removes `~/.thinkrail`).

## Live check reminder

For the latest release version, recent changelog entries, or new blog posts published after this
install shipped, fetch https://github.com/JetBrains/thinkrail/releases or https://thinkrail.ai/blog/
when web tools are available, and tell the user that the info came from live web sources (so it may
refer to a newer release than the one they are currently running).
