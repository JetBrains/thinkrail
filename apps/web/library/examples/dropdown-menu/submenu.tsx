import {
	RiExternalLinkLine,
	RiFileCopyLine,
	RiFolderOpenLine,
	RiMore2Line,
	RiPencilLine,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";

const editors = ["VS Code", "Cursor", "Zed"];

export default function Submenu() {
	const t = useT();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<IconButton
					size="s"
					icon={RiMore2Line}
					label={t("panels.projectTree.workspaceActions", { name: "feature-login" })}
				/>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuSub>
					<DropdownMenuSubTrigger>
						<RiExternalLinkLine />
						{t("panels.projectTree.openIn")}
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent>
						{editors.map((editor) => (
							<DropdownMenuItem key={editor} onSelect={() => {}}>
								{editor}
							</DropdownMenuItem>
						))}
					</DropdownMenuSubContent>
				</DropdownMenuSub>
				<DropdownMenuItem onSelect={() => {}}>
					<RiPencilLine />
					{t("common.rename")}
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => {}}>
					<RiFileCopyLine />
					{t("panels.projectTree.copyPath")}
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => {}}>
					<RiFolderOpenLine />
					{t("panels.projectTree.reveal")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
