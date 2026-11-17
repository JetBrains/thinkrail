//! Agent-shaped semantic search over LSP, with a ripgrep-style fallback.
//!
//! Everything returned here is 1-indexed (`path:line`), paths are relative to
//! the worktree, and snippets are a line or three, so the agent can act on a
//! hit without reading whole files and without off-by-one edits.

use std::path::{Path, PathBuf};

use ignore::WalkBuilder;
use serde::Serialize;
use serde_json::{json, Value};

use super::{
    client::{canonical, path_to_uri, uri_to_path, LspClient, LspError, LspPool},
    detector::detect,
    registry::spec_for_extension,
};

const DEFAULT_LIMIT: usize = 20;
const MAX_LIMIT: usize = 100;
const MAX_REFERENCES: usize = 200;
const MAX_BLOCK_LINES: usize = 40;
const MAX_FILE_BYTES: u64 = 1_000_000;
const MAX_WALKED_FILES: usize = 20_000;
const MAX_LINE_CHARS: usize = 160;

// --- result shapes ---------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SymbolHit {
    pub name: String,
    pub kind: String,
    pub container: Option<String>,
    pub path: String,
    pub line: u32,
    pub preview: String,
    /// `lsp` or `text`.
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SymbolSearchResult {
    pub hits: Vec<SymbolHit>,
    pub source: String,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceSite {
    pub line: u32,
    pub column: u32,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceGroup {
    pub path: String,
    pub count: usize,
    pub references: Vec<ReferenceSite>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferencesResult {
    pub symbol: String,
    pub total: usize,
    pub groups: Vec<ReferenceGroup>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DefinitionHit {
    pub path: String,
    pub line: u32,
    pub column: u32,
    pub signature: String,
    pub block_start_line: u32,
    pub block_end_line: u32,
    pub block: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefinitionResult {
    pub symbol: String,
    pub definitions: Vec<DefinitionHit>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OutlineNode {
    pub name: String,
    pub kind: String,
    pub start_line: u32,
    pub end_line: u32,
    pub children: Vec<OutlineNode>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineResult {
    pub path: String,
    pub nodes: Vec<OutlineNode>,
    pub source: String,
    pub notes: Vec<String>,
}

/// Where in a file a query points: a 1-indexed line (with optional 1-indexed
/// column) or a symbol name.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Target {
    pub symbol_name: Option<String>,
    pub line: Option<u32>,
    pub column: Option<u32>,
}

// --- pure helpers ----------------------------------------------------------

/// LSP positions are 0-indexed; everything the agent sees is 1-indexed.
pub fn to_one_based(zero_based: u64) -> u32 {
    u32::try_from(zero_based.saturating_add(1)).unwrap_or(u32::MAX)
}

pub fn relative_path(root: &Path, path: &Path) -> String {
    let shown = path.strip_prefix(root).unwrap_or(path);
    shown.to_string_lossy().replace('\\', "/")
}

pub fn kind_name(kind: u64) -> &'static str {
    match kind {
        1 => "file",
        2 => "module",
        3 => "namespace",
        4 => "package",
        5 => "class",
        6 => "method",
        7 => "property",
        8 => "field",
        9 => "constructor",
        10 => "enum",
        11 => "interface",
        12 => "function",
        13 => "variable",
        14 => "constant",
        15 => "string",
        16 => "number",
        17 => "boolean",
        18 => "array",
        19 => "object",
        20 => "key",
        21 => "null",
        22 => "enum_member",
        23 => "struct",
        24 => "event",
        25 => "operator",
        26 => "type_parameter",
        _ => "symbol",
    }
}

/// Does `kind` satisfy a user-supplied filter (`function`, `type`, ...)?
pub fn kind_matches(kind: &str, filter: &str) -> bool {
    let filter = filter.trim().to_lowercase();
    if filter.is_empty() {
        return true;
    }
    match filter.as_str() {
        "function" | "func" | "fn" => matches!(kind, "function" | "method" | "constructor"),
        "type" => matches!(kind, "class" | "interface" | "struct" | "enum" | "type_parameter" | "type"),
        "variable" | "const" => matches!(kind, "variable" | "constant" | "field" | "property"),
        other => kind == other,
    }
}

/// Lower is better: exact, prefix, substring, other.
pub fn rank(name: &str, query: &str) -> u8 {
    let (name, query) = (name.to_lowercase(), query.to_lowercase());
    if name == query {
        0
    } else if name.starts_with(&query) {
        1
    } else if name.contains(&query) {
        2
    } else {
        3
    }
}

fn truncate(line: &str) -> String {
    let trimmed = line.trim_end();
    if trimmed.chars().count() <= MAX_LINE_CHARS {
        trimmed.to_owned()
    } else {
        let cut: String = trimmed.chars().take(MAX_LINE_CHARS).collect();
        format!("{cut}…")
    }
}

/// Up to three non-blank lines starting at 1-indexed `line`, dedented.
pub fn preview(lines: &[String], line: u32) -> String {
    let start = (line as usize).saturating_sub(1);
    let taken: Vec<&String> = lines
        .iter()
        .skip(start)
        .take(3)
        .filter(|text| !text.trim().is_empty())
        .collect();
    let indent = taken
        .iter()
        .map(|text| text.len() - text.trim_start().len())
        .min()
        .unwrap_or(0);
    taken
        .iter()
        .map(|text| truncate(&text[indent.min(text.len())..]))
        .collect::<Vec<_>>()
        .join("\n")
}

fn is_ident(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '$'
}

const KEYWORDS: &[&str] = &[
    "pub", "fn", "function", "def", "func", "class", "struct", "enum", "trait", "interface", "type",
    "const", "let", "var", "export", "default", "async", "static", "public", "private", "protected",
    "abstract", "impl", "mod", "use", "import", "from", "return", "unsafe", "extern", "readonly",
    "declare", "final", "override", "await", "new", "if", "else", "for", "while", "in", "of",
];

/// 0-indexed UTF-16 column of the first non-keyword identifier on a line.
pub fn first_identifier_column(line: &str) -> Option<u32> {
    let mut start: Option<usize> = None;
    let mut found = None;
    let mut chars = line.char_indices().peekable();
    while let Some((index, c)) = chars.next() {
        if is_ident(c) {
            start.get_or_insert(index);
            if chars.peek().map_or(true, |(_, next)| !is_ident(*next)) {
                let begin = start.take().unwrap();
                let word = &line[begin..index + c.len_utf8()];
                if !KEYWORDS.contains(&word)
                    && !word.chars().all(|c| c == '_')
                    && !word.chars().next().is_some_and(|c| c.is_ascii_digit()) {
                    found = Some(begin);
                    break;
                }
            }
        } else {
            start = None;
        }
    }
    found.map(|byte| line[..byte].encode_utf16().count() as u32)
}

/// 0-indexed UTF-16 column of the first whole-word `word` on a line.
fn word_column(line: &str, word: &str) -> Option<u32> {
    let mut from = 0;
    while let Some(offset) = line[from..].find(word) {
        let begin = from + offset;
        let end = begin + word.len();
        let before_ok = line[..begin].chars().next_back().is_none_or(|c| !is_ident(c));
        let after_ok = line[end..].chars().next().is_none_or(|c| !is_ident(c));
        if before_ok && after_ok {
            return Some(line[..begin].encode_utf16().count() as u32);
        }
        from = begin + word.len().max(1);
    }
    None
}

// --- document symbols ------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct Sym {
    pub name: String,
    pub kind: &'static str,
    pub container: Option<String>,
    pub start_line: u32,
    pub end_line: u32,
    /// 0-indexed position of the name.
    pub sel_line: u32,
    pub sel_col: u32,
    pub children: Vec<Sym>,
}

fn range_lines(range: &Value) -> Option<(u32, u32)> {
    let start = range.pointer("/start/line")?.as_u64()?;
    let end = range.pointer("/end/line")?.as_u64()?;
    Some((to_one_based(start), to_one_based(end)))
}

fn parse_symbol(value: &Value, container: Option<&str>) -> Option<Sym> {
    let name = value.get("name")?.as_str()?.to_owned();
    let kind = kind_name(value.get("kind")?.as_u64()?);
    // DocumentSymbol has `range`/`selectionRange`; SymbolInformation has `location`.
    let range = value
        .get("range")
        .or_else(|| value.pointer("/location/range"))?;
    let (start_line, end_line) = range_lines(range)?;
    let selection = value.get("selectionRange").unwrap_or(range);
    let sel_line = selection.pointer("/start/line").and_then(Value::as_u64)? as u32;
    let sel_col = selection.pointer("/start/character").and_then(Value::as_u64)? as u32;
    let container_name = container
        .map(str::to_owned)
        .or_else(|| value.get("containerName").and_then(Value::as_str).map(str::to_owned));
    let children = value
        .get("children")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|child| parse_symbol(child, Some(&name)))
                .collect()
        })
        .unwrap_or_default();
    Some(Sym {
        name,
        kind,
        container: container_name,
        start_line,
        end_line,
        sel_line,
        sel_col,
        children,
    })
}

pub fn parse_document_symbols(value: &Value) -> Vec<Sym> {
    value
        .as_array()
        .map(|items| items.iter().filter_map(|item| parse_symbol(item, None)).collect())
        .unwrap_or_default()
}

fn flatten(symbols: &[Sym]) -> Vec<&Sym> {
    let mut out = Vec::new();
    for symbol in symbols {
        out.push(symbol);
        out.extend(flatten(&symbol.children));
    }
    out
}

/// Find a symbol by `name`, `Container.name` or `Container::name`.
pub fn find_symbol<'a>(symbols: &'a [Sym], wanted: &str) -> Option<&'a Sym> {
    let all = flatten(symbols);
    let normalized = wanted.replace("::", ".");
    all.iter()
        .find(|s| s.name == wanted)
        .or_else(|| {
            all.iter().find(|s| {
                s.container
                    .as_ref()
                    .is_some_and(|container| format!("{container}.{}", s.name) == normalized)
            })
        })
        .or_else(|| all.iter().find(|s| s.name.starts_with(&format!("{wanted}("))))
        .or_else(|| all.iter().find(|s| s.name.eq_ignore_ascii_case(wanted)))
        .copied()
}

