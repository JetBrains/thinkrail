import { RiCloseLine, RiMenuLine } from "@remixicon/react";
import { IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useEffect, useState } from "react";
import { components, guides } from "./content";
import { ComponentPage } from "./pages/ComponentPage";
import { GuidePage } from "./pages/GuidePage";
import { componentSections } from "./pages/sections";
import { ThemeMenu } from "./parts/ThemeMenu";

function currentRoute(): string {
	return window.location.hash.replace(/^#\//, "").split("/")[0] || "using";
}

function useRoute(): string {
	const [route, setRoute] = useState(currentRoute);
	useEffect(() => {
		const onHash = () => {
			setRoute(currentRoute());
			document.getElementById("library-main")?.scrollTo({ top: 0 });
		};
		window.addEventListener("hashchange", onHash);
		return () => window.removeEventListener("hashchange", onHash);
	}, []);
	return route;
}

function Navigation({ route, onNavigate }: { route: string; onNavigate: () => void }) {
	const link = (slug: string, label: string) => (
		<a
			key={slug}
			href={`#/${slug}`}
			onClick={onNavigate}
			aria-current={route === slug ? "page" : undefined}
			className={cn(
				"flex h-panel-row items-center rounded-sm px-8 tr-text-ui outline-none hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary",
				route === slug ? "bg-control-bg-selected text-text-default" : "text-text-muted",
			)}
		>
			{label}
		</a>
	);
	const active = components.find((doc) => doc.slug === route);
	return (
		<nav aria-label="Library" className="flex flex-col gap-16">
			<div className="flex flex-col gap-2">
				<span className="px-8 tr-text-eyebrow text-text-muted">Guides</span>
				{guides.map((guide) => link(guide.slug, guide.title))}
			</div>
			<div className="flex flex-col gap-2">
				<span className="px-8 tr-text-eyebrow text-text-muted">Components</span>
				{components.map((doc) => (
					<div key={doc.slug} className="flex flex-col gap-2">
						{link(doc.slug, doc.name)}
						{active?.slug === doc.slug ? (
							<div className="ml-12 flex flex-col border-border-default border-l pl-4">
								{componentSections.map((section) => (
									<a
										key={section.id}
										href={`#/${doc.slug}/${section.id}`}
										onClick={(event) => {
											event.preventDefault();
											onNavigate();
											document
												.getElementById(`${doc.slug}-${section.id}`)
												?.scrollIntoView({ block: "start" });
										}}
										className="rounded-sm px-8 py-2 tr-text-metadata text-text-muted outline-none hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
									>
										{section.title}
									</a>
								))}
							</div>
						) : null}
					</div>
				))}
			</div>
		</nav>
	);
}

export function App() {
	const route = useRoute();
	const [menuOpen, setMenuOpen] = useState(false);
	const component = components.find((doc) => doc.slug === route);
	const guide = guides.find((page) => page.slug === route) ?? guides[0];
	return (
		<div className="flex h-dvh flex-col bg-container-workspace-bg text-text-default">
			<header className="flex h-40 shrink-0 items-center gap-8 border-border-default border-b bg-container-header-bg px-12">
				<IconButton
					icon={menuOpen ? RiCloseLine : RiMenuLine}
					label={menuOpen ? "Close navigation" : "Open navigation"}
					aria-expanded={menuOpen}
					aria-controls="library-nav-drawer"
					onClick={() => setMenuOpen((open) => !open)}
					className="md:hidden"
				/>
				<a href="#/using" className="tr-title-compact text-text-default">
					ThinkRail components
				</a>
				<span className="hidden tr-text-metadata text-text-muted sm:inline">
					live from source · production styles
				</span>
				<div className="ml-auto">
					<ThemeMenu />
				</div>
			</header>
			<div className="relative flex min-h-0 flex-1">
				<aside className="hidden w-[15rem] shrink-0 overflow-y-auto border-border-default border-r bg-container-sidebar-bg p-8 md:block">
					<Navigation route={route} onNavigate={() => {}} />
				</aside>
				{menuOpen ? (
					<aside
						id="library-nav-drawer"
						className="absolute inset-y-0 left-0 z-20 w-[16rem] max-w-full overflow-y-auto border-border-default border-r bg-container-sidebar-bg p-8 shadow-[var(--shadow-lg)] md:hidden"
					>
						<Navigation route={route} onNavigate={() => setMenuOpen(false)} />
					</aside>
				) : null}
				<main id="library-main" className="min-w-0 flex-1 overflow-y-auto">
					{component ? (
						<ComponentPage key={component.slug} doc={component} />
					) : guide ? (
						<GuidePage page={guide} />
					) : null}
				</main>
			</div>
		</div>
	);
}
