import { join, relative, sep } from "node:path";
import type {
	ArrowFunction,
	CallExpression,
	Expression,
	FunctionDeclaration,
	FunctionExpression,
	GetAccessorDeclaration,
	Identifier,
	MethodDeclaration,
	Node,
	SourceFile,
} from "tsrs/ast";
import {
	isArrowFunction,
	isCallExpression,
	isClassDeclaration,
	isClassExpression,
	isExportSpecifier,
	isFunctionDeclaration,
	isFunctionExpression,
	isGetAccessorDeclaration,
	isIdentifier,
	isImportSpecifier,
	isJsxAttribute,
	isJsxElement,
	isJsxExpression,
	isJsxFragment,
	isMethodDeclaration,
	isParenthesizedExpression,
	isPropertyAccessExpression,
	isPropertyAssignment,
	isSourceFile,
	isVariableDeclaration,
} from "tsrs/ast/is";
import { type API, type Checker, SymbolFlags, type Symbol as TsSymbol } from "tsrs/async";

export interface RenderReachViolation {
	file: string;
	line: number;
	text: string;
}

const LOCALE_READERS = new Set(["t", "i18n", "currentLocale", "currentTranslator"]);

const SYNCHRONOUS_CALLBACKS = new Set([
	"useAppStore",
	"useStore",
	"useMemo",
	"useState",
	"useReducer",
	"map",
	"flatMap",
	"filter",
	"reduce",
	"sort",
	"toSorted",
	"find",
	"findIndex",
	"findLast",
	"some",
	"every",
	"forEach",
	"from",
	"fromEntries",
	"entries",
]);

type FunctionNode =
	| FunctionDeclaration
	| FunctionExpression
	| ArrowFunction
	| MethodDeclaration
	| GetAccessorDeclaration;

function isFunctionNode(node: Node): node is FunctionNode {
	return (
		isFunctionDeclaration(node) ||
		isFunctionExpression(node) ||
		isArrowFunction(node) ||
		isMethodDeclaration(node) ||
		isGetAccessorDeclaration(node)
	);
}

function declaredName(node: FunctionNode): Node | undefined {
	return isArrowFunction(node) ? undefined : node.name;
}

function functionName(node: FunctionNode): string | undefined {
	const name = declaredName(node);
	if (name && isIdentifier(name)) return name.text;
	let parent: Node = node.parent;
	while (isCallExpression(parent) || isParenthesizedExpression(parent)) parent = parent.parent;
	if (isVariableDeclaration(parent) && isIdentifier(parent.name)) return parent.name.text;
	return undefined;
}

function isComponentOrHook(node: FunctionNode): boolean {
	if (
		isMethodDeclaration(node) &&
		(isClassDeclaration(node.parent) || isClassExpression(node.parent))
	) {
		return isIdentifier(node.name) && node.name.text === "render";
	}
	const name = functionName(node);
	return !!name && (/^[A-Z]/.test(name) || /^use[A-Z]/.test(name));
}

function enclosingFunction(node: Node): FunctionNode | undefined {
	for (let current = node.parent; current; current = current.parent) {
		if (isFunctionNode(current)) return current;
	}
	return undefined;
}

function calleeName(call: CallExpression): string | undefined {
	const callee = call.expression;
	if (isIdentifier(callee)) return callee.text;
	if (isPropertyAccessExpression(callee)) return callee.name.text;
	return undefined;
}

function isRenderProp(fn: FunctionNode): boolean {
	const container = fn.parent;
	if (!isJsxExpression(container)) return false;
	const owner = container.parent;
	if (isJsxElement(owner) || isJsxFragment(owner)) return true;
	return isJsxAttribute(owner) && /^(?:render[A-Z]?|children$)/.test(owner.name.getText());
}

function runsSynchronouslyIn(fn: FunctionNode): boolean {
	if (isRenderProp(fn)) return true;
	const parent = fn.parent;
	if (isCallExpression(parent) && parent.arguments.includes(fn as Expression)) {
		const name = calleeName(parent);
		return !!name && SYNCHRONOUS_CALLBACKS.has(name);
	}
	return isParenthesizedExpression(parent) && isCallExpression(parent.parent);
}

