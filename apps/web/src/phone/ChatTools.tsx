import { RiBookOpenLine, RiRefreshLine, RiShieldCheckLine } from "@remixicon/react";
import { ResourcesButton } from "@thinkrail/chat-ui/resources/ResourcesButton";
import {
	isLiveState,
	type ResourceActions,
	ResourceRow,
	resourceId,
	resourceState,
	sortLive,
	sortSettled,
	toResources,
} from "@thinkrail/chat-ui/resources/resourceRow";
import {
	ALL_PLUGINS_GROUP,
	groupSkills,
	isLeadingSkillGroup,
	type SkillGroup,
} from "@thinkrail/chat-ui/skillGroups";
import {
	isSkillGroupEnabled,
	type Project,
	type SessionResources,
	type SkillCatalogEntry,
	WS_CHANNELS,
} from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import type { DeviceWireClient } from "@thinkrail/remote-client";
import { Button } from "@thinkrail/ui/button";
import { Switch } from "@thinkrail/ui/switch";
import { type ReactNode, useState } from "react";
import { useNow } from "../components/useNow";
import { reasonOf } from "./async";
import { Loader, Notice } from "./layout";
import { PageSheet } from "./sheet";
import { useHostRequest } from "./useHostRequest";

const RESOURCES_PUSH = [WS_CHANNELS.sessionResourcesChanged];

/** The IDE toolbar's Resources: this chat's background commands and subagents, live first; a subagent opens its transcript. */
export function ResourcesTool({
	client,
	workspaceId,
	sessionId,
	readOnly,
	onOpenSubagent,
}: {
	client: DeviceWireClient | null;
	workspaceId: string;
	sessionId: string;
	readOnly: boolean;
	onOpenSubagent: (childSessionId: string) => void;
}) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const loaded = useHostRequest<SessionResources>(
		client,
		"session.resources",
		{ workspaceId, sessionId },
		"",
		RESOURCES_PUSH,
	);
	const resources =
		loaded.kind === "ready" ? toResources(loaded.value.commands, loaded.value.subagents) : [];
	const live = sortLive(resources.filter((resource) => isLiveState(resourceState(resource))));
	const settled = sortSettled(
		resources.filter((resource) => !isLiveState(resourceState(resource))),
	);
	const now = useNow();
	const [actions, setActions] = useState<ResourceActions>({});
	const stop = (key: string, method: string, params: Record<string, string>): void => {
		if (!client || actions[key]?.pending) return;
		setActions((current) => ({ ...current, [key]: { pending: true, error: null } }));
		client
			.request(method, params)
			.then(() => null, reasonOf)
			.then((error) => setActions((current) => ({ ...current, [key]: { pending: false, error } })));
	};
	const section = (title: string, rows: typeof resources): ReactNode =>
		rows.length > 0 ? (
			<section className="flex flex-col">
				<h3 className="m-0 px-16 pt-12 pb-4 text-text-subtle tr-text-eyebrow">{title}</h3>
				<ul className="m-0 list-none px-8 py-0">
					{rows.map((resource) => (
						<ResourceRow
							key={resourceId(resource)}
							resource={resource}
							now={now}
							authoritative={!readOnly}
							action={actions[resourceId(resource)]}
							onSelect={() => {
								if (resource.kind !== "subagent") return;
								setOpen(false);
								onOpenSubagent(resource.summary.childSessionId);
							}}
							onStop={() =>
								resource.kind === "command"
									? stop(resourceId(resource), "backgroundCommand.stop", {
											workspaceId,
											sessionId,
											commandId: resource.summary.id,
										})
									: stop(resourceId(resource), "subagent.stop", {
											workspaceId,
											parentSessionId: sessionId,
											childSessionId: resource.summary.childSessionId,
										})
							}
						/>
					))}
				</ul>
			</section>
		) : null;
	return (
		<>
			<ResourcesButton
				activeCount={loaded.kind === "ready" ? live.length : null}
				open={open}
				onClick={() => setOpen(true)}
			/>
			<PageSheet
				open={open}
				onOpenChange={setOpen}
				title={t("resources.inspector.title")}
				autoFocus={false}
				testId="resources-sheet"
			>
				{loaded.kind === "failed" ? (
					<Notice text={t("resources.inspector.refreshUnavailable")} alert />
				) : loaded.kind === "loading" ? (
					<Notice text={t("resources.inspector.loading")} />
				) : resources.length === 0 ? (
					<Notice text={t("resources.inspector.empty")} />
				) : (
					<>
						{section(t("resources.inspector.active", { count: live.length }), live)}
						{section(t("resources.inspector.finishedSection"), settled)}
					</>
				)}
			</PageSheet>
		</>
	);
}

