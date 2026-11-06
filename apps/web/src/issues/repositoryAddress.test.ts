import { expect, test } from "bun:test";
import { resolveIssueRepositoryAddress } from "./repositoryAddress";

test("known GitLab root preserves nested groups and strips only terminal .git", () => {
	expect(resolveIssueRepositoryAddress("https://GITLAB.com/group.git/nested/repo.git/")).toEqual({
		status: "valid",
		instanceUrl: "https://gitlab.com",
		projectId: "group.git/nested/repo",
	});
	expect(resolveIssueRepositoryAddress("https://gitlab.com/group/repo.GIT")).toEqual({
		status: "valid",
		instanceUrl: "https://gitlab.com",
		projectId: "group/repo.GIT",
	});
});

test("custom roots and ambiguous prefixes require an explicitly confirmed instance", () => {
	for (const origin of [
		"https://code.example",
		"http://localhost:8080",
		"http://gitlab.com",
		"https://gitlab.com:8443",
	]) {
		expect(resolveIssueRepositoryAddress(`${origin}/group/nested/repo.git`)).toEqual({
			status: "needs-instance",
		});
		expect(resolveIssueRepositoryAddress(`${origin}/group/nested/repo.git`, `${origin}/`)).toEqual({
			status: "valid",
			instanceUrl: origin,
			projectId: "group/nested/repo",
		});
	}
	expect(resolveIssueRepositoryAddress("https://code.example/gitlab/group/repo.git")).toEqual({
		status: "needs-instance",
	});
});

test("explicit subpath uses same origin and complete path segments, retaining port", () => {
	expect(
		resolveIssueRepositoryAddress(
			"http://code.example:8080/tools/gitlab/group/nested/repo.git///",
			"http://CODE.example:8080/tools/gitlab///",
		),
	).toEqual({
		status: "valid",
		instanceUrl: "http://code.example:8080/tools/gitlab",
		projectId: "group/nested/repo",
	});
	for (const instance of [
		"https://code.example:8080/tools/gitlab",
		"http://code.example/tools/gitlab",
		"http://other.example:8080/tools/gitlab",
		"http://code.example:8080/tools/git",
		"http://code.example:8080/TOOLS/gitlab",
		"http://code.example:8080/tools/gitlab/group",
	]) {
		expect(
			resolveIssueRepositoryAddress(
				"http://code.example:8080/tools/gitlab/group/repo.git",
				instance,
			),
		).toEqual({ status: "invalid" });
	}
});

test("ordinary encoded segments decode once into project identifiers", () => {
	expect(resolveIssueRepositoryAddress("https://gitlab.com/gr%6Fup/r%C3%A9po.git")).toEqual({
		status: "valid",
		instanceUrl: "https://gitlab.com",
		projectId: "group/répo",
	});
});

test("rejects unsafe or parser-repaired repository addresses before normalizing", () => {
	const invalid = [
		"",
		"git@gitlab.com:group/repo.git",
		"ssh://gitlab.com/group/repo",
		"file:///group/repo",
		"ftp://gitlab.com/group/repo",
		"https:////gitlab.com/group/repo",
		"https://user@gitlab.com/group/repo",
		"https://user:password@gitlab.com/group/repo",
		"https://gitlab.com/group/repo?",
		"https://gitlab.com/group/repo#",
		"https://gitlab.com/group/repo?token=secret",
		" https://gitlab.com/group/repo",
		"https://gitlab.com/group/repo ",
		"https://gitlab.com/group/rep\no",
		"https://gitlab.com/group/rep\\o",
		"https://gitlab.com/group/../repo",
		"https://gitlab.com/group/./repo",
		"https://gitlab.com/group/%2e%2e/repo",
		"https://gitlab.com/group/.%2E/repo",
		"https://gitlab.com/group/a%2fb",
		"https://gitlab.com/group/a%5Cb",
		"https://gitlab.com/group/%252e%252e",
		"https://gitlab.com/group/%2e",
		"https://gitlab.com/group/a%00b",
		"https://gitlab.com/group/a%20b",
		"https://gitlab.com/group/a%3Fb",
		"https://gitlab.com/group/a%23b",
		"https://gitlab.com/group/a%40b",
		"https://gitlab.com/group/%zz",
		"https://gitlab.com/group/%FF",
		"https://gitlab.com/group//repo",
		"https://gitlab.com/",
		"https://gitlab.com/repo.git",
		"https://gitlab.com/group/.git",
		"https://gitlab.com/group/repo/./",
	];
	for (const address of invalid) {
		expect(resolveIssueRepositoryAddress(address)).toEqual({ status: "invalid" });
	}
});

test("explicit instance is validated just as strictly and cannot consume the repository path", () => {
	for (const instance of [
		"",
		"ssh://code.example",
		"https://user:password@code.example",
		"https://code.example/?",
		"https://code.example/#",
		"https://code.example/a/../",
		"https://code.example/%2e",
		"https://code.example/a%2fb",
		"https://code.example/a%5cb",
		"https://code.example/a//b",
		"https://code.example/group/repo",
	]) {
		expect(resolveIssueRepositoryAddress("https://code.example/group/repo", instance)).toEqual({
			status: "invalid",
		});
	}
});
