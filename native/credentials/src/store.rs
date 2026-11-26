// native/credentials/src/store.rs
use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const SERVICE: &str = "app.chelys.poc";
const DEFAULT_USER: &str = "default";
const MAX_FILE_BYTES: u64 = 65_536;

fn credential_user() -> Result<String, String> {
    let user = std::env::var("CHELYS_CREDENTIAL_ID").unwrap_or_else(|_| DEFAULT_USER.into());
    if user.len() > 64 || user.is_empty() || !user.bytes().all(|byte| {
        byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.')
    }) {
        return Err("CHELYS_CREDENTIAL_ID must be 1-64 ASCII letters, digits, dots, underscores or dashes".into());
    }
    Ok(user)
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct StoredCredentials {
    pub username: String,
    pub password: String,
    pub prf_output_hex: String,
}

impl StoredCredentials {
    pub fn validate(&self) -> Result<(), String> {
        if self.username.trim().is_empty() || self.password.is_empty() {
            return Err("Username and password are required".into());
        }
        let hex = self.prf_output_hex.as_bytes();
        if hex.is_empty() || hex.len() % 2 != 0 || !hex.iter().all(u8::is_ascii_hexdigit) {
            return Err("PRF must contain complete hexadecimal bytes".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStatus {
    pub backend: &'static str,
    pub warning: Option<String>,
    pub migrated: bool,
}

impl StorageStatus {
    fn keyring(migrated: bool) -> Self {
        Self { backend: "keyring", warning: None, migrated }
    }
    fn file(reason: &str) -> Self {
        Self {
            backend: "file",
            warning: Some(format!(
                "OS credential store unavailable ({reason}). Chelys is using a plaintext account JSON fallback for your password and PRF. Protect the file and backups; migration to the keyring will happen automatically when it is available."
            )),
            migrated: false,
        }
    }
    fn unavailable(reason: &str) -> Self {
        Self {
            backend: "file",
            warning: Some(format!(
                "OS credential store unavailable ({reason}). If you log in, Chelys will save credentials in a private plaintext account JSON file until the keyring recovers."
            )),
            migrated: false,
        }
    }
    fn logout_pending(reason: &str) -> Self {
        Self {
            backend: "file",
            warning: Some(format!(
                "OS credential store unavailable ({reason}). Your session is logged out; a non-secret logout marker prevents an old keyring entry from restoring it until the keyring can be cleared."
            )),
            migrated: false,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialLoad {
    pub credentials: Option<StoredCredentials>,
    pub storage: StorageStatus,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct LoggedOut {
    logged_out: bool,
}

enum FileRecord {
    Credentials(StoredCredentials),
    Logout,
}

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, &credential_user()?).map_err(|error| format!("OS credential store unavailable: {error}"))
}

fn keyring_load() -> Result<Option<StoredCredentials>, String> {
    match entry()?.get_password() {
        Ok(json) => {
            let credentials: StoredCredentials = serde_json::from_str(&json)
                .map_err(|error| format!("Invalid credentials in OS store: {error}"))?;
            credentials.validate()?;
            Ok(Some(credentials))
        }
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("Cannot read OS credential store: {error}")),
    }
}

fn keyring_save(credentials: &StoredCredentials) -> Result<(), String> {
    let json = serde_json::to_string(credentials).map_err(|error| error.to_string())?;
    entry()?.set_password(&json).map_err(|error| format!("Cannot write OS credential store: {error}"))?;
    if keyring_load()?.as_ref() != Some(credentials) {
        return Err("OS credential write could not be verified".into());
    }
    Ok(())
}

fn keyring_clear() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => {},
        Err(error) => return Err(format!("Cannot delete OS credential: {error}")),
    }
    if keyring_load()?.is_some() {
        return Err("OS credential deletion could not be verified".into());
    }
    Ok(())
}

fn file_path(directory: &Path) -> Result<std::path::PathBuf, String> {
    let id = credential_user()?;
    let filename = if id == DEFAULT_USER {
        "account.json".to_owned()
    } else {
        format!("account.{id}.json")
    };
    Ok(directory.join(filename))
}

fn check_file(directory: &Path) -> Result<Option<fs::Metadata>, String> {
    let path = file_path(directory)?;
    let metadata = match fs::symlink_metadata(&path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Cannot inspect account.json: {error}")),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > MAX_FILE_BYTES {
        return Err("Unsafe account.json: expected a regular file of at most 64 KiB".into());
    }
    #[cfg(unix)] {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};

        unsafe extern "C" { fn geteuid() -> u32; }
        if metadata.uid() != unsafe { geteuid() } {
            return Err("Unsafe account.json: not owned by the current user".into());
        }
        if metadata.permissions().mode() & 0o077 != 0 {
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
                .map_err(|error| format!("Cannot restrict account.json permissions: {error}"))?;
        }
    }
    Ok(Some(metadata))
}

fn read_file(directory: &Path) -> Result<Option<FileRecord>, String> {
    if check_file(directory)?.is_none() { return Ok(None); }
    let path = file_path(directory)?;

    let mut file = OpenOptions::new().read(true).open(&path)
        .map_err(|error| format!("Cannot open account.json: {error}"))?;
    #[cfg(unix)] {
        use std::os::unix::fs::MetadataExt;
        let opened = file.metadata().map_err(|error| error.to_string())?;
        let inspected = check_file(directory)?.ok_or("account.json changed while opening")?;
        if opened.ino() != inspected.ino() || opened.dev() != inspected.dev() {
            return Err("account.json changed while opening".into());
        }
    }
    let mut raw = String::new();
    Read::by_ref(&mut file).take(MAX_FILE_BYTES + 1).read_to_string(&mut raw)
        .map_err(|error| format!("Cannot read account.json: {error}"))?;
    if raw.len() as u64 > MAX_FILE_BYTES { return Err("account.json exceeds 64 KiB".into()); }
    let value: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|error| format!("Invalid account.json: {error}"))?;
    if value.get("logged_out").is_some() {
        let marker: LoggedOut = serde_json::from_value(value)
            .map_err(|_| "Invalid account logout marker".to_owned())?;
        if !marker.logged_out { return Err("Invalid account logout marker".into()); }
        return Ok(Some(FileRecord::Logout));
    }
    let credentials: StoredCredentials = serde_json::from_value(value)
        .map_err(|error| format!("Invalid account.json credentials: {error}"))?;
    credentials.validate()?;
    Ok(Some(FileRecord::Credentials(credentials)))
}

fn ensure_private_dir(directory: &Path) -> Result<(), String> {
    #[cfg(unix)] {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true).mode(0o700);
        builder.create(directory).map_err(|error| format!("Cannot create credential directory: {error}"))?;
        let metadata = fs::symlink_metadata(directory).map_err(|error| error.to_string())?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err("Unsafe credential directory".into());
        }
        if metadata.permissions().mode() & 0o077 != 0 {
            fs::set_permissions(directory, fs::Permissions::from_mode(0o700))
                .map_err(|error| format!("Cannot protect credential directory: {error}"))?;
        }
    }
    #[cfg(not(unix))] {
        fs::create_dir_all(directory).map_err(|error| format!("Cannot create credential directory: {error}"))?;
        if fs::symlink_metadata(directory).map_err(|error| error.to_string())?.file_type().is_symlink() {
            return Err("Unsafe credential directory".into());
        }
    }
    Ok(())
}

