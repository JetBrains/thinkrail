import { RiChat2Line, RiFolderLine } from "@remixicon/react";
import { Command, CommandGroup, CommandItem, CommandList } from "@thinkrail/ui/command";
import { AttentionDot } from "@/components/AttentionDot";
import { RunningIcon } from "@/components/RunningIcon";

const PROJECTS = [
	{
		id: "thinkrail",
		name: "thinkrail",
		sessions: [
			{ id: "s1", title: "Fix the flaky login test", running: false },
			{ id: "s2", title: "Document the command list", running: true },
		],
	},
	{
		id: "website",
		name: "website",
		sessions: [{ id: "s3", title: "Update the pricing page", running: true }],
	},
];

export default function SessionSwitcher() {
	return (
		<Command className="w-full max-w-sm" loop shouldFilter={false} vimBindings={false}>
			<CommandList>
				{PROJECTS.map((project) => (
					<CommandGroup
						key={project.id}
						heading={
							<span className="flex items-center gap-4">
								<RiFolderLine className="size-14 shrink-0 text-text-muted" />
								<span className="min-w-0 flex-1 truncate">{project.name}</span>
								{project.sessions.some((session) => !session.running) ? <AttentionDot /> : null}
							</span>
						}
					>
						{project.sessions.map((session) => (
							<CommandItem
								key={session.id}
								value={session.id}
								className="group gap-8 pl-24"
								onSelect={() => {}}
							>
								{session.running ? (
									<RunningIcon className="size-14 text-text-muted group-data-[selected=true]:text-primary" />
								) : (
									<RiChat2Line className="size-14 shrink-0 text-text-muted group-data-[selected=true]:text-primary" />
								)}
								<span className="min-w-0 flex-1 truncate group-data-[selected=true]:text-primary">
									{session.title}
								</span>
								{session.running ? null : <AttentionDot />}
							</CommandItem>
						))}
					</CommandGroup>
				))}
			</CommandList>
		</Command>
	);
}
