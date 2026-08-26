import { Reveal } from "./Reveal";

const cards = [
	{
		n: "01",
		title: "Spec-first workflow",
		body: "Convert natural language directly into testable feature specifications.",
	},
	{
		n: "02",
		title: "Parallel workspaces",
		body: "Separate Git worktrees keep concurrent tasks from editing the same checkout.",
	},
	{
		n: "03",
		title: "Live change stream",
		body: "Interactive diff view tracking every modified source file instantly.",
	},
	{
		n: "04",
		title: "Interactive questions",
		body: "Agents pause and prompt you when requirements lack clarity.",
	},
	{
		n: "05",
		title: "Linked project context",
		body: "Searchable specs preserve requirements, boundaries, and decisions across sessions.",
	},
	{
		n: "06",
		title: "Per-session model choice",
		body: "Choose the provider model and thinking level that fit each coding session.",
	},
];

export function Capabilities() {
	return (
		<section id="capabilities" className="scroll-mt-16 border-b border-border-muted">
			<div className="mx-auto max-w-[1200px] px-6 py-12 sm:py-24">
				<Reveal>
					<p className="label-mono">Capabilities</p>
					<h2 className="font-display mt-4 text-2xl font-normal sm:text-3xl">
						Complete engine overview
					</h2>
				</Reveal>
				<Reveal delay={80}>
					<div className="mt-12 -mr-6 flex snap-x gap-5 overflow-x-auto pr-6 pb-2">
						{cards.map((c) => (
							<article
								key={c.n}
								className="w-[240px] shrink-0 snap-start rounded-lg border border-border bg-background p-5"
							>
								<p className="text-[13.2px] tracking-widest text-text-muted">[ {c.n} ]</p>
								<h3 className="mt-6 text-sm font-semibold">{c.title}</h3>
								<p className="mt-3 text-xs leading-relaxed text-text-muted">{c.body}</p>
							</article>
						))}
					</div>
				</Reveal>
			</div>
		</section>
	);
}