fn acquire_lock(directory: &Path) -> Result<fs::File, String> {
    use std::fs::TryLockError;
    use std::thread;
    ensure_private_dir(directory)?;
    let id = credential_user()?;
    let lock_path = directory.join(format!(".credentials-{id}.lock"));
    if let Ok(meta) = fs::symlink_metadata(&lock_path) {
        if !meta.is_file() || meta.file_type().is_symlink() {
            return Err("Unsafe credential lock file".into());
        }
    }
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(unix)] {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(&lock_path).map_err(|error| format!("Cannot open credential lock: {error}"))?;
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match file.try_lock() {
            Ok(()) => return Ok(file),
            Err(TryLockError::WouldBlock) if Instant::now() < deadline => {
                thread::sleep(Duration::from_millis(50));
            }
            Err(TryLockError::WouldBlock) => return Err("Credential store is busy; retry".into()),
            Err(TryLockError::Error(error)) => return Err(format!("Credential lock failed: {error}")),
        }
    }
}

fn write_file(directory: &Path, payload: &str) -> Result<(), String> {
    if payload.len() as u64 > MAX_FILE_BYTES { return Err("Credential payload too large".into()); }
    ensure_private_dir(directory)?;
    check_file(directory)?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?.as_nanos();
    let temp = directory.join(format!(".account-{}-{stamp}.tmp", std::process::id()));
    let mut opts = OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)] {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let result = (|| -> Result<(), String> {
        let mut file = opts.open(&temp).map_err(|error| format!("Cannot create credential file: {error}"))?;
        file.write_all(payload.as_bytes()).map_err(|error| format!("Cannot write credential file: {error}"))?;
        file.sync_all().map_err(|error| format!("Cannot sync credential file: {error}"))?;
        fs::rename(&temp, file_path(directory)?).map_err(|error| format!("Cannot replace account.json: {error}"))?;
        Ok(())
    })();
    if result.is_err() { let _ = fs::remove_file(&temp); }
    result
}

