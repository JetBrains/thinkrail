if (process.env.THINKRAIL_WEB_BUILD_TYPECHECK === "0") {
	console.log("web build: tsc --noEmit skipped (THINKRAIL_WEB_BUILD_TYPECHECK=0)");
} else {
	const tsc = Bun.spawnSync(["tsc", "--noEmit"], { stdout: "inherit", stderr: "inherit" });
	process.exitCode = tsc.success ? 0 : (tsc.exitCode ?? 1);
}
