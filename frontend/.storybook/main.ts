import type { StorybookConfig } from "@storybook/react-vite";

/**
 * Storybook config for ThinkRail's design system.
 *
 * Stories + MDX docs live next to the code they document, under src/.
 * The project's vite.config.ts is auto-merged by @storybook/react-vite,
 * so the "@" -> src alias and all plugins are inherited — no duplication here.
 */
const config: StorybookConfig = {
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  // The project's vite.config.ts is auto-merged, which pulls in the
  // "openapi-codegen" dev plugin — it shells out to `npx openapi-typescript`
  // on server start and crashes Storybook. It's a backend→frontend codegen
  // step irrelevant to Storybook, so strip it (and any duplicate react plugin,
  // since @storybook/react-vite provides its own).
  viteFinal: async (cfg) => {
    cfg.plugins = (cfg.plugins ?? []).filter((p) => {
      const name = p && typeof p === "object" && "name" in p ? (p as { name?: string }).name : undefined;
      return name !== "openapi-codegen";
    });
    return cfg;
  },
};

export default config;
