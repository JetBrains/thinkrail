import { RiEyeLine, RiMore2Line, RiUploadCloud2Line } from "@remixicon/react";
import type { PanelHost } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
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
import { useId, useState } from "react";
import { FIELD } from "./CardParts";
import { type PublishedSnapshot, peekSnapshot, publishSnapshot } from "./roadmapApi";

const DEFAULT_PATH = "ROADMAP.md";

/** The board header's overflow menu: Publish roadmap snapshot…. */
export function BoardMoreMenu({ onPublish }: { onPublish: () => void }) {
	const t = useT();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<IconButton
					icon={RiMore2Line}
					size="s"
					label={t("board.more")}
					data-testid="board-more-menu"
				/>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem data-testid="board-publish-open" onSelect={onPublish}>
					<RiUploadCloud2Line aria-hidden className="size-16" />
					{t("board.publish.open")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function errorText(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Publish roadmap snapshot, mounted while open: writes the roadmap's markdown into the project's Default
 * workspace at the board's path (editable, remembered), then says to commit it and offers it in Peek.
 */
export function PublishDialog({
	host,
	projectId,
	path,
	onClose,
}: {
	host: PanelHost;
	projectId: string;
	/** The board's remembered snapshot path. */
	path: string | undefined;
	onClose: () => void;
}) {
	const t = useT();
	const id = useId();
	const [draft, setDraft] = useState(path ?? DEFAULT_PATH);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [written, setWritten] = useState<PublishedSnapshot | null>(null);
	const publish = () => {
		const target = draft.trim();
		if (!target || busy) return;
		setBusy(true);
		setError(null);
		publishSnapshot(host, projectId, target)
			.then(setWritten, (failure: unknown) =>
				setError(errorText(failure, t("board.error.unknown"))),
			)
			.finally(() => setBusy(false));
	};
	return (
		<Dialog open onOpenChange={(next) => !next && onClose()}>
			<DialogContent data-testid="board-publish-dialog">
				<DialogHeader>
					<DialogTitle>{t("board.publish.title")}</DialogTitle>
					<DialogDescription>{t("board.publish.description")}</DialogDescription>
				</DialogHeader>
				{written ? (
					<p
						data-testid="board-publish-done"
						role="status"
						className="tr-text-ui text-text-default"
					>
						{t("board.publish.done", { path: written.path })}
					</p>
				) : (
					<form
						id={`${id}-form`}
						className="flex flex-col gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							publish();
						}}
					>
						<label htmlFor={`${id}-path`} className="tr-text-metadata text-text-muted">
							{t("board.publish.path")}
						</label>
						<input
							id={`${id}-path`}
							data-testid="board-publish-path"
							value={draft}
							onChange={(event) => setDraft(event.currentTarget.value)}
							className={FIELD}
						/>
						<span className="tr-text-metadata text-text-subtle">{t("board.publish.pathHint")}</span>
						{error ? (
							<p
								role="alert"
								data-testid="board-publish-error"
								className="tr-text-metadata text-feedback-error wrap-anywhere"
							>
								{error}
							</p>
						) : null}
					</form>
				)}
				<DialogFooter>
					{written ? (
						<>
							<Button
								variant="outline"
								size="m"
								iconLeft={RiEyeLine}
								data-testid="board-publish-peek"
								onClick={() => {
									peekSnapshot(host, written);
									onClose();
								}}
							>
								{t("board.publish.peek")}
							</Button>
							<Button variant="primary" size="m" onClick={onClose}>
								{t("board.publish.close")}
							</Button>
						</>
					) : (
						<>
							<Button variant="ghost" size="m" onClick={onClose}>
								{t("board.newCard.cancel")}
							</Button>
							<Button
								type="submit"
								form={`${id}-form`}
								variant="primary"
								size="m"
								iconLeft={RiUploadCloud2Line}
								loading={busy}
								disabled={!draft.trim()}
								data-testid="board-publish-submit"
							>
								{t("board.publish.submit")}
							</Button>
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
