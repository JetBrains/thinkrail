import { RiCloseLine, RiMenuLine } from "@remixicon/react";
import { IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useEffect, useState } from "react";
import { BrandLogo } from "@/shell/BrandLogo";
import { type AreaId, areas, components, docs } from "./content";
import { ComponentPage } from "./pages/ComponentPage";
import { DocPage } from "./pages/DocPage";
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

function areaOf(route: string): AreaId {
	return docs.find((page) => page.slug === route)?.area ?? "components";
}

function areaHome(area: AreaId): string {
	return area === "components"
		? OVERVIEW
		: (docs.find((page) => page.area === area)?.slug ?? OVERVIEW);
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
	area: AreaId;
	route: string;
	onNavigate: () => void;
}) {
	const title = areas.find((entry) => entry.area === area)?.title ?? area;
	return (
		<nav aria-label={title} className="flex flex-col gap-2">
			{area === "components" ? (
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
			) : (
				docs
					.filter((page) => page.area === area)
					.map((page) => (
						<NavLink
							key={page.slug}
							slug={page.slug}
							label={page.title}
							route={route}
							onNavigate={onNavigate}
						/>
					))
			)}
		</nav>
	);
}

function TopNav({ area }: { area: AreaId }) {
	return (
		<nav aria-label="Sections" className="hidden h-full items-stretch lg:flex">
			{areas.map((entry) => (
				<a
					key={entry.area}
					href={`#/${areaHome(entry.area)}`}
					aria-current={area === entry.area ? "page" : undefined}
					className={cn(
						"relative flex h-full items-center px-12 tr-text-ui outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset",
						area === entry.area
							? "text-primary after:absolute after:inset-x-12 after:bottom-0 after:h-2 after:rounded-full after:bg-primary after:content-['']"
							: "text-text-muted hover:text-text-default",
					)}
				>
					{entry.title}
				</a>
			))}
		</nav>
	);
}

export function App() {
	const route = useRoute();
	const area = areaOf(route);
	const [menuOpen, setMenuOpen] = useState(false);
	const component = components.find((doc) => doc.slug === route);
	const page = docs.find((entry) => entry.slug === route);
	return (
		<div className="flex h-dvh flex-col bg-container-workspace-bg text-text-default">
			<header className="flex h-[3.5rem] shrink-0 items-center gap-12 border-border-default border-b bg-container-header-bg px-16">
				<IconButton
					icon={menuOpen ? RiCloseLine : RiMenuLine}
					label={menuOpen ? "Close navigation" : "Open navigation"}
					aria-expanded={menuOpen}
					aria-controls="library-nav-drawer"
					onClick={() => setMenuOpen((open) => !open)}
					className="lg:hidden"
				/>
				<a
					href={`#/${OVERVIEW}`}
					className="flex items-center gap-8 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
				>
					<BrandLogo />
					<span className="tr-title-card text-text-default">Design system</span>
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
						className="absolute inset-y-0 left-0 z-20 flex w-[16rem] max-w-full flex-col gap-16 overflow-y-auto border-border-default border-r bg-container-sidebar-bg px-8 py-16 shadow-[var(--shadow-lg)] lg:hidden"
					>
						{areas.map((entry) => (
							<div key={entry.area} className="flex flex-col gap-2">
								<GroupLabel label={entry.title} />
								<Sidebar area={entry.area} route={route} onNavigate={() => setMenuOpen(false)} />
							</div>
						))}
					</aside>
				) : null}
				<main id="library-main" className="min-w-0 flex-1 overflow-y-auto">
					{component ? (
						<ComponentPage key={component.slug} doc={component} />
					) : page ? (
						<DocPage key={page.slug} page={page} />
					) : (
						<OverviewPage />
					)}
				</main>
			</div>
		</div>
	);
}
