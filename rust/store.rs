use crate::{items::Item, terminal, Result};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::path::PathBuf;

pub fn home() -> Result<PathBuf> {
    Ok(PathBuf::from(
        terminal::env("HOME").ok_or("HOME is missing")?,
    ))
}
pub fn scoped_dir(terminal: &str, assistant: &str, identity: &str) -> Result<PathBuf> {
    let scope = if terminal == "tmux" && assistant == "claude-code" {
        identity.to_owned()
    } else {
        serde_json::to_string(&[terminal, assistant, identity])?
    };
    let root = match terminal::env("XDG_CACHE_HOME") {
        Some(p) => PathBuf::from(p),
        None => home()?.join(".cache"),
    };
    Ok(root
        .join("shell-handoff")
        .join(format!("{:x}", Sha256::digest(scope.as_bytes()))))
}
pub fn write_items(terminal: &str, assistant: &str, pane: &str, items: &[Item]) -> Result<()> {
    let key = terminal::key(terminal, pane)?;
    let dir = scoped_dir(terminal, assistant, &terminal::scope(terminal)?)?;
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(&dir)?;
    let mut temp = tempfile::NamedTempFile::new_in(&dir)?;
    temp.as_file()
        .set_permissions(std::fs::Permissions::from_mode(0o600))?;
    serde_json::to_writer(&mut temp, items)?;
    temp.flush()?;
    temp.persist(dir.join(format!("{key}.json")))?;
    Ok(())
}
