import { RiChat2Line } from "@remixicon/react";
import { Command, CommandItem, CommandList } from "@thinkrail/ui/command";
import { AttentionDot } from "@/components/AttentionDot";
import { RunningIcon } from "@/components/RunningIcon";

const SESSIONS = [
	{ id: "s1", title: "Fix the flaky login test", running: true },
	{ id: "s2", title: "Document the command list", running: true },
	{ id: "s3", title: "Update the pricing page", running: false },
];

export default function CommandRow() {
	return (
		<Command className="w-full max-w-sm" loop shouldFilter={false} vimBindings={false}>
			<CommandList>
				{SESSIONS.map((session) => (
					<CommandItem
						key={session.id}
						value={session.id}
						className="group gap-8"
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
			</CommandList>
		</Command>
	);
}
