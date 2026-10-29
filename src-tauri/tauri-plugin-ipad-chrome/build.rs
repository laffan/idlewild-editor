// No commands: the Swift half does its work as it loads, and the page only
// listens for its events — see permissions/default.toml.
const COMMANDS: &[&str] = &[];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
