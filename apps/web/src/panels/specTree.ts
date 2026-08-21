import type { SpecGraphNode } from "@thinkrail/contracts";

export interface SpecTreeNode {
	node: SpecGraphNode;
	children: SpecTreeNode[];
}

interface SpecRole {
	label: string;
	tag: string;
}

const SPEC_ROLES = {
	"goal-and-requirements": { label: "Goal", tag: "GOAL" },
	"architecture-design": { label: "Architecture", tag: "ARCH" },
	"module-design": { label: "Module", tag: "MODULE" },
	"submodule-design": { label: "Submodule", tag: "SUBMODULE" },
	"task-spec": { label: "Task", tag: "TASK" },
} as const satisfies Record<string, SpecRole>;

type KnownSpecType = keyof typeof SPEC_ROLES;

function isKnownSpecType(type: string): type is KnownSpecType {
	return Object.hasOwn(SPEC_ROLES, type);
}

export function specRoleLabel(type: string): string {
	if (isKnownSpecType(type)) return SPEC_ROLES[type].label;
	const words = type.split(/[-_\s]+/).filter(Boolean);
	if (words.length === 0) return "Spec";
	return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

export function specDisplayTitle(title: string): string {
	return title.replace(/\s+[—–]\s+/g, " · ");
}

export function specRoleTag(type: string): string {
	return isKnownSpecType(type) ? SPEC_ROLES[type].tag : specRoleLabel(type).toUpperCase();
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