/**
 * The IDE's Skills dialog on a phone: the catalog this worktree's chat loads, grouped by tier with the group, All plugins
 * and per-skill switches (a skill's switch is this worktree's override), Enable for a skill awaiting confirmation, and
 * Reload to apply the changes to this chat. Read-only phones see the switches without changing them.
 */
export function SkillsTool({
	client,
	project,
	workspaceId,
	sessionId,
	streaming,
	readOnly,
	otherAgentSkills,
}: {
	client: DeviceWireClient | null;
	project: Project;
	workspaceId: string;
	sessionId: string;
	streaming: boolean;
	readOnly: boolean;
	otherAgentSkills: boolean;
}) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const [changes, setChanges] = useState(0);
	const [groupState, setGroupState] = useState<Pick<Project, "disabledGroups" | "enabledGroups">>(
		() => project,
	);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const [reloaded, setReloaded] = useState(false);
	const loaded = useHostRequest<SkillCatalogEntry[]>(
		client,
		"skills.state",
		{ workspaceId },
		String(changes),
	);
	const run = (
		request: () => Promise<unknown> | undefined,
		failed: string,
		after?: () => void,
	): void => {
		if (busy || !client) return;
		setBusy(true);
		setFailure(null);
		setReloaded(false);
		Promise.resolve(request())
			.then(() => {
				after?.();
				setChanges((count) => count + 1);
			})
			.catch(() => setFailure(failed))
			.finally(() => setBusy(false));
	};
	const setGroupEnabled = (group: string, enabled: boolean): void =>
		run(
			() =>
				client
					?.request<Project>("project.setGroupEnabled", { id: project.id, group, enabled })
					.then((next) => setGroupState(next)),
			t("chat.skills.groupUpdateFailed"),
		);
	const setSkillEnabled = (name: string, enabled: boolean): void =>
		run(
			() =>
				client?.request("workspace.setSkillOverride", {
					id: workspaceId,
					name,
					override: enabled ? "on" : "off",
				}),
			t("chat.skills.skillUpdateFailed"),
		);
	const acknowledge = (name: string): void =>
		run(
			() => client?.request("project.acknowledgeSkills", { id: project.id, names: [name] }),
			t("chat.skills.acknowledgeFailed"),
		);
	const reload = (): void =>
		run(
			() => client?.request("session.reloadResources", { sessionId }),
			t("chat.skills.reloadFailed"),
			() => setReloaded(true),
		);

	const entries = loaded.kind === "ready" ? loaded.value : [];
	const groups = groupSkills(t, entries);
	const groupEnabled = (key: string) => isSkillGroupEnabled(groupState, key, otherAgentSkills);
	const pluginsDisabled = !groupEnabled(ALL_PLUGINS_GROUP);
	const hasPlugins = groups.some((group) => group.isPlugin);
	const locked = readOnly || busy;

	const renderGroup = (group: SkillGroup): ReactNode => {
		const lockedByMaster = group.isPlugin && pluginsDisabled;
		const groupOn = !lockedByMaster && groupEnabled(group.key);
		return (
			<section key={group.key} data-testid="skill-group" data-group={group.key} data-on={groupOn}>
				<div className="flex min-h-touch items-center gap-8 border-y border-border-default bg-container-header-bg px-16 py-8">
					<span className="shrink-0 text-text-default tr-text-eyebrow">{group.label}</span>
					<span className="min-w-0 flex-1 truncate text-text-muted tr-text-metadata">
						{group.hint}
					</span>
					<span className="shrink-0 rounded-full bg-control-bg-selected px-8 text-text-muted tr-text-metadata">
						{group.items.length}
					</span>
					<Switch
						checked={groupOn}
						disabled={locked || lockedByMaster}
						label={t("chat.skills.enableGroup", { group: group.label })}
						testId="group-toggle"
						onCheckedChange={(enabled) => setGroupEnabled(group.key, enabled)}
					/>
				</div>
				<ul className="m-0 ml-16 list-none divide-y divide-border-default border-l border-border-default p-0">
					{group.items.map((skill) => (
						<li
							key={`${group.key}:${skill.name}`}
							data-testid="skill-row"
							data-skill={skill.name}
							data-decision={skill.decision}
							className="flex items-center gap-12 py-12 pr-16 pl-12"
						>
							<span className="flex min-w-0 flex-1 flex-col gap-4">
								<span className="truncate text-text-default tr-title-card">{skill.name}</span>
								{skill.decision === "untrusted" ? (
									<span className="text-feedback-warning tr-text-metadata">
										{t("chat.skills.blockedByTrust")}
									</span>
								) : skill.description ? (
									<span className="line-clamp-2 text-text-muted tr-text-metadata">
										{skill.description}
									</span>
								) : null}
							</span>
							{skill.decision === "pending-ack" ? (
								<Button
									size="m"
									iconLeft={RiShieldCheckLine}
									data-testid="skill-ack"
									disabled={locked}
									className="h-touch"
									onClick={() => acknowledge(skill.name)}
								>
									{t("chat.skills.enable")}
								</Button>
							) : (
								<Switch
									checked={groupOn && skill.decision === "load"}
									disabled={locked || !groupOn || skill.decision === "untrusted"}
									label={t("chat.skills.enableSkill", { skill: skill.name })}
									testId="skill-toggle"
									onCheckedChange={(enabled) => setSkillEnabled(skill.name, enabled)}
								/>
							)}
						</li>
					))}
				</ul>
			</section>
		);
	};

	return (
		<>
			<Button
				variant="ghost"
				size="m"
				iconLeft={RiBookOpenLine}
				data-testid="open-skills"
				selected={open}
				onClick={() => setOpen(true)}
			>
				{t("chat.skills.title")}
			</Button>
			<PageSheet
				open={open}
				onOpenChange={setOpen}
				title={t("chat.skills.title")}
				autoFocus={false}
				testId="skills-sheet"
			>
				{readOnly ? null : (
					<div className="flex items-center gap-8 border-b border-border-muted px-16 py-8">
						<span
							role={failure ? "alert" : undefined}
							className={
								failure
									? "min-w-0 flex-1 text-feedback-error tr-text-metadata"
									: "min-w-0 flex-1 text-text-muted tr-text-metadata"
							}
						>
							{failure ??
								(reloaded
									? t("chat.skills.reloadedBody")
									: streaming
										? t("chat.skills.reloadBusy")
										: t("chat.skills.reloadHint"))}
						</span>
						<Button
							variant="outline"
							size="m"
							iconLeft={RiRefreshLine}
							data-testid="skills-reload"
							disabled={busy || streaming}
							className="h-touch shrink-0"
							onClick={reload}
						>
							{t("chat.skills.reload")}
						</Button>
					</div>
				)}
				{loaded.kind === "loading" ? (
					<Loader text={t("mobile.list.loading")} />
				) : loaded.kind === "failed" ? (
					<Notice text={t("mobile.list.failed", { reason: loaded.reason })} alert />
				) : entries.length === 0 ? (
					<Notice text={t("chat.skills.empty")} />
				) : (
					<>
						{groups.filter((group) => isLeadingSkillGroup(group.key)).map(renderGroup)}
						{hasPlugins ? (
							<div
								data-testid="skills-all-plugins"
								className="flex min-h-touch items-center gap-8 border-y border-border-default bg-container-header-bg px-16"
							>
								<span className="min-w-0 flex-1 text-text-default tr-text-eyebrow">
									{t("chat.skills.allPlugins")}
								</span>
								<Switch
									checked={!pluginsDisabled}
									disabled={locked}
									label={t("chat.skills.enableAllPlugins")}
									testId="all-plugins-toggle"
									onCheckedChange={(enabled) => setGroupEnabled(ALL_PLUGINS_GROUP, enabled)}
								/>
							</div>
						) : null}
						{groups.filter((group) => !isLeadingSkillGroup(group.key)).map(renderGroup)}
					</>
				)}
			</PageSheet>
		</>
	);
}