fn to_outline(symbols: &[Sym]) -> Vec<OutlineNode> {
    symbols
        .iter()
        .map(|symbol| OutlineNode {
            name: symbol.name.clone(),
            kind: symbol.kind.to_owned(),
            start_line: symbol.start_line,
            end_line: symbol.end_line,
            children: to_outline(&symbol.children),
        })
        .collect()
}

/// The innermost symbol whose range contains 1-indexed `line`.
fn enclosing(symbols: &[Sym], line: u32) -> Option<&Sym> {
    symbols
        .iter()
        .filter(|s| s.start_line <= line && line <= s.end_line)
        .find_map(|s| enclosing(&s.children, line).or(Some(s)))
}

// --- locations -------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct Place {
    pub path: PathBuf,
    /// 1-indexed.
    pub line: u32,
    pub column: u32,
}

/// Parse `Location | Location[] | LocationLink[]`.
pub fn parse_locations(value: &Value) -> Vec<Place> {
    let items: Vec<&Value> = match value {
        Value::Array(items) => items.iter().collect(),
        Value::Object(_) => vec![value],
        _ => Vec::new(),
    };
    items
        .into_iter()
        .filter_map(|item| {
            let uri = item
                .get("uri")
                .or_else(|| item.get("targetUri"))?
                .as_str()?;
            let range = item
                .get("range")
                .or_else(|| item.get("targetSelectionRange"))
                .or_else(|| item.get("targetRange"))?;
            let line = range.pointer("/start/line")?.as_u64()?;
            let column = range.pointer("/start/character")?.as_u64()?;
            Some(Place {
                path: uri_to_path(uri)?,
                line: to_one_based(line),
                column: to_one_based(column),
            })
        })
        .collect()
}

