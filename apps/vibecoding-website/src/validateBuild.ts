const forbiddenOutput = [
	"/__l5e/",
	"lovable",
	"orbitron-landing-creator",
	"fonts.googleapis.com",
	"fonts.gstatic.com",
] as const;

export async function validateBuild(distDirectory = `${import.meta.dir}/../dist`) {
	const failures: string[] = [];
	const glob = new Bun.Glob("**/*.{html,css,js,svg,txt}");
	for await (const path of glob.scan({ cwd: distDirectory, onlyFiles: true })) {
		const content = await Bun.file(`${distDirectory}/${path}`).text();
		for (const forbidden of forbiddenOutput) {
			if (content.toLowerCase().includes(forbidden)) failures.push(`${path}: ${forbidden}`);
		}
	}

	const index = await Bun.file(`${distDirectory}/index.html`).text();
	for (const required of [
		'<link rel="canonical" href="https://vibecoding.thinkrail.ai/">',
		'<meta property="og:url" content="https://vibecoding.thinkrail.ai/">',
		'<meta property="og:image" content="https://vibecoding.thinkrail.ai/og.png">',
	]) {
		if (!index.includes(required)) failures.push(`index.html missing: ${required}`);
	}

	const ids = [...index.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
	const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
	for (const id of new Set(duplicateIds)) failures.push(`index.html duplicate id: ${id}`);

	if (failures.length > 0) {
		throw new Error(`Invalid vibecoding website build:\n${failures.join("\n")}`);
	}
}

if (import.meta.main) await validateBuild();
