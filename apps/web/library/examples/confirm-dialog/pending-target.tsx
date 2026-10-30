import { RiDeleteBinLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { useRef, useState } from "react";
import { ConfirmDialog } from "@/panels/ConfirmDialog";

interface Server {
	name: string;
	source: string;
}

const initial: Server[] = [
	{ name: "github", source: "~/.pi/agent/mcp.json" },
	{ name: "linear", source: ".pi/mcp.json" },
];

export default function PendingTarget() {
	const t = useT();
	const [servers, setServers] = useState(initial);
	const [removing, setRemoving] = useState<Server | null>(null);
	const list = useRef<HTMLDivElement>(null);
	const opener = useRef<HTMLButtonElement | null>(null);
	return (
		<div ref={list} className="flex w-full flex-col gap-4">
			{servers.map((server) => (
				<div key={server.name} className="flex items-center gap-8 tr-text-ui">
					<span className="flex-1">{server.name}</span>
					<IconButton
						icon={RiDeleteBinLine}
						label={t("common.remove")}
						onClick={(event) => {
							opener.current = event.currentTarget;
							setRemoving(server);
						}}
					/>
				</div>
			))}
			<ConfirmDialog
				open={removing !== null}
				onOpenChange={(open) => {
					if (!open) setRemoving(null);
				}}
				title={t("mcp.remove.title", { name: removing?.name ?? "" })}
				description={
					removing ? t("mcp.remove.description", { source: removing.source }) : undefined
				}
				confirmLabel={t("common.remove")}
				destructive
				confirmTestId="mcp-remove-confirm"
				onClosedAutoFocus={() => {
					const target = opener.current?.isConnected ? opener.current : null;
					(target ?? list.current?.querySelector("button"))?.focus();
				}}
				onConfirm={() => {
					const row = removing;
					if (!row) return;
					const rest = servers.filter((server) => server.name !== row.name);
					setServers(rest.length > 0 ? rest : initial);
				}}
			/>
		</div>
	);
}