pub fn group_references(
    root: &Path,
    mut places: Vec<Place>,
    mut snippet: impl FnMut(&Path, u32) -> String,
) -> Vec<ReferenceGroup> {
    places.sort_by(|a, b| (&a.path, a.line, a.column).cmp(&(&b.path, b.line, b.column)));
    places.dedup();
    let mut groups: Vec<ReferenceGroup> = Vec::new();
    for place in places {
        let path = relative_path(root, &place.path);
        let site = ReferenceSite {
            line: place.line,
            column: place.column,
            snippet: snippet(&place.path, place.line),
        };
        match groups.last_mut() {
            Some(group) if group.path == path => {
                group.count += 1;
                group.references.push(site);
            }
            _ => groups.push(ReferenceGroup {
                path,
                count: 1,
                references: vec![site],
            }),
        }
    }
    groups
}

// --- file helpers ----------------------------------------------------------

fn read_lines(path: &Path) -> Option<Vec<String>> {
    let text = std::fs::read_to_string(path).ok()?;
    Some(text.lines().map(str::to_owned).collect())
}

#[allow(dead_code)]
fn line_snippet(path: &Path, line: u32) -> String {
    read_lines(path)
        .and_then(|lines| lines.get(line as usize - 1).map(|text| truncate(text.trim())))
        .unwrap_or_default()
}

/// Resolve a worktree-relative (or absolute) file path, refusing escapes.
pub fn resolve_in_worktree(root: &Path, file_path: &str) -> Result<PathBuf, LspError> {
    let candidate = Path::new(file_path);
    let joined = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        root.join(candidate)
    };
    let resolved = canonical(&joined);
    if !resolved.starts_with(root) {
        return Err(LspError::Invalid(format!(
            "`{file_path}` is outside the worktree"
        )));
    }
    if !resolved.is_file() {
        return Err(LspError::Invalid(format!("`{file_path}` is not a file")));
    }
    Ok(resolved)
}

fn extension_of(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
}

async fn client_for_file(
    pool: &LspPool,
    root: &Path,
    file: &Path,
) -> Result<std::sync::Arc<LspClient>, LspError> {
    let extension = extension_of(file);
    let spec = spec_for_extension(&extension)
        .ok_or_else(|| LspError::Unavailable(format!("no language server for .{extension}")))?;
    pool.client(root, spec.id).await
}

// --- text fallback ---------------------------------------------------------

/// `(kind, name)` when `line` declares something.
pub fn definition_of(line: &str) -> Option<(&'static str, String)> {
    let mut rest = line.trim_start();
    if rest.starts_with("//") {
        return None;
    }
    loop {
        let before = rest;
        for modifier in [
            "export ", "default ", "pub ", "async ", "public ", "private ", "protected ", "static ",
            "abstract ", "declare ", "unsafe ", "extern ", "final ", "override ",
        ] {
            if let Some(stripped) = rest.strip_prefix(modifier) {
                rest = stripped.trim_start();
            }
        }
        if rest.starts_with("pub(") {
            if let Some(close) = rest.find(')') {
                rest = rest[close + 1..].trim_start();
            }
        }
        if before == rest {
            break;
        }
    }
    let (keyword, mut tail) = rest.split_once(char::is_whitespace)?;
    let kind = match keyword {
        "fn" | "function" | "def" | "func" => "function",
        "class" => "class",
        "struct" => "struct",
        "enum" => "enum",
        "trait" | "interface" => "interface",
        "type" => "type",
        "mod" | "module" | "namespace" => "module",
        "const" | "let" | "var" | "val" => "variable",
        _ => return None,
    };
    tail = tail.trim_start().trim_start_matches('*').trim_start();
    if kind == "function" && tail.starts_with('(') {
        // Go receiver: `func (r *T) Name(`.
        tail = tail[tail.find(')')? + 1..].trim_start();
    }
    let name: String = tail.chars().take_while(|c| is_ident(*c)).collect();
    (!name.is_empty()).then_some((kind, name))
}

