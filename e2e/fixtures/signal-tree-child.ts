import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const statePath = process.argv[2];
const cleanupPath = process.argv[3];
const innerRunnerPid = Number(process.argv[4]);
if (!statePath || !cleanupPath || !Number.isInteger(innerRunnerPid) || innerRunnerPid <= 0) {
	throw new Error("Signal tree state, cleanup path, and inner runner PID are required");
}

const handleSignal = (): void => {
	process.off("SIGINT", handleSignal);
	process.off("SIGTERM", handleSignal);
	setTimeout(() => {
		writeFileSync(cleanupPath, "cleaned\n");
		process.exit(0);
	}, 100);
};

process.on("SIGINT", handleSignal);
process.on("SIGTERM", handleSignal);

const grandchild = spawn(
	process.execPath,
	[
		"-e",
		"process.on('SIGINT',()=>{});process.on('SIGTERM',()=>{});process.stdout.write('ready\\n');setInterval(()=>{},1000)",
	],
	{ detached: true, stdio: ["ignore", "pipe", "ignore"] },
);
if (!grandchild.pid || !grandchild.stdout)
	throw new Error("Could not start signal tree grandchild");
await new Promise<void>((resolve, reject) => {
	grandchild.once("error", reject);
	grandchild.once("exit", () => reject(new Error("Signal tree grandchild exited before ready")));
	grandchild.stdout.once("data", () => resolve());
});
grandchild.stdout.destroy();
grandchild.unref();
writeFileSync(
	statePath,
	JSON.stringify({ innerRunner: innerRunnerPid, child: process.pid, grandchild: grandchild.pid }),
);
setInterval(() => {}, 1_000);
