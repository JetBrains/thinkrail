import { RiCloseLine, RiMenuLine } from "@remixicon/react";
import { IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useEffect, useState } from "react";
import { BrandLogo } from "@/shell/BrandLogo";
import { components, guides } from "./content";
import { ComponentPage } from "./pages/ComponentPage";
import { GuidePage } from "./pages/GuidePage";
import { OverviewPage } from "./pages/OverviewPage";
import { ThemeMenu } from "./parts/ThemeMenu";

export const OVERVIEW = "overview";

function currentRoute(): string {
	return window.location.hash.replace(/^#\//, "").split("/")[0] || OVERVIEW;
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

type Area = "guides" | "components";

function areaOf(route: string): Area {
	return guides.some((guide) => guide.slug === route) ? "guides" : "components";
}

const componentGroups = [...new Set(components.map((doc) => doc.group))].map((group) => ({
	group,
	items: components.filter((doc) => doc.group === group),
}));

function NavLink({
	slug,
	label,
	route,
	onNavigate,
}: {
	slug: string;
	label: string;
	route: string;
	onNavigate: () => void;
}) {
	const active = route === slug;
	return (
		<a
			href={`#/${slug}`}
			onClick={onNavigate}
			aria-current={active ? "page" : undefined}
			className={cn(
				"flex h-32 items-center rounded-md px-16 tr-text-ui outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
				active ? "bg-primary-subtle text-primary" : "text-text-default hover:bg-control-bg-hovered",
			)}
		>
			{label}
		</a>
	);
}

function GroupLabel({ label }: { label: string }) {
	return (
		<div className="mt-16 mb-4 flex flex-col gap-8 px-16">
			<span className="tr-text-metadata text-text-subtle">{label}</span>
			<span className="h-px bg-border-muted" />
		</div>
	);
}

function Sidebar({
	area,
	route,
	onNavigate,
}: {
	area: Area;
	route: string;
	onNavigate: () => void;
}) {
	return (
		<nav aria-label={area === "guides" ? "Guides" : "Components"} className="flex flex-col gap-2">
			{area === "guides" ? (
				guides.map((guide) => (
					<NavLink
						key={guide.slug}
						slug={guide.slug}
						label={guide.title}
						route={route}
						onNavigate={onNavigate}
					/>
				))
			) : (
				<>
					<NavLink
						slug={OVERVIEW}
						label="Components overview"
						route={route}
						onNavigate={onNavigate}
					/>
					{componentGroups.map(({ group, items }) => (
						<div key={group} className="flex flex-col gap-2">
							<GroupLabel label={group} />
							{items.map((doc) => (
								<NavLink
									key={doc.slug}
									slug={doc.slug}
									label={doc.name}
									route={route}
									onNavigate={onNavigate}
								/>
							))}
						</div>
					))}
				</>
			)}
		</nav>
	);
}

function TopNav({ area }: { area: Area }) {
	const item = (target: Area, href: string, label: string) => (
		<a
			href={href}
			aria-current={area === target ? "page" : undefined}
			className={cn(
				"relative flex h-full items-center px-12 tr-text-ui outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset",
				area === target
					? "text-primary after:absolute after:inset-x-12 after:bottom-0 after:h-2 after:rounded-full after:bg-primary after:content-['']"
					: "text-text-muted hover:text-text-default",
			)}
		>
			{label}
		</a>
	);
	return (
		<nav aria-label="Sections" className="hidden h-full items-stretch sm:flex">
			{item("guides", `#/${guides[0]?.slug ?? "using"}`, "Guides")}
			{item("components", `#/${OVERVIEW}`, "Components")}
		</nav>
	);
}

export function App() {
	const route = useRoute();
	const area = areaOf(route);
	const [menuOpen, setMenuOpen] = useState(false);
	const component = components.find((doc) => doc.slug === route);
	const guide = guides.find((page) => page.slug === route);
	return (
		<div className="flex h-dvh flex-col bg-container-workspace-bg text-text-default">
			<header className="flex h-[3.5rem] shrink-0 items-center gap-12 border-border-default border-b bg-container-header-bg px-16">
				<IconButton
					icon={menuOpen ? RiCloseLine : RiMenuLine}
					label={menuOpen ? "Close navigation" : "Open navigation"}
					aria-expanded={menuOpen}
					aria-controls="library-nav-drawer"
					onClick={() => setMenuOpen((open) => !open)}
					className="md:hidden"
				/>
				<a
					href={`#/${OVERVIEW}`}
					className="flex items-center gap-8 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
				>
					<BrandLogo />
					<span className="tr-title-card text-text-default">Components</span>
				</a>
				<div className="ml-auto flex h-full items-center gap-12">
					<TopNav area={area} />
					<ThemeMenu />
				</div>
			</header>
			<div className="relative flex min-h-0 flex-1">
				<aside className="hidden w-[16rem] shrink-0 overflow-y-auto border-border-default border-r bg-container-sidebar-bg px-8 py-16 md:block">
					<Sidebar area={area} route={route} onNavigate={() => {}} />
				</aside>
				{menuOpen ? (
					<aside
						id="library-nav-drawer"
						className="absolute inset-y-0 left-0 z-20 flex w-[16rem] max-w-full flex-col gap-16 overflow-y-auto border-border-default border-r bg-container-sidebar-bg px-8 py-16 shadow-[var(--shadow-lg)] md:hidden"
					>
						<Sidebar area="guides" route={route} onNavigate={() => setMenuOpen(false)} />
						<Sidebar area="components" route={route} onNavigate={() => setMenuOpen(false)} />
					</aside>
				) : null}
				<main id="library-main" className="min-w-0 flex-1 overflow-y-auto">
					{component ? (
						<ComponentPage key={component.slug} doc={component} />
					) : guide ? (
						<GuidePage page={guide} />
					) : (
						<OverviewPage />
					)}
				</main>
			</div>
		</div>
	);
}
