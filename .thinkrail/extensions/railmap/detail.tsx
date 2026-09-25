import { cn, remixicon, ui } from "@thinkrail/ext/view";
import type { ReactNode } from "react";
import { parseSites, useActionResult } from "./hooks";
import type { LevelEdge, LevelNode } from "./levels";
import { DRIFT_LABEL, type ModuleFile, type RailmapGraph } from "./model";

const { RiCloseLine, RiArrowRightLine } = remixicon;

const LIST_LIMIT = 40;

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
	<section className="flex flex-col gap-4">
		<h3 className="tr-text-metadata text-text-muted">{title}</h3>
		{children}
	</section>
);

const Mono = ({ children, className }: { children: ReactNode; className?: string }) => (
	<span className={cn("break-all tr-code-text text-text-default", className)}>{children}</span>
);

export const DetailShell = ({
	title,
	onClose,
	children,
}: {
	title: string;
	onClose: () => void;
	children: ReactNode;
}) => (
	<aside
		data-testid="railmap-detail"
		className="flex w-320 shrink-0 flex-col border-l border-border-muted bg-container-workspace-bg"
	>
		<div className="flex items-center gap-8 border-b border-border-muted px-12 py-8">
			<span className="min-w-0 flex-1 truncate tr-title-compact text-text-default">{title}</span>
			<ui.Button variant="ghost" size="icon" aria-label="Close details" onClick={onClose}>
				<RiCloseLine className="size-14" />
			</ui.Button>
		</div>
		<div className="flex min-h-0 flex-1 flex-col gap-16 overflow-y-auto p-12">{children}</div>
	</aside>
);

export const NodeDetail = ({
	graph,
	node,
	affected,
	onDrill,
}: {
	graph: RailmapGraph;
	node: LevelNode;
	affected: readonly string[];
	onDrill?: () => void;
}) => {
	const modules = new Set(node.modules);
	const drift = graph.drift.filter((item) => item.from !== undefined && modules.has(item.from));
	const labels = new Map(graph.modules.map((module) => [module.id, module]));
	const own = labels.get(node.modules[0] ?? "");
	return (
		<>
			<Section title="Module">
				<Mono>{node.sublabel}</Mono>
				<span className="tr-text-metadata text-text-muted">
					{node.modules.length} module{node.modules.length === 1 ? "" : "s"}
					{own ? ` · ${own.files} own file${own.files === 1 ? "" : "s"}` : ""}
				</span>
				{onDrill && (
					<ui.Button variant="outline" size="sm" data-testid="railmap-drill" onClick={onDrill}>
						<RiArrowRightLine className="size-14" /> Drill in
					</ui.Button>
				)}
			</Section>
			{own && own.dependsOn.length > 0 && (
				<Section title="Declares depends-on">
					{own.dependsOn.map((id) => (
						<Mono key={id}>{id}</Mono>
					))}
				</Section>
			)}
			<Section
				title={`What breaks if I touch this: ${affected.length} module${affected.length === 1 ? "" : "s"}`}
			>
				<ul data-testid="railmap-affected" className="flex flex-col gap-2">
					{affected.slice(0, LIST_LIMIT).map((id) => (
						<li key={id} className="tr-text-ui text-text-default">
							{labels.get(id)?.label ?? id}{" "}
							<span className="tr-text-metadata text-text-subtle">{labels.get(id)?.dir}</span>
						</li>
					))}
					{affected.length > LIST_LIMIT && (
						<li className="tr-text-metadata text-text-subtle">
							… {affected.length - LIST_LIMIT} more
						</li>
					)}
				</ul>
			</Section>
			{drift.length > 0 && (
				<Section title={`Drift: ${drift.length}`}>
					{drift.slice(0, LIST_LIMIT).map((item) => (
						<p key={item.key} className="tr-text-metadata text-text-default">
							<span className="text-feedback-error">{DRIFT_LABEL[item.kind]}</span> {item.detail}
						</p>
					))}
				</Section>
			)}
		</>
	);
};

export const FileDetail = ({ file, files }: { file: ModuleFile; files: readonly ModuleFile[] }) => {
	const importers = files.filter((other) =>
		other.imports.some((entry) => entry.target === file.path),
	);
	return (
		<>
			<Section title="File">
				<Mono>{file.path}</Mono>
			</Section>
			<Section title={`Imports: ${file.imports.length}`}>
				{file.imports.map((entry) => (
					<p
						key={`${entry.line}:${entry.specifier}`}
						className="tr-text-metadata text-text-default"
					>
						<span className="text-text-subtle">L{entry.line}</span> <Mono>{entry.specifier}</Mono>
						{entry.bypass && <span className="text-feedback-error"> barrel bypass</span>}
					</p>
				))}
			</Section>
			<Section title={`Imported by (this module): ${importers.length}`}>
				{importers.map((other) => (
					<Mono key={other.path}>{other.path}</Mono>
				))}
			</Section>
		</>
	);
};

export const EdgeDetail = ({ edge, at }: { edge: LevelEdge; at: number }) => {
	const { value, loading, error } = useActionResult(
		"sites",
		{ pairs: edge.pairs, at },
		edge.pairs.length > 0,
		parseSites,
	);
	return (
		<>
			<Section title="Edge">
				<span className="tr-text-ui text-text-default">
					{edge.state === "unused" ? "declared but unused" : edge.state} · {edge.imports} import
					{edge.imports === 1 ? "" : "s"}
					{edge.bypass > 0 ? ` · ${edge.bypass} barrel bypass` : ""}
				</span>
			</Section>
			<Section title="Import sites">
				{edge.pairs.length === 0 && (
					<span className="tr-text-metadata text-text-muted">
						No imports: the specs declare this edge, the code never uses it.
					</span>
				)}
				{loading && <span className="tr-text-metadata text-text-muted">Loading…</span>}
				{error && <span className="tr-text-metadata text-feedback-error">{error}</span>}
				<ul data-testid="railmap-sites" className="flex flex-col gap-4">
					{value?.sites.map((site) => (
						<li key={`${site.file}:${site.line}:${site.specifier}`} className="flex flex-col">
							<Mono>
								{site.file}:{site.line}
							</Mono>
							<span className="tr-text-metadata text-text-muted">
								{site.specifier}
								{site.bypass && <span className="text-feedback-error"> · barrel bypass</span>}
							</span>
						</li>
					))}
				</ul>
				{value && value.total > value.sites.length && (
					<span className="tr-text-metadata text-text-subtle">
						showing {value.sites.length} of {value.total}
					</span>
				)}
			</Section>
		</>
	);
};
