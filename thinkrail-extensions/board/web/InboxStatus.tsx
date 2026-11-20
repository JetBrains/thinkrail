import { RiKanbanView2, RiQuestionLine } from "@remixicon/react";
import type { StatusItemProps } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { useState } from "react";
import { BOARD_VIEW } from "./api";
import { InboxRow, useInbox } from "./Inbox";

/** The topbar's "Needs you · N" across every open project; a click lists the cards and opens Board view. Absent at zero. */
export default function InboxStatus({ host }: StatusItemProps) {
	const t = useT();
	const items = useInbox(host);
	const [open, setOpen] = useState(false);
	if (items.length === 0) return null;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					tone="warning"
					size="m"
					iconLeft={RiQuestionLine}
					data-testid="board-inbox-status"
					data-count={items.length}
				>
					{t("board.inbox.title", { n: items.length })}
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				data-testid="board-inbox-popover"
				aria-label={t("board.inbox.label")}
				className="flex w-360 flex-col gap-8 p-8"
			>
				<span className="flex items-center gap-8 px-4">
					<span className="tr-text-emphasis text-feedback-warning">
						{t("board.inbox.title", { n: items.length })}
					</span>
					<span className="tr-text-metadata text-text-subtle">{t("board.inbox.allProjects")}</span>
					{host.scope ? (
						<Button
							variant="ghost"
							size="s"
							iconLeft={RiKanbanView2}
							data-testid="board-inbox-open-board"
							className="ml-auto"
							onClick={() => {
								host.openView(BOARD_VIEW);
								setOpen(false);
							}}
						>
							{t("board.inbox.openBoard")}
						</Button>
					) : null}
				</span>
				<ul className="flex max-h-360 flex-col gap-4 overflow-auto">
					{items.map((item) => (
						<InboxRow
							key={`${item.projectId}:${item.card.id}`}
							item={item}
							host={host}
							compact
							onAct={() => setOpen(false)}
						/>
					))}
				</ul>
			</PopoverContent>
		</Popover>
	);
}