fn should_walk(entry: &ignore::DirEntry) -> bool {
    let name = entry.file_name().to_string_lossy();
    !matches!(name.as_ref(), ".git" | "node_modules" | "target" | "dist" | "build")
}

fn walk_files(root: &Path) -> impl Iterator<Item = PathBuf> {
    WalkBuilder::new(root)
        .hidden(false)
        .filter_entry(should_walk)
        .build()
        .flatten()
        .filter(|entry| entry.file_type().is_some_and(|t| t.is_file()))
        .filter(|entry| entry.metadata().map(|m| m.len() <= MAX_FILE_BYTES).unwrap_or(false))
        .map(|entry| entry.into_path())
        .take(MAX_WALKED_FILES)
}

/// Ripgrep-style fallback: definition lines first, plain mentions only when
/// there are no definitions.
pub fn text_symbol_search(
    root: &Path,
    query: &str,
    kind_filter: Option<&str>,
    limit: usize,
) -> Vec<SymbolHit> {
    let needle = query.to_lowercase();
    let mut definitions: Vec<(u8, SymbolHit)> = Vec::new();
    let mut mentions: Vec<SymbolHit> = Vec::new();
    for path in walk_files(root) {
        let Some(lines) = read_lines(&path) else { continue };
        let mut per_file = 0;
        for (index, text) in lines.iter().enumerate() {
            if !text.to_lowercase().contains(&needle) {
                continue;
            }
            let line = index as u32 + 1;
            let relative = relative_path(root, &path);
            if let Some((kind, name)) = definition_of(text) {
                if name.to_lowercase().contains(&needle)
                    && kind_filter.is_none_or(|filter| kind_matches(kind, filter))
                {
                    definitions.push((
                        rank(&name, query),
                        SymbolHit {
                            name,
                            kind: kind.to_owned(),
                            container: None,
                            path: relative,
                            line,
                            preview: preview(&lines, line),
                            source: "text".into(),
                        },
                    ));
                    continue;
                }
            }
            if per_file < 3 && mentions.len() < limit && kind_filter.is_none() {
                per_file += 1;
                mentions.push(SymbolHit {
                    name: query.to_owned(),
                    kind: "text".into(),
                    container: None,
                    path: relative,
                    line,
                    preview: truncate(text.trim()),
                    source: "text".into(),
                });
            }
        }
    }
    if definitions.is_empty() {
        mentions.truncate(limit);
        return mentions;
    }
    definitions.sort_by(|a, b| (a.0, &a.1.path, a.1.line).cmp(&(b.0, &b.1.path, b.1.line)));
    definitions.into_iter().map(|(_, hit)| hit).take(limit).collect()
}

/// Heuristic outline of declarations when no language server is available.
pub fn text_outline(lines: &[String]) -> Vec<OutlineNode> {
    lines
        .iter()
        .enumerate()
        .filter_map(|(index, text)| {
            let (kind, name) = definition_of(text)?;
            // Skip locals: only top-level or one-level-indented declarations.
            let indent = text.len() - text.trim_start().len();
            if kind == "variable" && indent > 0 {
                return None;
            }
            let line = index as u32 + 1;
            Some(OutlineNode {
                name,
                kind: kind.to_owned(),
                start_line: line,
                end_line: line,
                children: Vec::new(),
            })
        })
        .collect()
}

// --- LSP-backed operations -------------------------------------------------

fn clamp_limit(limit: Option<usize>) -> usize {
    limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
}

fn hit_in_worktree(root: &Path, path: &Path) -> bool {
    path.starts_with(root)
        && !path
            .components()
            .any(|c| c.as_os_str() == "node_modules" || c.as_os_str() == "target")
}

