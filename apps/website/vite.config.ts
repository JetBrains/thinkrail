import { defineConfig } from "vite";

// `base: "./"` keeps the build servable both at https://jetbrains.github.io/thinkrail/ (a project
// page under a sub-path) and at the root of any custom domain attached later.
export default defineConfig({
	base: "./",
});
