import type { SpecGraphNode } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";

export interface SpecTreeNode {
	node: SpecGraphNode;
	children: SpecTreeNode[];
}

interface SpecRole {
	label: MessageKey;
	tag: MessageKey;
}

const SPEC_ROLES = {
	"goal-and-requirements": { label: "panels.specTree.goal", tag: "panels.specTree.goalTag" },
	"architecture-design": {
		label: "panels.specTree.architecture",
		tag: "panels.specTree.architectureTag",
	},
	"module-design": { label: "panels.specTree.module", tag: "panels.specTree.moduleTag" },
	"submodule-design": { label: "panels.specTree.submodule", tag: "panels.specTree.submoduleTag" },
	"task-spec": { label: "panels.specTree.task", tag: "panels.specTree.taskTag" },
} as const satisfies Record<string, SpecRole>;

type KnownSpecType = keyof typeof SPEC_ROLES;

function isKnownSpecType(type: string): type is KnownSpecType {
	return Object.hasOwn(SPEC_ROLES, type);
}

export function specRoleLabel(t: Translator, type: string): string {
	if (isKnownSpecType(type)) return t(SPEC_ROLES[type].label);
	const words = type.split(/[-_\s]+/).filter(Boolean);
	if (words.length === 0) return t("panels.specTree.spec");
	return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

export function specDisplayTitle(title: string): string {
	return title.replace(/\s+[—–]\s+/g, " · ");
}

export function specRoleTag(t: Translator, type: string): string {
	return isKnownSpecType(type) ? t(SPEC_ROLES[type].tag) : specRoleLabel(t, type).toUpperCase();
}

export function buildSpecTree(nodes: SpecGraphNode[]): SpecTreeNode[] {
	const ids = new Set(nodes.map((n) => n.id));
	const roots: SpecGraphNode[] = [];
	const childrenByParent = new Map<string, SpecGraphNode[]>();
	const byTitle = (a: SpecGraphNode, b: SpecGraphNode) => a.title.localeCompare(b.title);

	for (const node of nodes) {
		if (node.parent !== undefined && ids.has(node.parent) && node.parent !== node.id) {
			const siblings = childrenByParent.get(node.parent);
			if (siblings) siblings.push(node);
			else childrenByParent.set(node.parent, [node]);
		} else {
			roots.push(node);
		}
	}
	roots.sort(byTitle);
	for (const children of childrenByParent.values()) children.sort(byTitle);

	const visited = new Set<string>();
	const materialize = (node: SpecGraphNode): SpecTreeNode => {
		visited.add(node.id);
		const children: SpecTreeNode[] = [];
		for (const child of childrenByParent.get(node.id) ?? []) {
			if (!visited.has(child.id)) children.push(materialize(child));
		}
		return { node, children };
	};
	return roots.map(materialize);
}
