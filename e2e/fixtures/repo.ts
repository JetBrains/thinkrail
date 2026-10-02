import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitQuiet } from "./git";
import { E2E_FIXTURE_REPO } from "./paths";

export const LONG_LINE = Array.from(
	{ length: 80 },
	(_, index) => `segment-${String(index + 1).padStart(2, "0")}`,
).join(" ");

export function fixtureRepoHealthy(): boolean {
	try {
		gitQuiet(E2E_FIXTURE_REPO, "rev-parse", "--git-dir");
		return true;
	} catch {
		return false;
	}
}

export function seedFixtureRepo(): void {
	mkdirSync(E2E_FIXTURE_REPO, { recursive: true });
	const git = (...args: string[]) => gitQuiet(E2E_FIXTURE_REPO, ...args);
	git("init", "-b", "main");
	git("config", "user.email", "e2e@thinkrail.test");
	git("config", "user.name", "ThinkRail E2E");
	git("config", "commit.gpgsign", "false");
	writeFileSync(join(E2E_FIXTURE_REPO, "README.md"), "# sample-project\n");
	writeFileSync(join(E2E_FIXTURE_REPO, "notes.txt"), "plain-text-fixture\n");
	writeFileSync(
		join(E2E_FIXTURE_REPO, "sample.json"),
		'{\n  "project": "sample-project",\n  "features": ["tree", "anchors"]\n}\n',
	);
	writeFileSync(
		join(E2E_FIXTURE_REPO, "sample.csv"),
		"name,kind,enabled\nTree,renderer,true\nTable,renderer,true\n",
	);
	writeFileSync(
		join(E2E_FIXTURE_REPO, "sample.ipynb"),
		JSON.stringify(
			{
				nbformat: 4,
				nbformat_minor: 5,
				metadata: { kernelspec: { language: "python" } },
				cells: [
					{
						cell_type: "markdown",
						id: "intro",
						metadata: {},
						source: [
							"# Notebook fixture\n",
							"Rendered markdown cell\n",
							"![fixture-logo](logo.png)",
						],
					},
					{
						cell_type: "code",
						id: "run",
						metadata: {},
						execution_count: 1,
						source: ['print("notebook-output")'],
						outputs: [{ output_type: "stream", name: "stdout", text: "notebook-output\n" }],
					},
				],
			},
			null,
			2,
		),
	);
	writeFileSync(
		join(E2E_FIXTURE_REPO, "sample.html"),
		'<!doctype html><html><body><h1>HTML fixture</h1><script>document.body.textContent="script-ran"</script></body></html>',
	);
	writeFileSync(join(E2E_FIXTURE_REPO, "LONG_LINE.txt"), LONG_LINE);
	writeFileSync(
		join(E2E_FIXTURE_REPO, "ALERTS.md"),
		[
			"# Alert callouts",
			"",
			"> [!NOTE]",
			"> Useful information users should know.",
			"",
			"> [!TIP]",
			"> Helpful advice for doing things better.",
			"",
			"> [!IMPORTANT]",
			"> Key information to achieve a goal.",
			"",
			"> [!WARNING]",
			"> Urgent info needing immediate attention.",
			"",
			"> [!CAUTION]",
			"> Advises about risky outcomes.",
			"",
			"> A plain blockquote, no marker, so it stays a quote.",
			"",
		].join("\n"),
	);
	writeFileSync(
		join(E2E_FIXTURE_REPO, "DIAGRAM.md"),
		[
			"# Diagram demo",
			"",
			"```mermaid",
			"flowchart TD; Start --> Finish",
			"```",
			"",
			"```mermaid",
			"flowchart TD; Start --> --> broken",
			"```",
			"",
			"```bash",
			"echo plain-fence-stays-code",
			"```",
			"",
		].join("\n"),
	);
	writeFileSync(join(E2E_FIXTURE_REPO, "LARGE.md"), largeRepetitiveMarkdown());
	writeFileSync(
		join(E2E_FIXTURE_REPO, "LINKS.md"),
		[
			"# Link demo",
			"",
			"Jump to [Section two](#section-two), open [the spec](SPEC.md), and see the logo:",
			"",
			"![logo](logo.png)",
			"",
			'<p align="center"><img src="logo.png" width="24" alt="raw-logo"></p>',
			"",
			"<details><summary>Folded</summary>",
			"",
			"Hidden <em>body</em> <script>document.body.textContent = 'pwned'</script>",
			"",
			"</details>",
			"",
			"## Section two",
			"",
			"Target of the in-document anchor.",
			"",
		].join("\n"),
	);
	mkdirSync(join(E2E_FIXTURE_REPO, "styles"), { recursive: true });
	writeFileSync(
		join(E2E_FIXTURE_REPO, "styles", "COLOR.md"),
		"# Colour system\n\nSee [`themes/SPEC.md`](../themes/SPEC.md).\n",
	);
	mkdirSync(join(E2E_FIXTURE_REPO, "themes"), { recursive: true });
	writeFileSync(
		join(E2E_FIXTURE_REPO, "themes", "SPEC.md"),
		"# Theme spec target\n\nReached through a parent-relative Markdown link.\n",
	);
	writeFileSync(
		join(E2E_FIXTURE_REPO, "logo.png"),
		Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAoGB9x0AAAAASUVORK5CYII=",
			"base64",
		),
	);
	writeFileSync(
		join(E2E_FIXTURE_REPO, "RENDERERS.png"),
		Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAoGB9x0AAAAASUVORK5CYII=",
			"base64",
		),
	);
	writeFileSync(join(E2E_FIXTURE_REPO, "RENDERERS.pdf"), asciiPdf("RENDERERS PDF FIXTURE"));
	writeFileSync(join(E2E_FIXTURE_REPO, "LFS-ASSET.png"), lfsPointer("4d7a", 12345));
	writeFileSync(
		join(E2E_FIXTURE_REPO, "SPEC.md"),
		"---\nid: sample-root\ntype: goal-and-requirements\ntitle: Sample Project\n---\n\n## Goal\n\nA throwaway fixture project for the thinkrail e2e suite. It carries the token SPECGRAPHPROBE so spec_grep has a deterministic match to find.\n",
	);
	mkdirSync(join(E2E_FIXTURE_REPO, "module-a"), { recursive: true });
	writeFileSync(
		join(E2E_FIXTURE_REPO, "module-a", "SPEC.md"),
		"---\nid: sample-module\ntype: module-design\nstatus: active\ntitle: Sample Module\nparent: sample-root\n---\n\n## Responsibility\n\nA fixture module spec, child of sample-root.\n",
	);
	const skillDir = join(E2E_FIXTURE_REPO, ".claude", "skills", "e2e-portable");
	mkdirSync(skillDir, { recursive: true });
	writeFileSync(
		join(skillDir, "SKILL.md"),
		"---\nname: e2e-portable\ndescription: Portable e2e fixture skill\n---\n\n# Portable skill\n",
	);
	git("add", "-A");
	git("commit", "-m", "init");
}

export function largeRepetitiveMarkdown(): string {
	const rows = Array.from({ length: 800 }, () => "- alpha beta gamma delta epsilon");
	return `# Large repetitive doc\n\n${rows.join("\n")}\n`;
}

export function largeRepetitiveMarkdownEdited(): string {
	const lines = largeRepetitiveMarkdown().split("\n");
	lines[400] = "- EDITED replacement row";
	return `${lines.join("\n")}- appended row by e2e\n`;
}

export function asciiPdf(text: string): string {
	const stream = `BT /F1 24 Tf 30 100 Td (${text}) Tj ET`;
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];
	let body = "%PDF-1.4\n";
	const offsets: number[] = [];
	objects.forEach((object, index) => {
		offsets.push(body.length);
		body += `${index + 1} 0 obj\n${object}\nendobj\n`;
	});
	const xref = body.length;
	const entries = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `);
	return `${body}xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries.join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

export function lfsPointer(oidPrefix: string, size: number): string {
	const oid = `${oidPrefix}${"0".repeat(64 - oidPrefix.length)}`;
	return `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${size}\n`;
}
