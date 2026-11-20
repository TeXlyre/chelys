// src-tauri/src/ownership.rs
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

#[derive(Debug, Copy, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OwnerMode { Automatic, Desktop, Headless }

impl OwnerMode {
    pub fn label(self) -> &'static str {
        match self { Self::Automatic => "automatic", Self::Desktop => "desktop", Self::Headless => "headless" }
    }
}

#[derive(Serialize, Deserialize)]
struct Preference { mode: OwnerMode }

pub fn read(directory: &Path) -> Result<OwnerMode, String> {
    let file = directory.join("instance-owner.json");
    match fs::read_to_string(file) {
        Ok(contents) => serde_json::from_str::<Preference>(&contents)
            .map(|value| value.mode).map_err(|error| format!("Invalid instance-owner.json: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(OwnerMode::Automatic),
        Err(error) => Err(error.to_string()),
    }
}

pub fn write(directory: &Path, mode: OwnerMode) -> Result<(), String> {
    let destination = directory.join("instance-owner.json");
    let temporary = directory.join(format!("instance-owner.{}.tmp", uuid::Uuid::new_v4()));
    let body = serde_json::to_vec_pretty(&Preference { mode }).map_err(|error| error.to_string())?;
    let result = (|| -> Result<(), String> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)] {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        use std::io::Write;
        let mut file = options.open(&temporary).map_err(|error| error.to_string())?;
        file.write_all(&body).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        replace_file(&temporary, &destination)?;
        Ok(())
    })();
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result
}

// Matches server/ownership.mjs. This lock protects the startup probe/bind only;
// the socket/pipe itself is the lifetime ownership marker.
pub struct StartupClaim { path: PathBuf }

impl StartupClaim {
    pub fn acquire(directory: &Path) -> Result<Self, String> {
        let path = directory.join(".instance-startup.lock");
        let deadline = Instant::now() + Duration::from_secs(35);
        loop {
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)] {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            match options.open(&path) {
                Ok(mut file) => {
                    use std::io::Write;
                    if let Err(error) = writeln!(file, "{}", std::process::id()) {
                        drop(file);
                        let _ = fs::remove_file(&path);
                        return Err(error.to_string());
                    }
                    return Ok(Self { path });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    let stale = fs::metadata(&path).ok()
                        .and_then(|metadata| metadata.modified().ok())
                        .and_then(|changed| SystemTime::now().duration_since(changed).ok())
                        .is_some_and(|age| age > Duration::from_secs(30));
                    let crashed = fs::read_to_string(&path).ok()
                        .and_then(|raw| raw.trim().parse::<u32>().ok())
                        .is_some_and(|pid| owner_process_exited(pid));
                    if stale || crashed {
                        let _ = fs::remove_file(&path);
                        continue;
                    }
                    if Instant::now() >= deadline {
                        return Err("Chelys profile startup is locked; wait for the other instance to finish starting".into());
                    }
                    thread::sleep(Duration::from_millis(100));
                }
                Err(error) => return Err(error.to_string()),
            }
        }
    }
}

impl Drop for StartupClaim {
    fn drop(&mut self) { let _ = fs::remove_file(&self.path); }
}

// Replace an existing preference atomically on Windows as well as Unix.
pub fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
    #[cfg(windows)] {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "Kernel32")]
        extern "system" {
            fn MoveFileExW(source: *const u16, destination: *const u16, flags: u32) -> i32;
        }
        let from: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = destination.as_os_str().encode_wide().chain(Some(0)).collect();
        const MOVEFILE_REPLACE_EXISTING: u32 = 0x0000_0001;
        if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), MOVEFILE_REPLACE_EXISTING) } == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(())
    }
    #[cfg(not(windows))] {
        fs::rename(source, destination).map_err(|error| error.to_string())
    }
}

fn owner_process_exited(pid: u32) -> bool {
    #[cfg(unix)] {
        extern "C" { fn kill(pid: i32, signal: i32) -> i32; }
        if pid == 0 || pid > i32::MAX as u32 { return false; }
        let result = unsafe { kill(pid as i32, 0) };
        result != 0 && std::io::Error::last_os_error().raw_os_error() == Some(3) // ESRCH
    }
    #[cfg(not(unix))] { let _ = pid; false }
}
