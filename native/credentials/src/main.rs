// native/credentials/src/main.rs
mod store;

use std::io::{self, Read};
use std::path::PathBuf;

fn run() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    let operation = args.next().ok_or("Expected get, set, delete, or check")?;
    if args.next().is_some() { return Err("Expected exactly one operation".into()); }
    let data_dir = std::env::var_os("CHELYS_DATA_DIR")
        .map(PathBuf::from)
        .ok_or("CHELYS_DATA_DIR must be set by the headless adapter")?;
    match operation.as_str() {
        "get" => {
            println!("{}", serde_json::to_string(&store::load(&data_dir)?)
                .map_err(|error| format!("Cannot encode response: {error}"))?);
        }
        "set" => {
            let mut input = String::new();
            io::stdin().take(65_537).read_to_string(&mut input)
                .map_err(|error| format!("Cannot read credentials: {error}"))?;
            if input.len() > 65_536 { return Err("Credential input exceeds 64 KiB".into()); }
            let value: store::StoredCredentials = serde_json::from_str(&input)
                .map_err(|_| "Invalid credential payload".to_owned())?;
            println!("{}", serde_json::json!({ "storage": store::save(value, &data_dir)? }));
        }
        "delete" => {
            println!("{}", serde_json::json!({ "storage": store::clear(&data_dir)? }));
        }
        "check" => {
            let loaded = store::load(&data_dir)?;
            println!("{}", serde_json::json!({
                "storage": loaded.storage,
                "stored": loaded.credentials.is_some(),
            }));
        }
        _ => return Err("Unknown keychain operation".into()),
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("chelys-credentials: {error}");
        std::process::exit(1);
    }
}
