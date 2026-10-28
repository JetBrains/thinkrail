import { RiArrowDownSLine as ChevronDown } from "@remixicon/react";
import type { Workspace } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { useEffect, useId, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { selectContextRepoProject, selectRepoProjects, useAppStore } from "../store";
import { continueChatInWorkspace } from "./chatActions";

/** Continue a chat without a project: pick the repository whose new workspace receives the agent's summary. */
export function ContinueChatDialog({
	chat,
	title,
	open,
	onOpenChange,
}: {
	chat: Workspace;
	title: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useT();
	const projects = useAppStore(useShallow(selectRepoProjects));
	const preferred = useAppStore(selectContextRepoProject);
	const [projectId, setProjectId] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	const labelId = useId();
	useEffect(() => {
		if (open) setProjectId(preferred?.id ?? projects[0]?.id ?? null);
	}, [open, preferred?.id, projects[0]?.id]);
	const selected = projects.find((project) => project.id === projectId) ?? null;

	const confirm = () => {
		if (!selected || sending) return;
		setSending(true);
		void continueChatInWorkspace(chat.id, selected.id).finally(() => {
			setSending(false);
			onOpenChange(false);
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent data-testid="continue-chat-dialog" className="max-w-[28rem]">
				<DialogHeader>
					<DialogTitle>{t("panels.chats.continueTitle", { name: title })}</DialogTitle>
					<DialogDescription>{t("panels.chats.continueDescription")}</DialogDescription>
				</DialogHeader>
				{projects.length === 0 ? (
					<p className="tr-text-ui text-text-muted">{t("panels.chats.continueNoProjects")}</p>
				) : (
					<div className="flex flex-col gap-4 tr-text-metadata text-text-muted">
						<span id={labelId}>{t("panels.chats.continueProject")}</span>
						<DropdownMenu>
							<DropdownMenuTrigger
								data-testid="continue-chat-project"
								aria-labelledby={labelId}
								className="flex h-32 items-center justify-between gap-8 rounded-sm border border-control-border-default bg-control-bg px-8 tr-text-ui text-text-default outline-none hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary"
							>
								<span className="truncate">{selected?.name ?? ""}</span>
								<ChevronDown className="size-14 shrink-0 text-text-subtle" />
							</DropdownMenuTrigger>
							<DropdownMenuContent align="start">
								{projects.map((project) => (
									<DropdownMenuItem
										key={project.id}
										data-testid="continue-chat-project-option"
										onSelect={() => setProjectId(project.id)}
									>
										{project.name}
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				)}
				<DialogFooter>
					<Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
						{t("common.cancel")}
					</Button>
					<Button
						type="button"
						data-testid="continue-chat-confirm"
						disabled={!selected || sending}
						onClick={confirm}
					>
						{t("panels.chats.continueConfirm")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
