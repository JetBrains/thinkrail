import { ActionButton } from "./ActionButton";
import { GithubIcon } from "./GithubIcon";
import { HeroQuickStart } from "./HeroQuickStart";
import { Reveal } from "./Reveal";

import { Subtitle } from "./Subtitle";
import { VerticalBars } from "./VerticalBars";

export function Hero() {
	return (
		<section
			id="top"
			className="relative flex items-end overflow-hidden border-b border-border-muted"
		>
			<div className="pointer-events-none absolute inset-0 opacity-40">
				<VerticalBars className="block h-full w-full" />
			</div>
			<div className="relative mx-auto w-full max-w-[1200px] px-6 pt-[72px] pb-10 sm:pt-36">
				<div className="flex flex-col gap-12 lg:flex-row lg:items-start lg:gap-16">
					<div className="lg:flex-1">
						<Reveal delay={60}>
							<img
								src="/vibecoding/thinkrail-text-logo-gradient.svg"
								alt="ThinkRail"
								className="mx-auto h-[41px] w-auto max-w-full sm:mx-0 sm:-ml-2 md:h-[58px]"
							/>
						</Reveal>

						<Reveal delay={80}>
							<h1 className="font-display mx-auto mt-9 max-w-[650px] text-center text-[2.2rem] leading-[1.08] font-normal sm:mx-0 sm:text-left sm:text-[2.55rem] md:text-[3.19rem]">
								Vibe code without losing control.
							</h1>
						</Reveal>

						<Reveal delay={140}>
							<Subtitle className="mt-7 text-center sm:text-left">
								ThinkRail gives every AI agent a clear plan, a separate place to work, and a visible
								trail of progress. Run multiple agents at once while your project knowledge stays
								organized.
							</Subtitle>
						</Reveal>

						<Reveal delay={200}>
							<div className="mt-9 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
								<ActionButton href="https://github.com/JetBrains/thinkrail" variant="light">
									<GithubIcon className="h-6 w-6 shrink-0" />
									Explore on GitHub
								</ActionButton>
							</div>
						</Reveal>
					</div>

					<div id="quick-start" className="scroll-mt-24 lg:w-[484px] lg:shrink-0">
						<Reveal delay={260}>
							<HeroQuickStart />
						</Reveal>
					</div>
				</div>

				<Reveal delay={300}>
					<div className="mt-14 flex flex-wrap items-center justify-center gap-2.5 sm:mt-28 sm:justify-start">
						<span className="rounded-sm border border-border px-3 py-1.5 text-[15.6px] text-text-muted">
							JetBrains InnovationHub
						</span>
						<span aria-hidden className="basis-full sm:hidden" />

						<span className="rounded-sm border border-border px-3 py-1.5 text-[15.6px] text-text-muted">
							Apache-2.0
						</span>
						<span className="rounded-sm border border-border px-3 py-1.5 text-[15.6px] text-text-muted">
							open source
						</span>
					</div>
				</Reveal>
			</div>
		</section>
	);
}
