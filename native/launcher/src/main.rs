// native/launcher/src/main.rs
use std::env;
use std::process::{Command, ExitCode};

#[path = "../../runtime_locator.rs"]
mod runtime_locator;

fn main() -> ExitCode {
    let result = (|| -> Result<i32, String> {
        let exe = env::current_exe().map_err(|error| error.to_string())?;
        let exe = exe.canonicalize().unwrap_or(exe);
        let runtime = runtime_locator::find_runtime(&exe)?;
        let node = runtime.join(if cfg!(windows) { "node.exe" } else { "node" });
        let cli = runtime.join("server/cli.mjs");
        let mut child = Command::new(node)
            .arg(cli)
            .args(env::args_os().skip(1))
            .spawn()
            .map_err(|error| format!("Cannot start Chelys CLI: {error}"))?;
        let status = child.wait().map_err(|error| error.to_string())?;
        Ok(status.code().unwrap_or(1))
    })();
    match result {
        Ok(code) => ExitCode::from(u8::try_from(code).unwrap_or(1)),
        Err(error) => {
            eprintln!("Chelys: {error}");
            ExitCode::FAILURE
        }
    }
}
