import {
	RiCheckboxCircleFill as Selected,
	RiCheckboxBlankCircleLine as Unselected,
} from "@remixicon/react";
import type { Project, ProjectGroupImport, ProjectGroupScan } from "@thinkrail/contracts";
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
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";
import { errorText, getTransport } from "../transport";

const FIELD_CLASS =
	"w-full min-w-0 rounded-sm border border-control-border-default bg-control-bg px-12 py-8 tr-text-ui text-text-default outline-none placeholder:text-text-muted focus-visible:focus-ring focus-visible:border-control-border-active disabled:text-control-disabled-text";

/** Confirms the repositories a folder scan found and imports the kept ones as one project group. */
export function ImportProjectGroupDialog({
	scan,
	onClose,
	onImported,
}: {
	scan: ProjectGroupScan;
	onClose: () => void;
	onImported: (projects: Project[]) => void;
}) {
	const t = useT();
	const [kept, setKept] = useState(() => new Set(scan.repositories.map((repo) => repo.path)));
	const [name, setName] = useState(scan.name);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [failed, setFailed] = useState<ProjectGroupImport["failed"] | null>(null);
	const count = kept.size;

	const toggle = (path: string) =>
		setKept((current) => {
			const next = new Set(current);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});

	const submit = async () => {
		if (count === 0 || busy) return;
		setBusy(true);
		setError(null);
		let result: ProjectGroupImport;
		try {
			result = await getTransport().request("project.importGroup", {
				root: scan.root,
				paths: scan.repositories.map((repo) => repo.path).filter((path) => kept.has(path)),
				name,
			});
		} catch (err) {
			setBusy(false);
			setError(errorText(err, t("panels.importGroup.importFailed")));
			return;
		}
		setBusy(false);
		if (result.projects.length > 0) onImported(result.projects);
		if (result.failed.length === 0) onClose();
		else setFailed(result.failed);
	};

	const label = (path: string) => path || t("panels.importGroup.folderItself");

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy) onClose();
			}}
		>
			<DialogContent
				hideClose={busy}
				data-testid="import-group-dialog"
				className="max-w-[32rem] gap-12"
			>
				<DialogHeader>
					<DialogTitle>{t("panels.importGroup.title")}</DialogTitle>
					<DialogDescription>
						{t("panels.importGroup.description", { path: scan.root })}
					</DialogDescription>
				</DialogHeader>
				{failed ? (
					<div className="flex flex-col gap-8" data-testid="import-group-failures">
						<p role="alert" className="tr-text-ui text-feedback-error">
							{t("panels.importGroup.failed")}
						</p>
						<ul className="flex max-h-320 flex-col gap-4 overflow-auto">
							{failed.map((failure) => (
								<li key={failure.path} className="flex flex-col gap-2">
									<span className="tr-code-text text-text-default">{label(failure.path)}</span>
									<span className="whitespace-pre-wrap break-words tr-text-metadata text-text-muted">
										{failure.reason}
									</span>
								</li>
							))}
						</ul>
						<DialogFooter>
							<Button data-testid="import-group-done" onClick={onClose}>
								{t("panels.importGroup.done")}
							</Button>
						</DialogFooter>
					</div>
				) : (
					<form
						className="flex flex-col gap-12"
						onSubmit={(event) => {
							event.preventDefault();
							void submit();
						}}
					>
						<fieldset disabled={busy} className="flex min-w-0 flex-col gap-12">
							<label htmlFor="import-group-name" className="flex flex-col gap-4">
								<span className="tr-title-compact">{t("panels.importGroup.name")}</span>
								<input
									id="import-group-name"
									data-testid="import-group-name"
									autoComplete="off"
									spellCheck={false}
									value={name}
									onChange={(event) => setName(event.target.value)}
									className={FIELD_CLASS}
								/>
							</label>
							<div className="flex flex-col gap-4">
								<span className="tr-title-compact">{t("panels.importGroup.repositories")}</span>
								{scan.repositories.length === 0 ? (
									<p className="tr-text-metadata text-text-muted">{t("panels.importGroup.none")}</p>
								) : (
									<div
										role="listbox"
										aria-multiselectable="true"
										aria-label={t("panels.importGroup.repositories")}
										className="flex max-h-320 flex-col gap-2 overflow-auto"
									>
										{scan.repositories.map((repo) => {
											const checked = kept.has(repo.path);
											const Icon = checked ? Selected : Unselected;
											return (
												<button
													key={repo.path}
													type="button"
													role="option"
													aria-selected={checked}
													data-testid="import-group-repository"
													data-path={repo.path}
													onClick={() => toggle(repo.path)}
													className="flex w-full min-w-0 items-center gap-6 rounded-sm px-4 py-4 text-left tr-text-ui text-text-default hover:bg-control-bg-hovered"
												>
													<Icon
														className={cn(
															"size-14 shrink-0",
															checked ? "text-primary" : "text-text-muted",
														)}
														aria-hidden="true"
													/>
													<span className="truncate tr-code-text">{label(repo.path)}</span>
												</button>
											);
										})}
									</div>
								)}
								{scan.truncated ? (
									<p className="tr-text-metadata text-text-subtle">
										{t("panels.importGroup.truncated")}
									</p>
								) : null}
							</div>
						</fieldset>
						{error ? (
							<p
								data-testid="import-group-error"
								role="alert"
								className="whitespace-pre-wrap break-words text-feedback-error tr-text-ui"
							>
								{error}
							</p>
						) : null}
						<DialogFooter>
							<Button variant="outline" disabled={busy} onClick={onClose}>
								{t("common.cancel")}
							</Button>
							<Button
								type="submit"
								data-testid="import-group-submit"
								disabled={count === 0 || busy}
							>
								{busy
									? t("panels.importGroup.importing")
									: t("panels.importGroup.import", { count })}
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}
