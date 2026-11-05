import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOGIN_ENV_MARKER } from "@thinkrail/shared/shellEnv";

export function resolveBunExecutable(env: NodeJS.ProcessEnv = process.env): string {
	const name = process.platform === "win32" ? "bun.exe" : "bun";
	const executable = (env.PATH ?? "")
		.split(delimiter)
		.filter(Boolean)
		.map((directory) => join(directory, name))
		.find(existsSync);
	if (!executable) throw new Error("bun executable not found for the e2e host");
	return executable;
}

export function writeFakeCentral(fakeBinDir: string): void {
	const source = fileURLToPath(new URL("./bin/central", import.meta.url));
	if (process.platform === "win32") {
		const bash = resolveGitBashExecutable();
		writeFileSync(join(fakeBinDir, "central.cmd"), `@echo off\r\n"${bash}" "${source}" %*\r\n`);
		return;
	}

	const target = join(fakeBinDir, "central");
	copyFileSync(source, target);
	chmodSync(target, 0o755);
}

export function writeFakeGit(fakeBinDir: string): void {
	if (process.platform !== "win32") return;
	const git = resolveWindowsGitExecutable();
	writeFileSync(join(fakeBinDir, "git.cmd"), `@echo off\r\n"${git}" %*\r\n`);
}

export function runFakeCentral(fakeBinDir: string, argv: string[], env: NodeJS.ProcessEnv): void {
	const windows = process.platform === "win32";
	const command = windows ? resolveGitBashExecutable() : join(fakeBinDir, "central");
	const args = windows ? [fileURLToPath(new URL("./bin/central", import.meta.url)), ...argv] : argv;
	execFileSync(command, args, { env, stdio: "ignore" });
}

function resolveGitBashExecutable(): string {
	const git = resolveWindowsGitExecutable();

	let directory = dirname(git);
	while (true) {
		for (const candidate of [
			join(directory, "bin", "bash.exe"),
			join(directory, "usr", "bin", "bash.exe"),
		]) {
			if (existsSync(candidate)) return candidate;
		}
		const parent = dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}

	throw new Error("Git Bash was not found next to the E2E Git executable");
}

function resolveWindowsGitExecutable(): string {
	const git = (process.env.PATH ?? "")
		.split(delimiter)
		.filter(Boolean)
		.map((directory) => join(directory, "git.exe"))
		.find(existsSync);
	if (!git) throw new Error("Git is required to locate the E2E Central shell on Windows");
	return git;
}

export function hermeticE2ePath(fakeBinDir: string): string {
	return [fakeBinDir, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(delimiter);
}

export function hermeticE2eShell(fakeBinDir: string): string {
	return join(fakeBinDir, "login-shell");
}

export function writeHermeticE2eShell(fakeBinDir: string, realShell: string): void {
	const script = [
		"#!/bin/sh",
		'case "$*" in',
		`\t*${shellQuote(LOGIN_ENV_MARKER)}*) printf '%sPATH=%s\\0' ${shellQuote(LOGIN_ENV_MARKER)} ${shellQuote(hermeticE2ePath(fakeBinDir))}; exit 0 ;;`,
		"esac",
		`exec ${shellQuote(realShell)} "$@"`,
		"",
	].join("\n");
	const target = hermeticE2eShell(fakeBinDir);
	writeFileSync(target, script);
	chmodSync(target, 0o755);
}

export function writeFakeGh(fakeBinDir: string, scenarioPath: string, logPath: string): void {
	const source = fileURLToPath(new URL("./fakeGh.ts", import.meta.url));
	const script = [
		"#!/bin/sh",
		`exec ${[resolveBunExecutable(), source, scenarioPath, logPath].map(shellQuote).join(" ")} "$@"`,
		"",
	].join("\n");
	const target = join(fakeBinDir, "gh");
	writeFileSync(target, script);
	chmodSync(target, 0o755);
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}
