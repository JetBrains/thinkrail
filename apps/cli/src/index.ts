#!/usr/bin/env bun
// The `thinkrail` bin as run FROM SOURCE (`bun apps/cli/src/index.ts`, or a dev checkout on PATH). The
// compiled binary enters through `compiled-entry.ts` instead; the two differ only in the provenance they
// declare, which rides analytics as the `build` property.

import { launch } from "./bootstrap";

await launch("source");