/// `workspace/symbol` across detected servers, falling back to text search.
pub async fn symbol_search(
    pool: &LspPool,
    worktree: &Path,
    query: &str,
    kind_filter: Option<&str>,
    limit: Option<usize>,
) -> Result<SymbolSearchResult, LspError> {
    if query.trim().is_empty() {
        return Err(LspError::Invalid("`query` must not be empty".into()));
    }
    let root = canonical(worktree);
    let limit = clamp_limit(limit);
    let mut notes = Vec::new();
    let mut hits: Vec<(u8, SymbolHit)> = Vec::new();
    for server in detect(&root).into_iter().filter(|s| s.available) {
        let client = match pool.client(&root, &server.id).await {
            Ok(client) => client,
            Err(error) => {
                notes.push(format!("{}: {error}", server.id));
                continue;
            }
        };
        let value = match client
            .request("workspace/symbol", json!({ "query": query }))
            .await
        {
            Ok(value) => value,
            Err(error) => {
                notes.push(format!("{}: {error}", server.id));
                continue;
            }
        };
        for item in value.as_array().into_iter().flatten() {
            let Some(name) = item.get("name").and_then(Value::as_str) else { continue };
            let kind = kind_name(item.get("kind").and_then(Value::as_u64).unwrap_or(0));
            if kind_filter.is_some_and(|filter| !kind_matches(kind, filter)) {
                continue;
            }
            let Some(uri) = item.pointer("/location/uri").and_then(Value::as_str) else { continue };
            let Some(path) = uri_to_path(uri).map(|p| canonical(&p)) else { continue };
            if !hit_in_worktree(&root, &path) {
                continue;
            }
            let line = item
                .pointer("/location/range/start/line")
                .and_then(Value::as_u64)
                .map_or(1, to_one_based);
            let lines = read_lines(&path).unwrap_or_default();
            hits.push((
                rank(name, query),
                SymbolHit {
                    name: name.to_owned(),
                    kind: kind.to_owned(),
                    container: item
                        .get("containerName")
                        .and_then(Value::as_str)
                        .filter(|c| !c.is_empty())
                        .map(str::to_owned),
                    path: relative_path(&root, &path),
                    line,
                    preview: preview(&lines, line),
                    source: "lsp".into(),
                },
            ));
        }
    }
    hits.sort_by(|a, b| (a.0, &a.1.path, a.1.line).cmp(&(b.0, &b.1.path, b.1.line)));
    hits.dedup_by(|a, b| a.1.path == b.1.path && a.1.line == b.1.line && a.1.name == b.1.name);
    let mut source = "lsp";
    let mut found: Vec<SymbolHit> = hits.into_iter().map(|(_, hit)| hit).take(limit).collect();
    if found.is_empty() {
        source = "text";
        let (walk_root, text_query, filter) = (root.clone(), query.to_owned(), kind_filter.map(str::to_owned));
        found = tokio::task::spawn_blocking(move || {
            text_symbol_search(&walk_root, &text_query, filter.as_deref(), limit)
        })
        .await
        .map_err(|error| LspError::Invalid(error.to_string()))?;
        notes.push("no language-server results; used text search".into());
    }
    Ok(SymbolSearchResult {
        hits: found,
        source: source.into(),
        notes,
    })
}

/// Resolve `target` in `file` to a 0-indexed LSP position plus a label.
async fn resolve_position(
    client: &LspClient,
    file: &Path,
    text: &str,
    target: &Target,
) -> Result<(u32, u32, String), LspError> {
    let lines: Vec<&str> = text.lines().collect();
    if let Some(line) = target.line {
        let index = (line as usize).checked_sub(1).filter(|i| *i < lines.len()).ok_or_else(|| {
            LspError::Invalid(format!("line {line} is outside the file ({} lines)", lines.len()))
        })?;
        let row = lines[index];
        let column = match (&target.symbol_name, target.column) {
            (Some(name), _) => word_column(row, name).ok_or_else(|| {
                LspError::Invalid(format!("symbol `{name}` is not on line {line}"))
            })?,
            (_, Some(column)) => column.saturating_sub(1),
            _ => first_identifier_column(row).unwrap_or(0),
        };
        let label = target
            .symbol_name
            .clone()
            .unwrap_or_else(|| row.trim().chars().take(60).collect());
        return Ok((index as u32, column, label));
    }
    let name = target
        .symbol_name
        .as_deref()
        .ok_or_else(|| LspError::Invalid("provide `symbol_name` or `line`".into()))?;
    let symbols = client
        .request(
            "textDocument/documentSymbol",
            json!({ "textDocument": { "uri": path_to_uri(file) } }),
        )
        .await
        .map(|value| parse_document_symbols(&value))
        .unwrap_or_default();
    if let Some(symbol) = find_symbol(&symbols, name) {
        return Ok((symbol.sel_line, symbol.sel_col, name.to_owned()));
    }
    for (index, row) in lines.iter().enumerate() {
        if let Some(column) = word_column(row, name) {
            return Ok((index as u32, column, name.to_owned()));
        }
    }
    Err(LspError::Invalid(format!(
        "symbol `{name}` was not found in the file"
    )))
}

async fn prepare(
    pool: &LspPool,
    worktree: &Path,
    file_path: &str,
    target: &Target,
) -> Result<(PathBuf, PathBuf, std::sync::Arc<LspClient>, u32, u32, String), LspError> {
    let root = canonical(worktree);
    let file = resolve_in_worktree(&root, file_path)?;
    let client = client_for_file(pool, &root, &file).await?;
    let text = client.sync_file(&file).await?;
    let (line, column, label) = resolve_position(&client, &file, &text, target).await?;
    Ok((root, file, client, line, column, label))
}

