import { defineConfig } from "vite";

// `base: "./"` keeps the build servable both at the root of the custom domain
// (https://thinkrail.ai/) and under a sub-path (https://jetbrains.github.io/thinkrail/, which
// redirects there).
export default defineConfig({
	base: "./",
});
