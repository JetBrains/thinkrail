interface FakeAttribute {
	name: string;
	value: string;
}

export class FakeElement {
	readonly children: FakeElement[] = [];
	private readonly values = new Map<string, string>();
	private parent: FakeElement | null = null;

	constructor(
		readonly localName: string,
		attributes: Record<string, string> = {},
		private text = "",
		children: readonly FakeElement[] = [],
	) {
		for (const [name, value] of Object.entries(attributes)) this.values.set(name, value);
		for (const child of children) this.append(child);
	}

	get attributes(): FakeAttribute[] {
		return [...this.values].map(([name, value]) => ({ name, value }));
	}

	set textContent(value: string) {
		this.text = value;
	}

	get outerHTML(): string {
		const attributes = [...this.values]
			.map(([name, value]) => ` ${name}="${escapeMarkup(value)}"`)
			.join("");
		const body = `${escapeMarkup(this.text)}${this.children.map((child) => child.outerHTML).join("")}`;
		return `<${this.localName}${attributes}>${body}</${this.localName}>`;
	}

	append(child: FakeElement): void {
		child.remove();
		child.parent = this;
		this.children.push(child);
	}

	prepend(...children: FakeElement[]): void {
		for (const child of children) child.remove();
		for (const child of [...children].reverse()) {
			child.parent = this;
			this.children.unshift(child);
		}
	}

	getAttribute(name: string): string | null {
		return this.values.get(name) ?? null;
	}

	setAttribute(name: string, value: string): void {
		this.values.set(name, value);
	}

	removeAttribute(name: string): void {
		this.values.delete(name);
	}

	remove(): void {
		if (!this.parent) return;
		const index = this.parent.children.indexOf(this);
		if (index >= 0) this.parent.children.splice(index, 1);
		this.parent = null;
	}
}

export class FakeDocument {
	readonly head: FakeElement;
	readonly documentElement: FakeElement;

	constructor(head: FakeElement, body: FakeElement) {
		this.head = head;
		this.documentElement = new FakeElement("html", {}, "", [head, body]);
	}

	createElement(name: string): FakeElement {
		return new FakeElement(name);
	}
}

function escapeMarkup(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}