fn remove_file(directory: &Path) -> Result<(), String> {
    if check_file(directory)?.is_some() {
        fs::remove_file(file_path(directory)?)
            .map_err(|error| format!("Cannot remove account.json: {error}"))?;
    }
    Ok(())
}

pub fn load(directory: &Path) -> Result<CredentialLoad, String> {
    let _lock = acquire_lock(directory)?;
    if let Some(record) = read_file(directory)? {
        match record {
            FileRecord::Credentials(credentials) => {

                match keyring_save(&credentials) {
                    Ok(()) => {
                        if let Err(error) = remove_file(directory) {
                            return Ok(CredentialLoad { credentials: Some(credentials), storage: StorageStatus::file(&format!("Keyring restored, but {error}")) });
                        }
                        return Ok(CredentialLoad { credentials: Some(credentials), storage: StorageStatus::keyring(true) });
                    }
                    Err(error) => return Ok(CredentialLoad { credentials: Some(credentials), storage: StorageStatus::file(&error) }),
                }
            }
            FileRecord::Logout => {
                return match keyring_clear() {
                    Ok(()) => {
                        remove_file(directory)?;
                        Ok(CredentialLoad { credentials: None, storage: StorageStatus::keyring(true) })
                    }
                    Err(error) => Ok(CredentialLoad { credentials: None, storage: StorageStatus::logout_pending(&error) }),
                };
            }
        }
    }
    match keyring_load() {
        Ok(credentials) => Ok(CredentialLoad { credentials, storage: StorageStatus::keyring(false) }),
        Err(error) => Ok(CredentialLoad { credentials: None, storage: StorageStatus::unavailable(&error) }),
    }
}

pub fn save(credentials: StoredCredentials, directory: &Path) -> Result<StorageStatus, String> {
    credentials.validate()?;
    let _lock = acquire_lock(directory)?;
    match keyring_save(&credentials) {
        Ok(()) => {
            if let Err(error) = remove_file(directory) {

                write_file(directory, &serde_json::to_string(&credentials).map_err(|e| e.to_string())?)?;
                return Ok(StorageStatus::file(&format!("Keyring write succeeded, but {error}")));
            }
            Ok(StorageStatus::keyring(false))
        }
        Err(error) => {
            write_file(directory, &serde_json::to_string(&credentials).map_err(|e| e.to_string())?)?;
            Ok(StorageStatus::file(&error))
        }
    }
}

pub fn clear(directory: &Path) -> Result<StorageStatus, String> {
    let _lock = acquire_lock(directory)?;
    match keyring_clear() {
        Ok(()) => {
            remove_file(directory)?;
            Ok(StorageStatus::keyring(false))
        }
        Err(error) => {

            write_file(directory, "{\"logged_out\":true}")?;
            Ok(StorageStatus::logout_pending(&error))
        }
    }
}
