//! Worktree-aware language-server detection.
//!
//! Detection only *finds* installed binaries; nothing is spawned until the
//! first query for a language (see `client::LspPool`).

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use serde::Serialize;

use super::registry::{load_overrides, LspOverride, LspSpec, BUILTIN_SPECS};

/// Directories whose immediate children are scanned for workspace packages.
const WORKSPACE_CONTAINERS: &[&str] = &["packages", "apps", "crates", "libs", "services", "cmd"];
/// Top-level directories never scanned for markers.
const SKIPPED_DIRS: &[&str] = &["node_modules", "target", "dist", "build", "vendor"];

/// Lifecycle of one detected server for the worktree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LspStatus {
    Detected,
    Starting,
    Ready,
    Error,
    Missing,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DetectedLspServer {
    pub id: String,
    pub language: String,
    /// The marker file that selected this language (workspace-relative).
    pub marker: String,
    pub binary_path: Option<String>,
    pub available: bool,
    pub install_hint: Option<String>,
    pub status: LspStatus,
}

/// A fully resolved launch plan for one server.
#[derive(Debug, Clone)]
pub struct LaunchPlan {
    pub binary: PathBuf,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub initialization_options: Option<serde_json::Value>,
}

fn is_dir_skipped(name: &str) -> bool {
    name.starts_with('.') || SKIPPED_DIRS.contains(&name)
}

