#!/usr/bin/env bun
// Thin wrapper — the real logic lives in the CLI (`apps/cli/src/central.ts`) so it ships inside the
// compiled `thinkrail` binary and works on any device (mac/linux/windows) with no preinstalled bun:
//     thinkrail central            # wire anthropic + openai at the proxy
//     thinkrail central --remove   # undo
//
// This wrapper keeps `bun run setup-central-cli [--remove]` working for run-from-source dev.

import { runCentral } from "../apps/cli/src/central";

process.exit(await runCentral(process.argv.slice(2), process.env));