function ownerWhenEvaluated(node: Node): FunctionNode | undefined {
	let fn = enclosingFunction(node);
	while (fn && runsSynchronouslyIn(fn)) fn = enclosingFunction(fn);
	return fn;
}

function isGetterLike(node: Node): node is FunctionNode {
	return (
		isGetAccessorDeclaration(node) ||
		((isArrowFunction(node) || isFunctionExpression(node)) &&
			isPropertyAssignment(node.parent) &&
			isIdentifier(node.parent.name) &&
			node.parent.name.text === "get")
	);
}

function isRenderSeam(node: Node): node is FunctionNode {
	return (
		(isArrowFunction(node) || isFunctionExpression(node)) &&
		isPropertyAssignment(node.parent) &&
		isIdentifier(node.parent.name) &&
		node.parent.name.text === "summary"
	);
}

async function resolvedSymbols(
	checker: Checker,
	nodes: readonly Node[],
): Promise<Map<Node, TsSymbol | undefined>> {
	const symbols = nodes.length > 0 ? await checker.getSymbolAtLocation(nodes) : [];
	const aliases = new Map<TsSymbol, Promise<TsSymbol>>();
	for (const symbol of symbols) {
		if (symbol && symbol.flags & SymbolFlags.Alias && !aliases.has(symbol))
			aliases.set(symbol, checker.getAliasedSymbol(symbol));
	}
	const targets = new Map<TsSymbol, TsSymbol>();
	for (const [alias, target] of aliases) targets.set(alias, await target);
	return new Map(
		nodes.map((node, index) => {
			const symbol = symbols[index];
			return [node, symbol && (targets.get(symbol) ?? symbol)];
		}),
	);
}

function symbolSites(file: SourceFile): Node[] {
	const sites: Node[] = [];
	const visit = (node: Node): void => {
		if (isIdentifier(node)) sites.push(node);
		else {
			const name = isFunctionNode(node)
				? declaredName(node)
				: isVariableDeclaration(node)
					? node.name
					: undefined;
			if (name && !isIdentifier(name)) sites.push(name);
		}
		node.forEachChild(visit);
	};
	visit(file);
	return sites;
}

