import { RiChat2Line as Chat, RiFolderLine as Folder } from "@remixicon/react";
import { Command, CommandGroup, CommandItem, CommandList } from "@thinkrail/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@thinkrail/ui/dialog";
import { useCallback } from "react";
import { AttentionDot } from "@/components/AttentionDot";
import { RunningIcon } from "@/components/RunningIcon";
import { useSessionSwitcher } from "./useSessionSwitcher";

export interface SessionSwitcherProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function SessionSwitcher({ open, onOpenChange }: SessionSwitcherProps) {
	const handleClose = useCallback(() => {
		onOpenChange(false);
	}, [onOpenChange]);

	const { groups, navigate } = useSessionSwitcher(open, handleClose);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="max-w-md gap-0 overflow-hidden p-0"
				hideClose
				data-testid="session-switcher"
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					document
						.querySelector<HTMLElement>('[data-testid="session-switcher"] [cmdk-root]')
						?.focus();
				}}
			>
				<DialogTitle className="border-border-default border-b px-16 py-12 tr-title-dialog text-text-default">
					Switch session
				</DialogTitle>
				<Command className="bg-transparent" loop shouldFilter={false} vimBindings={false}>
					<CommandList className="max-h-[min(60vh,420px)] px-8 pt-4 pb-8">
						{groups.length === 0 ? (
							<div className="px-8 py-12 text-center text-text-muted tr-text-ui">
								No active sessions
							</div>
						) : (
							groups.map((project) => (
								<CommandGroup
									key={project.projectId}
									heading={
										<div className="flex h-28 items-center gap-4 pr-4 pl-4">
											<Folder className="size-14 shrink-0 text-text-muted" />
											<span className="min-w-0 flex-1 truncate tr-text-ui text-text-muted">
												{project.projectName}
											</span>
											{project.needsAttention ? <AttentionDot /> : null}
										</div>
									}
								>
									{project.sessions.map((session) => {
										const isRunning = session.attention === "running";
										return (
											<CommandItem
												key={session.sessionId}
												value={session.sessionId}
												data-testid="session-switcher-row"
												data-session-id={session.sessionId}
												className="group min-h-28 gap-8 py-4 pr-4 pl-24"
												onSelect={() => navigate(session)}
											>
												{isRunning ? (
													<RunningIcon className="size-14 text-text-muted group-data-[selected=true]:text-primary" />
												) : (
													<Chat className="size-14 shrink-0 text-text-muted group-data-[selected=true]:text-primary" />
												)}
												<span className="flex min-w-0 flex-1 flex-col">
													<span className="truncate tr-text-ui text-text-default leading-tight group-data-[selected=true]:text-primary">
														{session.chatTitle || "Untitled chat"}
													</span>
													{session.workspaceName ? (
														<span className="truncate text-text-subtle tr-text-metadata leading-tight">
															{session.workspaceName}
														</span>
													) : null}
												</span>
												{isRunning ? null : <AttentionDot />}
											</CommandItem>
										);
									})}
								</CommandGroup>
							))
						)}
					</CommandList>
				</Command>
			</DialogContent>
		</Dialog>
	);
}
