import { RiChat2Line, RiFolderLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Command, CommandGroup, CommandItem, CommandList } from "@thinkrail/ui/command";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@thinkrail/ui/dialog";
import { useState } from "react";
import { AttentionDot } from "@/components/AttentionDot";

const PROJECTS = [
	{
		id: "thinkrail",
		name: "thinkrail",
		sessions: [
			{ id: "s1", title: "Fix the flaky login test", workspace: "fix-login" },
			{ id: "s2", title: "Document the command list", workspace: "command-docs" },
		],
	},
	{
		id: "website",
		name: "website",
		sessions: [{ id: "s3", title: "Update the pricing page", workspace: "pricing" }],
	},
];

export default function SessionPalette() {
	const t = useT();
	const [open, setOpen] = useState(false);
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="outline">{t("shell.sessionSwitcher.title")}</Button>
			</DialogTrigger>
			<DialogContent
				className="gap-0 overflow-hidden p-0"
				hideClose
				data-testid="session-palette"
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					document
						.querySelector<HTMLElement>('[data-testid="session-palette"] [cmdk-root]')
						?.focus();
				}}
			>
				<DialogTitle className="border-border-default border-b px-16 py-12">
					{t("shell.sessionSwitcher.title")}
				</DialogTitle>
				<Command className="bg-transparent" loop shouldFilter={false} vimBindings={false}>
					<CommandList className="px-8 pt-4 pb-8">
						{PROJECTS.map((project) => (
							<CommandGroup
								key={project.id}
								heading={
									<span className="flex h-28 items-center gap-4 px-4">
										<RiFolderLine className="size-14 shrink-0 text-text-muted" />
										<span className="min-w-0 flex-1 truncate">{project.name}</span>
									</span>
								}
							>
								{project.sessions.map((session) => (
									<CommandItem
										key={session.id}
										value={session.id}
										className="group gap-8 pl-24"
										onSelect={() => setOpen(false)}
									>
										<RiChat2Line className="size-14 shrink-0 text-text-muted group-data-[selected=true]:text-primary" />
										<span className="flex min-w-0 flex-1 flex-col">
											<span className="truncate group-data-[selected=true]:text-primary">
												{session.title}
											</span>
											<span className="truncate text-text-subtle tr-text-metadata">
												{session.workspace}
											</span>
										</span>
										<AttentionDot />
									</CommandItem>
								))}
							</CommandGroup>
						))}
					</CommandList>
				</Command>
			</DialogContent>
		</Dialog>
	);
}
