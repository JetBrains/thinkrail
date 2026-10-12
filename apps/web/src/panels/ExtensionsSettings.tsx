import type { ExtensionCatalogEntry } from "@thinkrail/contracts";
import { Switch } from "@thinkrail/ui/switch";
import { useEffect, useState } from "react";
import { LoadingRegion } from "@/components/Skeleton";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";

export function ExtensionsCatalog({
	entries,
	disabled,
	onToggle,
}: {
	entries: readonly ExtensionCatalogEntry[] | "loading" | "failed";
	disabled: readonly string[];
	onToggle: (name: string, enabled: boolean) => void;
}) {
	if (entries === "loading") return <LoadingRegion rows={2} className="py-8" />;
	if (entries === "failed" || entries.length === 0) {
		return (
			<p
				data-testid={entries === "failed" ? "extensions-failed" : "extensions-empty"}
				className="rounded-sm border border-border-default bg-container-elevated-bg px-12 py-8 text-text-muted tr-text-metadata"
			>
				{entries === "failed"
					? "Couldn't load the extensions from this host."
					: "This host has no ThinkRail extensions registered."}
			</p>
		);
	}
	return (
		<ul className="flex flex-col divide-y divide-border-default rounded-sm border border-border-default bg-control-bg">
			{entries.map((entry) => {
				const enabled = !disabled.includes(entry.name);
				return (
					<li
						key={entry.name}
						data-testid={`extension-row-${entry.name}`}
						className="flex items-start justify-between gap-12 px-12 py-8"
					>
						<div className="flex min-w-0 flex-col gap-4">
							<span className="tr-title-compact text-text-default">{entry.title}</span>
							{entry.description ? (
								<span className="text-text-muted tr-text-metadata">{entry.description}</span>
							) : null}
							{entry.tools.length > 0 ? (
								<span className="flex flex-wrap gap-4">
									{entry.tools.map((tool) => (
										<code
											key={tool}
											data-testid={`extension-tool-${tool}`}
											className="rounded-full bg-control-bg-selected px-8 text-text-muted tr-text-metadata"
										>
											{tool}
										</code>
									))}
								</span>
							) : null}
						</div>
						<Switch
							checked={enabled}
							label={`Enable ${entry.title}`}
							testId={`extension-toggle-${entry.name}`}
							onCheckedChange={(next) => onToggle(entry.name, next)}
						/>
					</li>
				);
			})}
		</ul>
	);
}

export function ExtensionsSettings() {
	const disabled = useAppStore((state) => state.disabledExtensions);
	const [entries, setEntries] = useState<ExtensionCatalogEntry[] | "loading" | "failed">("loading");

	useEffect(() => {
		let current = true;
		getTransport()
			.request("extension.list", {})
			.then((catalog) => {
				if (current) setEntries(catalog);
			})
			.catch(() => {
				if (current) setEntries("failed");
			});
		return () => {
			current = false;
		};
	}, []);

	const toggle = (name: string, enabled: boolean) => {
		const next = enabled
			? disabled.filter((candidate) => candidate !== name)
			: [...disabled.filter((candidate) => candidate !== name), name];
		getTransport()
			.request("settings.update", { config: { disabledExtensions: next } })
			.catch(() => toast.error("Couldn't change the extension"));
	};

	return (
		<section data-testid="settings-extensions" className="flex flex-col gap-16">
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">Extensions</h3>
				<p className="text-text-muted tr-text-metadata">
					The ThinkRail extensions this host gives the agent. Turning one off removes its tools from
					new chats and from open chats once their current turn ends; past results still render.
					Your choice is saved on the host and follows you across devices.
				</p>
			</div>
			<ExtensionsCatalog entries={entries} disabled={disabled} onToggle={toggle} />
		</section>
	);
}