export async function renderReachViolations(
	api: API,
	repoRoot: string,
	tsconfigs: readonly string[],
): Promise<RenderReachViolation[]> {
	const violations: RenderReachViolation[] = [];
	const seen = new Set<string>();
	for (const tsconfig of tsconfigs) {
		const configPath = join(repoRoot, tsconfig);
		const config = await api.readConfigFile(configPath);
		const parsed = await api.parseJsonConfigFileContent(config.config, {
			configFileName: configPath,
		});
		const program = await api.createProgram(parsed.fileNames, parsed.options);
		const checker = program.getProject().checker;
		const files: SourceFile[] = [];
		for (const name of await program.getSourceFileNames()) {
			const file = await program.getSourceFile(name);
			if (file) files.push(file);
		}

		const localeModule = files.find((file) =>
			file.fileName.endsWith(["packages", "locales", "src", "react.tsx"].join("/")),
		);
		const moduleSymbol = localeModule ? await checker.getSymbolAtLocation(localeModule) : undefined;
		if (!localeModule || !moduleSymbol) continue;
		const exported = (await checker.getExportsOfModule(moduleSymbol)).filter((symbol) =>
			LOCALE_READERS.has(symbol.name),
		);
		const readers = new Set(
			await Promise.all(
				exported.map((symbol) =>
					symbol.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol,
				),
			),
		);
		const sources = files.filter(
			(file) =>
				!file.isDeclarationFile &&
				!file.fileName.includes("/node_modules/") &&
				!/\.(?:test|spec)\.tsx?$/.test(file.fileName) &&
				file !== localeModule,
		);
		const symbolAt = new Map<Node, TsSymbol | undefined>();
		for (const file of sources) {
			for (const [node, symbol] of await resolvedSymbols(checker, symbolSites(file)))
				symbolAt.set(node, symbol);
		}

		const translatingFunctions = new Set<TsSymbol>();
		const translatingValues = new Set<TsSymbol>();
		const symbolOf = (node: Node) => symbolAt.get(node);
		const callable = (node: Identifier): Expression =>
			isPropertyAccessExpression(node.parent) && node.parent.name === node ? node.parent : node;
		const isLocaleRead = (node: Identifier): boolean => {
			const symbol = symbolOf(node);
			if (!symbol) return false;
			if (readers.has(symbol) || translatingValues.has(symbol)) return true;
			if (!translatingFunctions.has(symbol)) return false;
			const expression = callable(node);
			if (!isCallExpression(expression.parent)) return false;
			const call = expression.parent;
			if (call.expression === expression) return true;
			const name = calleeName(call);
			return !!name && SYNCHRONOUS_CALLBACKS.has(name) && call.arguments.includes(expression);
		};
		const isTranslatingReference = (node: Expression): boolean => {
			const target = isPropertyAccessExpression(node) ? node.name : node;
			if (!isIdentifier(target)) return false;
			const symbol = symbolOf(target);
			return !!symbol && translatingFunctions.has(symbol);
		};
		const readsLocaleWhenCalled = (fn: FunctionNode): boolean => {
			let found = false;
			const visit = (node: Node): void => {
				if (found) return;
				if (isIdentifier(node) && ownerWhenEvaluated(node) === fn && isLocaleRead(node)) {
					found = true;
					return;
				}
				node.forEachChild(visit);
			};
			for (const parameter of fn.parameters)
				if (parameter.initializer) visit(parameter.initializer);
			if (fn.body) visit(fn.body);
			return found;
		};
		const functionSymbol = (fn: FunctionNode): TsSymbol | undefined => {
			const name = declaredName(fn);
			if (name) return symbolOf(name);
			let parent: Node = fn.parent;
			while (isCallExpression(parent) || isParenthesizedExpression(parent)) parent = parent.parent;
			return isVariableDeclaration(parent) ? symbolOf(parent.name) : undefined;
		};

		let grew = true;
		while (grew) {
			grew = false;
			for (const file of sources) {
				const visit = (node: Node): void => {
					if (
						isFunctionNode(node) &&
						!isComponentOrHook(node) &&
						!isGetterLike(node) &&
						!isRenderSeam(node)
					) {
						const symbol = functionSymbol(node);
						if (symbol && !translatingFunctions.has(symbol) && readsLocaleWhenCalled(node)) {
							translatingFunctions.add(symbol);
							grew = true;
						}
					}
					if (isGetterLike(node) && readsLocaleWhenCalled(node)) {
						let holder: Node = node;
						while (holder.parent && !isVariableDeclaration(holder) && !isSourceFile(holder)) {
							holder = holder.parent;
						}
						const symbol = isVariableDeclaration(holder) ? symbolOf(holder.name) : undefined;
						if (symbol && !translatingValues.has(symbol)) {
							translatingValues.add(symbol);
							grew = true;
						}
					}
					node.forEachChild(visit);
				};
				visit(file);
			}
		}

		for (const file of sources) {
			const visit = (node: Node): void => {
				if (
					isPropertyAssignment(node) &&
					isIdentifier(node.name) &&
					node.name.text === "summary" &&
					isTranslatingReference(node.initializer)
				) {
					const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
					violations.push({
						file: relative(repoRoot, file.fileName).split(sep).join("/"),
						line: line + 1,
						text: "summary reads the global translator",
					});
				}
				if ((isGetterLike(node) || isRenderSeam(node)) && readsLocaleWhenCalled(node)) {
					const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
					violations.push({
						file: relative(repoRoot, file.fileName).split(sep).join("/"),
						line: line + 1,
						text: isGetterLike(node) ? "translating getter" : "summary reads the global translator",
					});
				}
				if (isIdentifier(node) && !isImportSpecifier(node.parent)) {
					const owner = ownerWhenEvaluated(node);
					const expression = callable(node);
					const atModuleLoad =
						!owner &&
						!isExportSpecifier(node.parent) &&
						isCallExpression(expression.parent) &&
						expression.parent.expression === expression;
					if (((owner && isComponentOrHook(owner)) || atModuleLoad) && isLocaleRead(node)) {
						const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
						const key = `${file.fileName}:${line}:${node.text}`;
						if (!seen.has(key)) {
							seen.add(key);
							violations.push({
								file: relative(repoRoot, file.fileName).split(sep).join("/"),
								line: line + 1,
								text: node.text,
							});
						}
					}
				}
				node.forEachChild(visit);
			};
			visit(file);
		}
	}
	return violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}
