import { RiFlag2Line } from "@remixicon/react";
import type { ContainerSectionProps } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import { AutopilotFacts } from "./AutopilotParts";
import { initiativePeekEntry, loadContainerAutopilot } from "./roadmapApi";
import { useAnyBoardChanged, useHostQuery } from "./useHostQuery";

/** The container overview's board section: the initiative it runs, with autopilot's state and room. */
export default function ContainerAutopilot({ host, containerId }: ContainerSectionProps) {
	const t = useT();
	const autopilot = useHostQuery(`container:${containerId}`, (signal) =>
		loadContainerAutopilot(host, containerId, signal),
	);
	useAnyBoardChanged(host, autopilot.reload);
	const view = autopilot.state.kind === "ready" ? autopilot.state.value : null;
	if (!view) return null;
	const name = t("board.card.blockOption", { id: view.initiativeId, title: view.title });
	return (
		<section
			data-testid="board-container-initiative"
			data-initiative-id={view.initiativeId}
			aria-label={t("board.autopilot.containerSection")}
			className="flex flex-col gap-4 rounded-md border border-border-default p-8"
		>
			<span className="flex min-w-0 items-center gap-4">
				<RiFlag2Line aria-hidden className="size-14 shrink-0 text-text-muted" />
				<span className="shrink-0 tr-text-eyebrow text-text-muted">
					{t("board.autopilot.initiative")}
				</span>
				{host.scope ? (
					<button
						type="button"
						data-testid="board-container-initiative-open"
						onClick={() =>
							host.peek(
								initiativePeekEntry(view.projectId, { id: view.initiativeId, title: view.title }),
							)
						}
						className="min-w-0 truncate rounded-sm text-left tr-text-ui text-text-default hover:underline focus-visible:focus-ring"
					>
						{name}
					</button>
				) : (
					<span className="min-w-0 truncate tr-text-ui text-text-default">{name}</span>
				)}
			</span>
			<AutopilotFacts view={view} />
		</section>
	);
}
