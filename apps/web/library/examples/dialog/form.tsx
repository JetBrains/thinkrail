import { RiAddLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@thinkrail/ui/dialog";
import { Textarea } from "@thinkrail/ui/textarea";
import { useState } from "react";

export default function Form() {
	const t = useT();
	const [open, setOpen] = useState(false);
	const [body, setBody] = useState("");
	const close = (next: boolean) => {
		if (!next) setBody("");
		setOpen(next);
	};
	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogTrigger asChild>
				<Button variant="outline" iconLeft={RiAddLine}>
					{t("chat.templateEditor.newTitle")}
				</Button>
			</DialogTrigger>
			<DialogContent aria-describedby={undefined} className="max-w-xl gap-12">
				<DialogHeader>
					<DialogTitle>{t("chat.templateEditor.newTitle")}</DialogTitle>
				</DialogHeader>
				<form
					className="flex flex-col gap-12"
					onSubmit={(event) => {
						event.preventDefault();
						close(false);
					}}
				>
					<label htmlFor="example-template-body" className="flex flex-col gap-4 tr-text-ui">
						{t("chat.templateEditor.body")}
						<Textarea
							id="example-template-body"
							autoFocus
							rows={6}
							value={body}
							onChange={(event) => setBody(event.target.value)}
							placeholder={t("chat.templateEditor.bodyPlaceholder")}
						/>
					</label>
					<DialogFooter>
						<Button variant="outline" onClick={() => close(false)}>
							{t("common.cancel")}
						</Button>
						<Button type="submit" disabled={!body.trim()}>
							{t("common.save")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
