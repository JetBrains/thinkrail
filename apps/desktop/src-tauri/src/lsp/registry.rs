//! Built-in language-server catalog and `lsp.json` overrides.
//!
//! Each [`LspSpec`] maps project root markers and file extensions to the
//! candidate server binaries (priority order) and their stdio flags. Users
//! and projects can adjust or disable a server through `~/.thinkrail/lsp.json`
//! and `<worktree>/.thinkrail/lsp.json`; the project file wins.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use serde::Deserialize;
use serde_json::Value;

/// One built-in language server family.
#[derive(Debug, Clone, Copy)]
pub struct LspSpec {
    pub id: &'static str,
    pub language: &'static str,
    /// Files whose presence marks a project root for this language.
    pub markers: &'static [&'static str],
    /// File extensions (no dot) this server answers for.
    pub extensions: &'static [&'static str],
    /// Candidate binaries, tried in order.
    pub binaries: &'static [&'static str],
    pub args: &'static [&'static str],
    pub install_hint: &'static str,
}

pub const BUILTIN_SPECS: &[LspSpec] = &[
    LspSpec {
        id: "typescript",
        language: "TypeScript / JavaScript",
        markers: &["tsconfig.json", "jsconfig.json", "package.json"],
        extensions: &["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"],
        binaries: &["vtsls", "typescript-language-server"],
        args: &["--stdio"],
        install_hint: "npm install -g @vtsls/language-server  (or typescript-language-server typescript)",
    },
    LspSpec {
        id: "rust",
        language: "Rust",
        markers: &["Cargo.toml"],
        extensions: &["rs"],
        binaries: &["rust-analyzer"],
        args: &[],
        install_hint: "rustup component add rust-analyzer",
    },
    LspSpec {
        id: "python",
        language: "Python",
        markers: &["pyproject.toml", "pyrightconfig.json", "requirements.txt"],
        extensions: &["py", "pyi"],
        binaries: &[
            "basedpyright-langserver",
            "pyright-langserver",
            "jedi-language-server",
        ],
        args: &["--stdio"],
        install_hint: "pipx install basedpyright  (or npm install -g pyright)",
    },
    LspSpec {
        id: "go",
        language: "Go",
        markers: &["go.mod"],
        extensions: &["go"],
        binaries: &["gopls"],
        args: &["serve"],
        install_hint: "go install golang.org/x/tools/gopls@latest",
    },
    LspSpec {
        id: "cpp",
        language: "C / C++",
        markers: &["compile_commands.json", "CMakeLists.txt"],
        extensions: &["c", "h", "cc", "cpp", "cxx", "hpp", "hh", "hxx"],
        binaries: &["clangd"],
        args: &[],
        install_hint: "Install clangd (LLVM): brew install llvm / apt install clangd / winget install LLVM.LLVM",
    },
    LspSpec {
        id: "svelte",
        language: "Svelte",
        markers: &["svelte.config.js", "svelte.config.ts"],
        extensions: &["svelte"],
        binaries: &["svelteserver"],
        args: &["--stdio"],
        install_hint: "npm install -g svelte-language-server",
    },
    LspSpec {
        id: "vue",
        language: "Vue",
        markers: &["vue.config.js", "vue.config.ts", "nuxt.config.js", "nuxt.config.ts"],
        extensions: &["vue"],
        binaries: &["vue-language-server"],
        args: &["--stdio"],
        install_hint: "npm install -g @vue/language-server",
    },
    LspSpec {
        id: "astro",
        language: "Astro",
        markers: &["astro.config.mjs", "astro.config.ts"],
        extensions: &["astro"],
        binaries: &["astro-ls"],
        args: &["--stdio"],
        install_hint: "npm install -g @astrojs/language-server",
    },
];

/// LSP `languageId` for a file extension.
pub fn language_id(extension: &str) -> &'static str {
    match extension {
        "ts" | "mts" | "cts" => "typescript",
        "tsx" => "typescriptreact",
        "js" | "mjs" | "cjs" => "javascript",
        "jsx" => "javascriptreact",
        "rs" => "rust",
        "py" | "pyi" => "python",
        "go" => "go",
        "c" | "h" => "c",
        "cc" | "cpp" | "cxx" | "hpp" | "hh" | "hxx" => "cpp",
        "svelte" => "svelte",
        "vue" => "vue",
        "astro" => "astro",
        _ => "plaintext",
    }
}

