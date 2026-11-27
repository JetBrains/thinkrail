import { describe, expect, test } from "bun:test";
import { errorCodeOf } from "./codedError";
import { packageInstallError } from "./packageInstallError";

const command =
	"npm install pkg --prefix /home/jane/.pi/agent/npm --legacy-peer-deps --no-audit --no-fund failed with code 1";

const captured = (tail: string) => new Error(`${command}:\n${tail}`);

describe("packageInstallError", () => {
	test("names a package npm cannot find, keeping npm's own text", () => {
		const error = captured(
			[
				"npm error code E404",
				"npm error 404 Not Found - GET https://registry.npmjs.org/@thinkrail%2fdefinitely-not-published-xyz - Not found",
				"npm error 404",
				"npm error 404  The requested resource '@thinkrail/definitely-not-published-xyz@*' could not be found or you do not have permission to access it.",
			].join("\n"),
		);
		const coded = packageInstallError(error);
		expect(errorCodeOf(coded)).toBe("PACKAGE_NOT_FOUND");
		expect(coded.message).toBe(error.message);
	});

	test("names a registry npm cannot reach", () => {
		for (const tail of [
			"npm error network request to http://registry.invalid.example/left-pad failed, reason: getaddrinfo ENOTFOUND registry.invalid.example",
			"npm error code ECONNREFUSED\nnpm error FetchError: request to http://127.0.0.1:9/left-pad failed, reason: connect ECONNREFUSED 127.0.0.1:9",
			"npm error code ETIMEDOUT",
			"npm error code EAI_AGAIN",
		]) {
			expect([tail, errorCodeOf(packageInstallError(captured(tail)))]).toEqual([
				tail,
				"PACKAGE_REGISTRY_UNREACHABLE",
			]);
		}
	});

	test("keeps every other failure an install failure", () => {
		for (const error of [
			new Error(command),
			captured("npm error code ERESOLVE\nnpm error ERESOLVE unable to resolve dependency tree"),
			captured("fatal: repository 'https://github.com/jane/missing.git/' not found"),
			"not an Error",
		]) {
			expect(errorCodeOf(packageInstallError(error))).toBe("PACKAGE_INSTALL_FAILED");
		}
	});
});
