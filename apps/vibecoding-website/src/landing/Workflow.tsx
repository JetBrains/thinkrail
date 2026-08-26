import { Reveal } from "./Reveal";
import { Subtitle } from "./Subtitle";

function CodePanel({ children }: { children: React.ReactNode }) {
	return (
		<div className="rounded-lg border border-border bg-container-card-bg p-6">
			<pre className="font-mono text-xs leading-7 break-words whitespace-pre-wrap">{children}</pre>
		</div>
	);
}

export function SpecFirst() {
	return (
		<section id="workflow" className="scroll-mt-16 border-b border-border-muted">
			<div className="mx-auto grid max-w-[1200px] items-start gap-12 px-6 py-12 sm:py-24 md:grid-cols-2">
				<Reveal>
					<p className="label-mono">01 / Development strategy</p>
					<h2 className="font-display mt-5 text-2xl leading-tight font-normal sm:text-3xl">
						Spec-first architecture.
					</h2>
					<Subtitle className="mt-6">
						Before touching code, your agent records requirements, boundaries, and expected outcomes
						in the project spec graph. Once approved, implementation follows that design and is
						checked against focused tests and repository gates.
					</Subtitle>
				</Reveal>
				<Reveal delay={90}>
					<CodePanel>
						<span className="text-text-muted">$ cat specs/payment-integration.md</span>
						{"\n\n"}
						<span className="text-text-default">## Requirements</span>
						{"\n"}
						<span className="text-text-default">- Integrate Stripe Elements checkout flow</span>
						{"\n"}
						<span className="text-text-default">
							- Handle synchronous webhook signature verification
						</span>
						{"\n"}
						<span className="text-text-default">- Ensure robust token rotation logging</span>
						{"\n\n"}
						<span className="text-primary">✓ Spec validation passed. Ready to spawn agent.</span>
					</CodePanel>
				</Reveal>
			</div>
		</section>
	);
}

export function Isolation() {
	return (
		<section id="isolation" className="scroll-mt-16 border-b border-border-muted">
			<div className="mx-auto grid max-w-[1200px] items-start gap-12 px-6 py-12 sm:py-24 md:grid-cols-2">
				<Reveal delay={90} className="md:order-2">
					<p className="label-mono">02 / Isolation environment</p>
					<h2 className="font-display mt-5 text-2xl leading-tight font-normal sm:text-3xl">
						Parallel workspaces.&nbsp;
					</h2>
					<Subtitle className="mt-6">
						No more switching branches back and forth. ThinkRail uses local Git worktrees so
						concurrent tasks can work in separate directories and branches without sharing a dirty
						index or overwriting one another's files.
					</Subtitle>
				</Reveal>
				<Reveal className="md:order-1">
					<CodePanel>
						<span className="text-text-muted">$ git worktree list</span>
						{"\n\n"}
						<span className="text-text-default">/Users/thinkrail/dev/app d4c55b6 [main]</span>
						{"\n"}
						<span className="text-text-default">
							/Users/thinkrail/dev/app-auth-fix 7b4aef9 [auth-jwt-fix]
						</span>
						{"\n"}
						<span className="text-text-default">
							/Users/thinkrail/dev/app-tests-refactor da4c55b [tests-refactor]
						</span>
						{"\n\n"}
						<span className="text-primary">
							Running 3 environments in parallel. No index contamination.
						</span>
					</CodePanel>
				</Reveal>
			</div>
		</section>
	);
}