pub async fn find_references(
    pool: &LspPool,
    worktree: &Path,
    file_path: &str,
    target: &Target,
    include_declaration: bool,
) -> Result<ReferencesResult, LspError> {
    let (root, file, client, line, column, label) = prepare(pool, worktree, file_path, target).await?;
    let value = client
        .request(
            "textDocument/references",
            json!({
                "textDocument": { "uri": path_to_uri(&file) },
                "position": { "line": line, "character": column },
                "context": { "includeDeclaration": include_declaration }
            }),
        )
        .await?;
    let mut places: Vec<Place> = parse_locations(&value)
        .into_iter()
        .filter(|place| canonical(&place.path).starts_with(&root))
        .map(|place| Place { path: canonical(&place.path), ..place })
        .collect();
    let mut notes = Vec::new();
    let total = places.len();
    if total > MAX_REFERENCES {
        places.truncate(MAX_REFERENCES);
        notes.push(format!("showing the first {MAX_REFERENCES} of {total} references"));
    }
    if total == 0 {
        notes.push("no references found; the server may still be indexing".into());
    }
    let mut cache: std::collections::HashMap<PathBuf, Vec<String>> = Default::default();
    let groups = group_references(&root, places, |path, line| {
        let lines = cache
            .entry(path.to_path_buf())
            .or_insert_with(|| read_lines(path).unwrap_or_default());
        lines
            .get((line as usize).saturating_sub(1))
            .map(|text| truncate(text.trim()))
            .unwrap_or_default()
    });
    Ok(ReferencesResult {
        symbol: label,
        total,
        groups,
        notes,
    })
}