fn child_dirs(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut dirs: Vec<PathBuf> = entries
        .flatten()
        .filter(|entry| entry.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter(|entry| !is_dir_skipped(&entry.file_name().to_string_lossy()))
        .map(|entry| entry.path())
        .collect();
    dirs.sort();
    dirs
}

/// Directories scanned for markers: the root, its direct children and the
/// children of conventional workspace containers.
fn scan_roots(worktree: &Path) -> Vec<PathBuf> {
    let mut roots = vec![worktree.to_path_buf()];
    for child in child_dirs(worktree) {
        let is_container = child
            .file_name()
            .map(|name| WORKSPACE_CONTAINERS.contains(&name.to_string_lossy().as_ref()))
            .unwrap_or(false);
        if is_container {
            roots.extend(child_dirs(&child));
        }
        roots.push(child);
    }
    roots
}

/// The first marker of `spec` found in the worktree, workspace-relative.
pub fn find_marker(worktree: &Path, spec: &LspSpec) -> Option<String> {
    for root in scan_roots(worktree) {
        for marker in spec.markers {
            if root.join(marker).is_file() {
                let relative = root.strip_prefix(worktree).unwrap_or(&root).join(marker);
                return Some(relative.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    None
}

/// Candidate paths of a worktree-local binary, in priority order.
fn local_candidates(worktree: &Path, bin: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let suffixes: &[&str] = if cfg!(windows) {
        &["", ".cmd", ".exe", ".bat"]
    } else {
        &[""]
    };
    let dirs: [PathBuf; 5] = [
        worktree.join("node_modules").join(".bin"),
        worktree.join(".venv").join("bin"),
        worktree.join("venv").join("bin"),
        worktree.join(".venv").join("Scripts"),
        worktree.join("venv").join("Scripts"),
    ];
    for dir in dirs {
        for suffix in suffixes {
            paths.push(dir.join(format!("{bin}{suffix}")));
        }
    }
    paths
}

/// Resolve `bin`: worktree-local toolchains first, then `fallback` (PATH).
pub fn resolve_binary_with(
    worktree: &Path,
    bin: &str,
    fallback: impl Fn(&str) -> Option<PathBuf>,
) -> Option<PathBuf> {
    let direct = Path::new(bin);
    if direct.is_absolute() {
        return is_executable_file(direct).then(|| direct.to_path_buf());
    }
    local_candidates(worktree, bin)
        .into_iter()
        .find(|path| is_executable_file(path))
        .or_else(|| fallback(bin))
}

pub fn resolve_binary(worktree: &Path, bin: &str) -> Option<PathBuf> {
    resolve_binary_with(worktree, bin, |name| which::which(name).ok())
}

/// A file the OS would let us run (the execute bit on Unix).
fn is_executable_file(path: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn candidate_binaries(spec: &LspSpec, entry: Option<&LspOverride>) -> Vec<String> {
    match entry.and_then(|entry| entry.command.clone()) {
        Some(command) => vec![command],
        None => spec.binaries.iter().map(|bin| (*bin).to_owned()).collect(),
    }
}

/// Detect servers for a worktree. `resolve` locates a binary by name.
pub fn detect_with(
    worktree: &Path,
    overrides: &HashMap<String, LspOverride>,
    resolve: impl Fn(&str) -> Option<PathBuf>,
) -> Vec<DetectedLspServer> {
    let mut servers = Vec::new();
    for spec in BUILTIN_SPECS {
        let entry = overrides.get(spec.id);
        if entry.is_some_and(|entry| entry.disabled == Some(true)) {
            continue;
        }
        let Some(marker) = find_marker(worktree, spec) else {
            continue;
        };
        let binary = candidate_binaries(spec, entry)
            .iter()
            .find_map(|bin| resolve(bin));
        let available = binary.is_some();
        servers.push(DetectedLspServer {
            id: spec.id.to_owned(),
            language: spec.language.to_owned(),
            marker,
            binary_path: binary.map(|path| path.to_string_lossy().into_owned()),
            available,
            install_hint: (!available).then(|| spec.install_hint.to_owned()),
            status: if available {
                LspStatus::Detected
            } else {
                LspStatus::Missing
            },
        });
    }
    servers
}

/// Detect servers using the real filesystem and PATH.
pub fn detect(worktree: &Path) -> Vec<DetectedLspServer> {
    let overrides = load_overrides(worktree);
    detect_with(worktree, &overrides, |bin| resolve_binary(worktree, bin))
}

/// Build the launch plan for server `id`, if it is detected and available.
pub fn launch_plan(worktree: &Path, id: &str) -> Option<LaunchPlan> {
    let spec = super::registry::spec_by_id(id)?;
    let overrides = load_overrides(worktree);
    let entry = overrides.get(id);
    if entry.is_some_and(|entry| entry.disabled == Some(true)) || find_marker(worktree, spec).is_none() {
        return None;
    }
    let binary = candidate_binaries(spec, entry)
        .iter()
        .find_map(|bin| resolve_binary(worktree, bin))?;
    let is_jedi = binary
        .file_stem()
        .is_some_and(|stem| stem.to_string_lossy() == "jedi-language-server");
    let args = entry.and_then(|entry| entry.args.clone()).unwrap_or_else(|| {
        if is_jedi {
            Vec::new() // jedi speaks stdio by default and rejects `--stdio`
        } else {
            spec.args.iter().map(|arg| (*arg).to_owned()).collect()
        }
    });
    Some(LaunchPlan {
        binary,
        args,
        env: entry.and_then(|entry| entry.env.clone()).unwrap_or_default(),
        initialization_options: entry.and_then(|entry| entry.initialization_options.clone()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "thinkrail-lsp-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn markers_select_languages_including_workspace_packages() {
        let dir = temp_dir("markers");
        fs::write(dir.join("Cargo.toml"), "").unwrap();
        fs::create_dir_all(dir.join("packages/web")).unwrap();
        fs::write(dir.join("packages/web/tsconfig.json"), "").unwrap();
        fs::create_dir_all(dir.join("node_modules/dep")).unwrap();
        fs::write(dir.join("node_modules/dep/go.mod"), "").unwrap();
        let found = detect_with(&dir, &HashMap::new(), |_| None);
        let ids: Vec<_> = found.iter().map(|s| s.id.as_str()).collect();
        assert!(ids.contains(&"rust"));
        assert!(ids.contains(&"typescript"));
        assert!(!ids.contains(&"go"), "node_modules is never scanned");
        let ts = found.iter().find(|s| s.id == "typescript").unwrap();
        assert_eq!(ts.marker, "packages/web/tsconfig.json");
        assert_eq!(ts.status, LspStatus::Missing);
        assert!(ts.install_hint.is_some());
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn available_server_has_no_install_hint() {
        let dir = temp_dir("available");
        fs::write(dir.join("go.mod"), "").unwrap();
        let found = detect_with(&dir, &HashMap::new(), |bin| {
            (bin == "gopls").then(|| PathBuf::from("/usr/bin/gopls"))
        });
        assert_eq!(found.len(), 1);
        assert!(found[0].available);
        assert_eq!(found[0].status, LspStatus::Detected);
        assert!(found[0].install_hint.is_none());
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn worktree_local_binaries_beat_path() {
        let dir = temp_dir("local");
        let bin_dir = dir.join("node_modules").join(".bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let name = if cfg!(windows) { "vtsls.cmd" } else { "vtsls" };
        fs::write(bin_dir.join(name), "").unwrap();
        let resolved = resolve_binary_with(&dir, "vtsls", |_| Some(PathBuf::from("/global/vtsls")));
        assert_eq!(resolved, Some(bin_dir.join(name)));
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn venv_beats_path_and_path_is_the_fallback() {
        let dir = temp_dir("venv");
        let venv = dir.join(".venv").join(if cfg!(windows) { "Scripts" } else { "bin" });
        fs::create_dir_all(&venv).unwrap();
        let name = if cfg!(windows) { "gopls.exe" } else { "gopls" };
        fs::write(venv.join(name), "").unwrap();
        assert_eq!(
            resolve_binary_with(&dir, "gopls", |_| Some(PathBuf::from("/g/gopls"))),
            Some(venv.join(name))
        );
        assert_eq!(
            resolve_binary_with(&dir, "other", |_| Some(PathBuf::from("/g/other"))),
            Some(PathBuf::from("/g/other"))
        );
        assert_eq!(resolve_binary_with(&dir, "none", |_| None), None);
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn disabled_and_custom_command_overrides() {
        let dir = temp_dir("override");
        fs::write(dir.join("go.mod"), "").unwrap();
        fs::write(dir.join("Cargo.toml"), "").unwrap();
        let overrides = super::super::registry::parse_overrides(
            r#"{"go":{"disabled":true},"rust":{"command":"my-ra"}}"#,
        );
        let found = detect_with(&dir, &overrides, |bin| {
            (bin == "my-ra").then(|| PathBuf::from("/x/my-ra"))
        });
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, "rust");
        assert_eq!(found[0].binary_path.as_deref(), Some("/x/my-ra"));
        fs::remove_dir_all(dir).ok();
    }
}
