// native/runtime_locator.rs
use std::env;
use std::path::{Path, PathBuf};

// Each executable includes this module but uses only its own locator.
#[allow(dead_code)]
pub fn find_launcher(exe: &Path) -> Result<PathBuf, String> {
    let folder = exe.parent().ok_or("Chelys executable directory unavailable")?;
    let filename = if cfg!(windows) { "chelys-runtime.exe" } else { "chelys-runtime" };
    for candidate in [
        folder.join(filename),
        folder.join("../lib/chelys").join(filename),
        folder.join("../Resources").join(filename),
    ] {
        if candidate.is_file() { return Ok(candidate); }
    }
    Err("Chelys headless runtime is not installed; reinstall Chelys".into())
}

#[allow(dead_code)]
pub fn find_runtime(exe: &Path) -> Result<PathBuf, String> {
    if let Ok(value) = env::var("CHELYS_RUNTIME_DIR") {
        let candidate = PathBuf::from(value);
        if candidate.join("server/cli.mjs").is_file() { return Ok(candidate); }
        return Err("CHELYS_RUNTIME_DIR does not contain the Chelys runtime".into());
    }
    let folder = exe.parent().ok_or("Chelys executable directory unavailable")?;
    for candidate in [
        folder.join("runtime"),
        folder.join("resources/runtime"),
        folder.join("../Resources/runtime"),
        folder.join("../resources/runtime"),
        folder.join("../lib/chelys/runtime"),
    ] {
        if candidate.join("server/cli.mjs").is_file() { return Ok(candidate); }
    }
    Err("Chelys headless runtime is not installed beside the application".into())
}