pub async fn goto_definition(
    pool: &LspPool,
    worktree: &Path,
    file_path: &str,
    target: &Target,
) -> Result<DefinitionResult, LspError> {
    let (root, file, client, line, column, label) = prepare(pool, worktree, file_path, target).await?;
    let value = client
        .request(
            "textDocument/definition",
            json!({
                "textDocument": { "uri": path_to_uri(&file) },
                "position": { "line": line, "character": column }
            }),
        )
        .await?;
    let mut definitions = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    for place in parse_locations(&value).into_iter().take(5) {
        let place = Place { path: canonical(&place.path), ..place };
        if !place.path.starts_with(&root) {
            continue; // never expose files outside the worktree
        }
        let symbols = if place.path.starts_with(&root) && client.sync_file(&place.path).await.is_ok() {
            client
                .request(
                    "textDocument/documentSymbol",
                    json!({ "textDocument": { "uri": path_to_uri(&place.path) } }),
                )
                .await
                .map(|value| parse_document_symbols(&value))
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        let lines = read_lines(&place.path).unwrap_or_default();
        if place.line as usize > lines.len() {
            skipped.push(format!(
                "{}:{} could not be read",
                relative_path(&root, &place.path),
                place.line
            ));
            continue;
        }
        let (start, end) = enclosing(&symbols, place.line)
            .map(|s| (s.start_line, s.end_line))
            .unwrap_or((place.line, place.line + 9));
        let end = end
            .min(start + MAX_BLOCK_LINES as u32 - 1)
            .min(lines.len().max(1) as u32)
            .max(start);
        let block = lines
            .iter()
            .skip((start as usize).saturating_sub(1))
            .take((end - start + 1) as usize)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n");
        let signature = lines
            .get(start as usize - 1)
            .map(|text| truncate(text.trim()))
            .unwrap_or_default();
        definitions.push(DefinitionHit {
            path: relative_path(&root, &canonical(&place.path)),
            line: place.line,
            column: place.column,
            signature,
            block_start_line: start,
            block_end_line: end,
            block,
        });
    }
    let mut notes = skipped;
    if definitions.is_empty() && notes.is_empty() {
        notes.push("no definition found".to_owned());
    }
    Ok(DefinitionResult {
        symbol: label,
        definitions,
        notes,
    })
}

pub async fn file_outline(
    pool: &LspPool,
    worktree: &Path,
    file_path: &str,
) -> Result<OutlineResult, LspError> {
    let root = canonical(worktree);
    let file = resolve_in_worktree(&root, file_path)?;
    let shown = relative_path(&root, &file);
    let mut notes = Vec::new();
    if let Ok(client) = client_for_file(pool, &root, &file).await {
        client.sync_file(&file).await?;
        match client
            .request(
                "textDocument/documentSymbol",
                json!({ "textDocument": { "uri": path_to_uri(&file) } }),
            )
            .await
        {
            Ok(value) => {
                return Ok(OutlineResult {
                    path: shown,
                    nodes: to_outline(&parse_document_symbols(&value)),
                    source: "lsp".into(),
                    notes,
                })
            }
            Err(error) => notes.push(error.to_string()),
        }
    }
    notes.push("no language server; outline is a text heuristic".into());
    let lines = read_lines(&file).unwrap_or_default();
    Ok(OutlineResult {
        path: shown,
        nodes: text_outline(&lines),
        source: "text".into(),
        notes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(text: &str) -> Vec<String> {
        text.lines().map(str::to_owned).collect()
    }

    #[test]
    fn zero_based_positions_become_one_based() {
        assert_eq!(to_one_based(0), 1);
        assert_eq!(to_one_based(41), 42);
        assert_eq!(to_one_based(u64::MAX), u32::MAX);
        let places = parse_locations(&json!([{
            "uri": "file:///w/a.rs",
            "range": { "start": { "line": 9, "character": 4 }, "end": { "line": 9, "character": 7 } }
        }]));
        assert_eq!((places[0].line, places[0].column), (10, 5));
    }

    #[test]
    fn location_links_are_understood() {
        let places = parse_locations(&json!([{
            "targetUri": "file:///w/b.rs",
            "targetRange": { "start": { "line": 0, "character": 0 }, "end": { "line": 5, "character": 0 } },
            "targetSelectionRange": { "start": { "line": 2, "character": 3 }, "end": { "line": 2, "character": 6 } }
        }]));
        assert_eq!((places[0].line, places[0].column), (3, 4));
    }

    #[test]
    fn paths_are_workspace_relative_with_forward_slashes() {
        let root = Path::new("/w");
        assert_eq!(relative_path(root, Path::new("/w/src/a.rs")), "src/a.rs");
        assert_eq!(relative_path(root, Path::new("/elsewhere/x.rs")), "/elsewhere/x.rs");
    }

    #[test]
    fn ranking_prefers_exact_then_prefix() {
        assert!(rank("Foo", "foo") < rank("FooBar", "foo"));
        assert!(rank("FooBar", "foo") < rank("MyFoo", "foo"));
        assert!(rank("MyFoo", "foo") < rank("zzz", "foo"));
    }

    #[test]
    fn kind_filters_use_aliases() {
        assert!(kind_matches("method", "function"));
        assert!(kind_matches("interface", "type"));
        assert!(kind_matches("struct", "STRUCT"));
        assert!(!kind_matches("class", "function"));
    }

    #[test]
    fn previews_are_dedented_and_short() {
        let text = lines("fn a() {\n        let x = 1;\n\n        let y = 2;\n}");
        assert_eq!(preview(&text, 2), "let x = 1;\nlet y = 2;");
        assert_eq!(preview(&text, 99), "");
    }

    #[test]
    fn identifier_column_skips_keywords() {
        assert_eq!(first_identifier_column("pub async fn handler(x: u8)"), Some(13));
        assert_eq!(first_identifier_column("export class Foo {"), Some(13));
        assert_eq!(first_identifier_column("   "), None);
        assert_eq!(word_column("let foobar = foo;", "foo"), Some(13));
    }

    #[test]
    fn document_symbols_nest_and_resolve_by_name() {
        let value = json!([{
            "name": "Foo", "kind": 5,
            "range": { "start": { "line": 0, "character": 0 }, "end": { "line": 9, "character": 1 } },
            "selectionRange": { "start": { "line": 0, "character": 6 }, "end": { "line": 0, "character": 9 } },
            "children": [{
                "name": "bar", "kind": 6,
                "range": { "start": { "line": 2, "character": 2 }, "end": { "line": 4, "character": 3 } },
                "selectionRange": { "start": { "line": 2, "character": 4 }, "end": { "line": 2, "character": 7 } }
            }]
        }]);
        let symbols = parse_document_symbols(&value);
        assert_eq!(symbols[0].start_line, 1);
        assert_eq!(symbols[0].end_line, 10);
        let bar = find_symbol(&symbols, "Foo.bar").unwrap();
        assert_eq!((bar.sel_line, bar.sel_col), (2, 4));
        assert_eq!(find_symbol(&symbols, "bar").unwrap().name, "bar");
        assert_eq!(enclosing(&symbols, 4).unwrap().name, "bar");
        assert_eq!(enclosing(&symbols, 9).unwrap().name, "Foo");
        let outline = to_outline(&symbols);
        assert_eq!(outline[0].children[0].start_line, 3);
        assert_eq!(outline[0].children[0].kind, "method");
    }

    #[test]
    fn flat_symbol_information_is_supported() {
        let symbols = parse_document_symbols(&json!([{
            "name": "main", "kind": 12, "containerName": "app",
            "location": { "uri": "file:///w/m.rs",
                "range": { "start": { "line": 4, "character": 0 }, "end": { "line": 6, "character": 1 } } }
        }]));
        assert_eq!(symbols[0].start_line, 5);
        assert_eq!(symbols[0].container.as_deref(), Some("app"));
    }

    #[test]
    fn references_group_by_file_in_order() {
        let root = Path::new("/w");
        let place = |path: &str, line| Place { path: PathBuf::from(path), line, column: 1 };
        let groups = group_references(
            root,
            vec![place("/w/b.rs", 3), place("/w/a.rs", 9), place("/w/a.rs", 2), place("/w/a.rs", 2)],
            |_, line| format!("line {line}"),
        );
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].path, "a.rs");
        assert_eq!(groups[0].count, 2);
        assert_eq!(groups[0].references[0].snippet, "line 2");
        assert_eq!(groups[1].path, "b.rs");
    }

    #[test]
    fn declarations_are_recognised_across_languages() {
        assert_eq!(definition_of("pub(crate) async fn run()"), Some(("function", "run".into())));
        assert_eq!(definition_of("export default class Foo extends Bar {"), Some(("class", "Foo".into())));
        assert_eq!(definition_of("func (s *Server) Start() error {"), Some(("function", "Start".into())));
        assert_eq!(definition_of("def parse(self):"), Some(("function", "parse".into())));
        assert_eq!(definition_of("const MAX = 3;"), Some(("variable", "MAX".into())));
        assert_eq!(definition_of("// fn commented()"), None);
        assert_eq!(definition_of("foo(bar)"), None);
    }

    fn temp_tree() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "thinkrail-search-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::create_dir_all(dir.join("node_modules/dep")).unwrap();
        std::fs::write(
            dir.join("src/lib.rs"),
            "pub struct Widget {\n    id: u32,\n}\n\nfn make_widget() -> Widget {\n    Widget { id: 1 }\n}\n",
        )
        .unwrap();
        std::fs::write(dir.join("node_modules/dep/x.js"), "function widget() {}\n").unwrap();
        std::fs::write(dir.join("config.toml"), "widget_mode = \"fast\"\n").unwrap();
        dir
    }

    #[test]
    fn ripgrep_fallback_ranks_definitions_and_skips_dependencies() {
        let dir = temp_tree();
        let hits = text_symbol_search(&dir, "widget", None, 10);
        assert_eq!(hits[0].name, "Widget");
        assert_eq!(hits[0].kind, "struct");
        assert_eq!(hits[0].path, "src/lib.rs");
        assert_eq!(hits[0].line, 1);
        assert_eq!(hits[1].name, "make_widget");
        assert!(hits.iter().all(|h| !h.path.contains("node_modules")));
        let only_fn = text_symbol_search(&dir, "widget", Some("function"), 10);
        assert_eq!(only_fn.len(), 1);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn fallback_finds_config_mentions_when_no_definition_exists() {
        let dir = temp_tree();
        let hits = text_symbol_search(&dir, "widget_mode", None, 10);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "config.toml");
        assert_eq!(hits[0].kind, "text");
        std::fs::remove_dir_all(dir).ok();
    }

    #[tokio::test]
    async fn symbol_search_without_any_server_uses_text_fallback() {
        let dir = temp_tree();
        let pool = LspPool::default();
        let result = symbol_search(&pool, &dir, "make_widget", None, None).await.unwrap();
        assert_eq!(result.source, "text");
        assert_eq!(result.hits[0].line, 5);
        assert!(symbol_search(&pool, &dir, "  ", None, None).await.is_err());
        std::fs::remove_dir_all(dir).ok();
    }

    #[tokio::test]
    async fn outline_falls_back_to_text_heuristic() {
        let dir = temp_tree();
        let pool = LspPool::default();
        let outline = file_outline(&pool, &dir, "src/lib.rs").await.unwrap();
        assert_eq!(outline.source, "text");
        let names: Vec<_> = outline.nodes.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names, ["Widget", "make_widget"]);
        assert!(file_outline(&pool, &dir, "../outside.rs").await.is_err());
        std::fs::remove_dir_all(dir).ok();
    }

    /// End-to-end against a real `gopls`; skipped where it is not installed.
    #[tokio::test]
    async fn real_gopls_round_trip() {
        if which::which("gopls").is_err() || which::which("go").is_err() {
            eprintln!("skipping: gopls or go not installed");
            return;
        }
        let dir = std::env::temp_dir().join(format!("thinkrail-gopls-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("go.mod"), "module example.com/t

go 1.21
").unwrap();
        std::fs::write(
            dir.join("main.go"),
            "package main

func Greet(name string) string {
	return \"hi \" + name
}

func main() {
	_ = Greet(\"a\")
	_ = Greet(\"b\")
}
",
        )
        .unwrap();
        let pool = LspPool::default();

        let outline = file_outline(&pool, &dir, "main.go").await.unwrap();
        assert_eq!(outline.source, "lsp", "{:?}", outline.notes);
        let greet = outline.nodes.iter().find(|n| n.name == "Greet").unwrap();
        assert_eq!((greet.start_line, greet.end_line), (3, 5));

        let target = Target { symbol_name: Some("Greet".into()), ..Target::default() };
        let refs = find_references(&pool, &dir, "main.go", &target, false).await.unwrap();
        assert_eq!(refs.total, 2, "{refs:?}");
        assert_eq!(refs.groups[0].path, "main.go");
        assert_eq!(refs.groups[0].references[0].line, 8);

        let by_line = Target { line: Some(8), ..Target::default() };
        let defs = goto_definition(&pool, &dir, "main.go", &by_line).await.unwrap();
        assert_eq!(defs.definitions[0].line, 3);
        assert!(defs.definitions[0].block.starts_with("func Greet"));

        let symbols = symbol_search(&pool, &dir, "Greet", None, None).await.unwrap();
        assert_eq!(symbols.hits[0].name, "Greet");
        assert_eq!(symbols.hits[0].line, 3);

        pool.stop_all().await;
        std::fs::remove_dir_all(dir).ok();
    }
}
