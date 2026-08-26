import { useEffect, useState } from "react";
import { ActionButton } from "./ActionButton";
import { GithubIcon } from "./GithubIcon";
import { Logo } from "./Logo";

const nav = [
	{ label: "Quick start", href: "#quick-start" },
	{ label: "Demo", href: "#demo" },
	{ label: "Principles", href: "#features" },
	{ label: "Orchestration", href: "#orchestration" },
];

export function SiteHeader() {
	const [showGithub, setShowGithub] = useState(false);

	useEffect(() => {
		const hero = document.getElementById("top") ?? document.querySelector("section");
		if (!hero) return;
		const observer = new IntersectionObserver(
			(entries) => setShowGithub(!(entries[0]?.isIntersecting ?? true)),
			{ rootMargin: "-64px 0px 0px 0px", threshold: 0 },
		);
		observer.observe(hero);
		return () => observer.disconnect();
	}, []);

	return (
		<header className="sticky top-0 z-50 border-b border-border-muted bg-container-overlay-bg backdrop-blur-md">
			<div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
				<a href="#top" aria-label="ThinkRail home">
					<Logo />
				</a>
				<nav className="hidden items-center gap-8 md:flex">
					{nav.map((item) => (
						<a
							key={item.label}
							href={item.href}
							className="text-sm text-text-subtle transition-colors hover:text-text-default"
						>
							{item.label}
						</a>
					))}
				</nav>
				<div className="flex items-center gap-4">
					<div
						aria-hidden={!showGithub}
						inert={!showGithub}
						className={`transition-opacity duration-200 ${
							showGithub ? "opacity-100" : "pointer-events-none opacity-0"
						}`}
					>
						<ActionButton href="https://github.com/JetBrains/thinkrail" variant="secondary">
							<GithubIcon className="h-6 w-6 shrink-0" />
							Star on GitHub
						</ActionButton>
					</div>
				</div>
			</div>
		</header>
	);
}
