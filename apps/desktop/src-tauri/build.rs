fn main() {
    // `permissions/bridge.toml` is the app's own ACL manifest: it names the
    // commands the sidecar origin may call. tauri-build picks the directory
    // up by default; a change to it must rebuild the generated ACL.
    println!("cargo:rerun-if-changed=permissions");
    tauri_build::build()
}
