import { HeaderActions } from "./HeaderActions";
import { Logo } from "./Logo";

const nav = [
	{ label: "Quick start", href: "#quick-start" },
	{ label: "Demo", href: "#demo" },
	{ label: "Principles", href: "#features" },
	{ label: "Orchestration", href: "#orchestration" },
];

export function SiteHeader() {
	return (
		<header className="sticky top-0 z-50 border-b border-border-muted bg-container-overlay-bg backdrop-blur-md">
			<div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-6">
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
				<HeaderActions />
			</div>
		</header>
	);
}
