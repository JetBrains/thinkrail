// Public surface of the pi-free spec model. `tools/` imports the graph model, index, query, and
// validation through this barrel only. Nothing here imports `@earendil-works/*`.

export { BUILTIN_SPEC_TYPE_CARDS } from "./builtins.ts";
export {
	buildGraph,
	LINK_KINDS,
	linkTargets,
	type SpecEdge,
	type SpecFileEntry,
	type SpecGraph,
	type SpecNode,
} from "./graph.ts";
export {
	FIELD_ORDER,
	FIELDS,
	type Frontmatter,
	type FrontmatterEdit,
	type FrontmatterEditResult,
	type FrontmatterValue,
	IDENTITY_FIELDS,
	isSpec,
	LIST_FIELDS,
	LIST_LINK_FIELDS,
	type LinkKind,
	list,
	type ParsedFile,
	parseFile,
	REQUIRED_FIELDS,
	SINGLE_LINK_FIELDS,
	SPEC_STATUSES,
	type SpecStatus,
	scalar,
	serializeFrontmatter,
	updateFrontmatterText,
} from "./parse.ts";
export {
	type GraphSlice,
	type GrepMatch,
	type GrepOptions,
	type GrepResult,
	graphSlice,
	grepSpecs,
	SLICE_DIRECTIONS,
	type SliceDirection,
	type SliceOptions,
	type SpecContentEntry,
	type SpecFilters,
} from "./query.ts";
export { type SpecFileRecord, SpecIndex } from "./store.ts";
export {
	builtinTypeCards,
	parseTypeCard,
	type ResolvedTypeCard,
	SPEC_LIFECYCLES,
	type SpecLifecycle,
	type SpecTypeCard,
	SpecTypeRegistry,
	TYPE_CARD_ORIGINS,
	type TypeCardDir,
	type TypeCardOrigin,
} from "./types.ts";
export {
	type DanglingLink,
	type DuplicateId,
	isValid,
	type ParentCycle,
	type ValidationReport,
	validateGraph,
} from "./validate.ts";