/// The spec that answers for `extension`, if any.
pub fn spec_for_extension(extension: &str) -> Option<&'static LspSpec> {
    BUILTIN_SPECS
        .iter()
        .find(|spec| spec.extensions.contains(&extension))
}

pub fn spec_by_id(id: &str) -> Option<&'static LspSpec> {
    BUILTIN_SPECS.iter().find(|spec| spec.id == id)
}

/// One entry of an `lsp.json` file, keyed by server id.
#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LspOverride {
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<HashMap<String, String>>,
    pub initialization_options: Option<Value>,
    pub disabled: Option<bool>,
}

/// Parse an `lsp.json` document: a map of server id to override.
pub fn parse_overrides(text: &str) -> HashMap<String, LspOverride> {
    serde_json::from_str(text).unwrap_or_default()
}

fn read_overrides(path: &Path) -> HashMap<String, LspOverride> {
    std::fs::read_to_string(path)
        .map(|text| parse_overrides(&text))
        .unwrap_or_default()
}

/// Location of the user-level override file.
pub fn user_override_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    Some(PathBuf::from(home).join(".thinkrail").join("lsp.json"))
}

/// Merge `user` and `project` overrides; a project entry replaces the user
/// entry field by field.
pub fn merge_overrides(
    user: HashMap<String, LspOverride>,
    project: HashMap<String, LspOverride>,
) -> HashMap<String, LspOverride> {
    let mut merged = user;
    for (id, entry) in project {
        let slot = merged.entry(id).or_default();
        if entry.command.is_some() {
            slot.command = entry.command;
        }
        if entry.args.is_some() {
            slot.args = entry.args;
        }
        if entry.env.is_some() {
            slot.env = entry.env;
        }
        if entry.initialization_options.is_some() {
            slot.initialization_options = entry.initialization_options;
        }
        if entry.disabled.is_some() {
            slot.disabled = entry.disabled;
        }
    }
    merged
}

/// A repository must not choose what the shell executes: a project file may only disable a
/// server or tune `initializationOptions`; `command`, `args` and `env` come from the user file.
pub fn strip_executable_fields(entries: &mut HashMap<String, LspOverride>) {
    for entry in entries.values_mut() {
        entry.command = None;
        entry.args = None;
        entry.env = None;
    }
}

/// Overrides in effect for a worktree.
pub fn load_overrides(worktree: &Path) -> HashMap<String, LspOverride> {
    let user = user_override_path()
        .map(|path| read_overrides(&path))
        .unwrap_or_default();
    let mut project = read_overrides(&worktree.join(".thinkrail").join("lsp.json"));
    strip_executable_fields(&mut project);
    merge_overrides(user, project)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_has_unique_ids_and_binaries() {
        let mut ids: Vec<_> = BUILTIN_SPECS.iter().map(|spec| spec.id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), BUILTIN_SPECS.len());
        assert!(BUILTIN_SPECS.iter().all(|spec| !spec.binaries.is_empty()));
    }

    #[test]
    fn extension_lookup() {
        assert_eq!(spec_for_extension("rs").map(|s| s.id), Some("rust"));
        assert_eq!(spec_for_extension("tsx").map(|s| s.id), Some("typescript"));
        assert!(spec_for_extension("zzz").is_none());
        assert_eq!(language_id("tsx"), "typescriptreact");
    }

    #[test]
    fn project_overrides_win_field_by_field() {
        let user = parse_overrides(r#"{"rust":{"command":"ra-user","args":["--a"]}}"#);
        let project = parse_overrides(r#"{"rust":{"command":"ra-proj"},"go":{"disabled":true}}"#);
        let merged = merge_overrides(user, project);
        assert_eq!(merged["rust"].command.as_deref(), Some("ra-proj"));
        assert_eq!(merged["rust"].args.as_deref(), Some(&["--a".to_owned()][..]));
        assert_eq!(merged["go"].disabled, Some(true));
    }

    #[test]
    fn project_files_cannot_choose_executables_and_can_reenable() {
        let mut project = parse_overrides(
            r#"{"rust":{"command":"/tmp/evil","args":["x"],"env":{"A":"b"},"disabled":false}}"#,
        );
        strip_executable_fields(&mut project);
        let user = parse_overrides(r#"{"rust":{"disabled":true}}"#);
        let merged = merge_overrides(user, project);
        assert_eq!(merged["rust"].command, None);
        assert_eq!(merged["rust"].args, None);
        assert_eq!(merged["rust"].disabled, Some(false));
    }

    #[test]
    fn malformed_override_file_is_ignored() {
        assert!(parse_overrides("not json").is_empty());
    }
}
