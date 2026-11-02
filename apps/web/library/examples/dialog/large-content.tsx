import { RiFileTextLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@thinkrail/ui/dialog";

const lines = Array.from({ length: 80 }, (_, index) => `[${index + 1}] list_issues → 200 OK`);

export default function LargeContent() {
	const t = useT();
	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button variant="ghost" size="s" iconLeft={RiFileTextLine}>
					{t("mcp.fullOutput.title")}
				</Button>
			</DialogTrigger>
			<DialogContent className="max-h-[85vh] max-w-3xl">
				<DialogHeader className="pr-24">
					<DialogTitle>{t("mcp.fullOutput.title")}</DialogTitle>
					<DialogDescription className="truncate">github · list_issues</DialogDescription>
				</DialogHeader>
				<pre className="min-h-0 overflow-auto tr-code-text">{lines.join("\n")}</pre>
			</DialogContent>
		</Dialog>
	);
}
