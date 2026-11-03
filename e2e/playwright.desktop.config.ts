import { defineConfig } from "@playwright/test";
import { artifactPlaywrightConfig } from "./artifactPlaywright";

const origin = process.env.THINKRAIL_E2E_DESKTOP_ORIGIN;
if (!origin) throw new Error("THINKRAIL_E2E_DESKTOP_ORIGIN is required");

export default defineConfig(artifactPlaywrightConfig("desktop", origin, false));
