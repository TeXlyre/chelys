// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::process::{Command, ExitCode};

#[path = "../../native/runtime_locator.rs"]
mod runtime_locator;

fn cli_command(args: &[std::ffi::OsString]) -> bool {
    let first = args.first().and_then(|arg| arg.to_str()).unwrap_or_default();
    matches!(first,
        "serve" | "shell" | "status" | "machine" | "login" | "logout" |
        "credentials" | "account" | "settings" | "profile" | "recipes" | "runtime" |
        "access" | "peers" | "--show-prf" | "--open-texlyre" |
        "--peer" | "--local" | "--headless" | "--help" | "-h"
    )
}

fn run_cli(mut arguments: Vec<std::ffi::OsString>) -> ExitCode {
    let result = (|| -> Result<i32, String> {
        let exe = env::current_exe().map_err(|error| error.to_string())?;
        let launcher = runtime_locator::find_launcher(&exe)?;
        if arguments.first().and_then(|arg| arg.to_str()) == Some("--headless") {
            arguments.remove(0);
            arguments.insert(0, "serve".into());
        }
        let code = Command::new(launcher)
            .args(arguments)
            .status()
            .map_err(|error| error.to_string())?;
        Ok(code.code().unwrap_or(1))
    })();
    match result {
        Ok(code) => ExitCode::from(u8::try_from(code).unwrap_or(1)),
        Err(error) => {
            eprintln!("Chelys: {error}");
            ExitCode::FAILURE
        }
    }
}

fn main() -> ExitCode {
    let args: Vec<_> = env::args_os().skip(1).collect();
    if args.first().and_then(|arg| arg.to_str()) == Some("--autostart")
        && chelys_app_lib::autostart_headless()
    {
        return run_cli(vec!["--headless".into()]);
    }
    if cli_command(&args) { return run_cli(args); }
    chelys_app_lib::run();
    ExitCode::SUCCESS
}
