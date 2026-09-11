//! Registry and read-only status primitives for managed WSL disks.

use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io,
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use serde::{Deserialize, Serialize};

/// The default maximum virtual capacity for a newly created disk.
pub const DEFAULT_CAPACITY_BYTES: u64 = 64 * 1024 * 1024 * 1024;

/// User input required to create a disk before resolving its default path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateRequest {
    pub mount_name: String,
    pub capacity_bytes: u64,
    pub path: Option<PathBuf>,
}

impl CreateRequest {
    pub fn new(mount_name: &str, size: Option<&str>, path: Option<PathBuf>) -> io::Result<Self> {
        if mount_name.is_empty()
            || matches!(mount_name, "." | "..")
            || mount_name.contains(['/', '\\'])
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid disk name",
            ));
        }
        Ok(Self {
            mount_name: mount_name.to_owned(),
            capacity_bytes: size
                .map(parse_size)
                .transpose()?
                .unwrap_or(DEFAULT_CAPACITY_BYTES),
            path,
        })
    }
}

/// The fully resolved, always dynamically allocated VHDX creation plan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreatePlan {
    pub path: PathBuf,
    pub capacity_bytes: u64,
    pub dynamic: bool,
}

pub fn plan_create(request: &CreateRequest, disks_dir: PathBuf) -> CreatePlan {
    CreatePlan {
        path: request
            .path
            .clone()
            .unwrap_or_else(|| disks_dir.join(format!("{}.vhdx", request.mount_name))),
        capacity_bytes: request.capacity_bytes,
        dynamic: true,
    }
}

/// Parses binary GB capacity syntax used by the CLI.
pub fn parse_size(value: &str) -> io::Result<u64> {
    let number = value.strip_suffix("GB").ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "size must use the GB suffix")
    })?;
    let gigabytes = number.parse::<u64>().map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "size must be a positive whole number",
        )
    })?;
    if gigabytes == 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "size must be positive",
        ));
    }
    gigabytes
        .checked_mul(1024 * 1024 * 1024)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "size is too large"))
}

/// Returns the one new whole-disk device introduced between two `lsblk --json` snapshots.
pub fn detect_new_disk(before: &str, after: &str) -> io::Result<PathBuf> {
    #[derive(Deserialize)]
    struct Lsblk {
        blockdevices: Vec<BlockDevice>,
    }
    #[derive(Deserialize)]
    struct BlockDevice {
        name: String,
        #[serde(rename = "type")]
        kind: String,
    }

    let parse = |value: &str| -> io::Result<Lsblk> {
        serde_json::from_str(value)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
    };
    let before_names = parse(before)?
        .blockdevices
        .into_iter()
        .filter(|device| device.kind == "disk")
        .map(|device| device.name)
        .collect::<HashSet<_>>();
    let added = parse(after)?
        .blockdevices
        .into_iter()
        .filter(|device| device.kind == "disk" && !before_names.contains(&device.name))
        .map(|device| device.name)
        .collect::<Vec<_>>();
    match added.as_slice() {
        [name] => Ok(PathBuf::from("/dev").join(name)),
        [] => Err(io::Error::new(
            io::ErrorKind::NotFound,
            "no new disk detected",
        )),
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "multiple new disks detected",
        )),
    }
}

pub trait Process {
    fn run(
        &mut self,
        program: std::ffi::OsString,
        args: Vec<std::ffi::OsString>,
    ) -> io::Result<String>;
}

pub fn create_disk(
    process: &mut dyn Process,
    distro: &str,
    mount_name: &str,
    plan: &CreatePlan,
) -> io::Result<Disk> {
    use std::ffi::OsString;
    let powershell = OsString::from("powershell.exe");
    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("scripts")
        .join("new-dynamic-vhd.ps1");
    process.run(
        powershell,
        vec![
            "-NoProfile",
            "-NonInteractive",
            "-File",
            script.to_string_lossy().as_ref(),
            plan.path.to_string_lossy().as_ref(),
            &plan.capacity_bytes.to_string(),
        ]
        .into_iter()
        .map(OsString::from)
        .collect(),
    )?;
    let wsl = OsString::from("wsl.exe");
    let list = |process: &mut dyn Process| {
        process.run(
            wsl.clone(),
            vec!["--distribution", distro, "--exec", "lsblk", "--json"]
                .into_iter()
                .map(OsString::from)
                .collect(),
        )
    };
    let before = list(process)?;
    process.run(
        wsl.clone(),
        vec![
            "--mount",
            plan.path.to_string_lossy().as_ref(),
            "--vhd",
            "--bare",
        ]
        .into_iter()
        .map(OsString::from)
        .collect(),
    )?;
    let after = list(process)?;
    let device = detect_new_disk(&before, &after)?;
    let format_result = process.run(
        wsl.clone(),
        vec![
            "--distribution",
            distro,
            "--exec",
            "mkfs.ext4",
            "-F",
            device.to_string_lossy().as_ref(),
        ]
        .into_iter()
        .map(OsString::from)
        .collect(),
    );
    let detach_result = process.run(
        wsl,
        vec!["--unmount", plan.path.to_string_lossy().as_ref()]
            .into_iter()
            .map(OsString::from)
            .collect(),
    );
    format_result?;
    detach_result?;
    Ok(Disk {
        path: plan.path.clone(),
        mount_name: mount_name.to_owned(),
        capacity_bytes: plan.capacity_bytes,
    })
}

/// Creates a disk and persists it only after the entire workflow succeeds.
pub fn create_and_register(
    process: &mut dyn Process,
    distro: &str,
    mount_name: &str,
    plan: &CreatePlan,
    registry_path: &Path,
) -> io::Result<Disk> {
    let disk = create_disk(process, distro, mount_name, plan)?;
    let mut registry = match read_registry(registry_path) {
        Ok(registry) => registry,
        Err(error) if error.kind() == io::ErrorKind::NotFound => Vec::new(),
        Err(error) => return Err(error),
    };
    registry.push(disk.clone());
    write_registry(registry_path, &registry)?;
    Ok(disk)
}

static TEMPORARY_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// A managed VHDX entry stored in the disk registry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Disk {
    pub path: PathBuf,
    pub mount_name: String,
    pub capacity_bytes: u64,
}

/// The registry record enriched with its current mount state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DiskStatus {
    pub path: PathBuf,
    pub mount_name: String,
    pub capacity_bytes: u64,
    pub mounted: bool,
}

/// Supplies live mount state without coupling registry code to a system command.
pub trait MountProbe {
    fn is_mounted(&self, disk: &Disk) -> io::Result<bool>;
}

/// Reads the ordered disk registry from JSON.
pub fn read_registry(path: &Path) -> io::Result<Vec<Disk>> {
    let contents = fs::read_to_string(path)?;
    let disks: Vec<Disk> = serde_json::from_str(&contents)
        .map_err(|source| io::Error::new(io::ErrorKind::InvalidData, source))?;
    validate_registry(&disks)?;
    Ok(disks)
}

/// Atomically writes the ordered disk registry as JSON.
pub fn write_registry(path: &Path, disks: &[Disk]) -> io::Result<()> {
    validate_registry(disks)?;
    let contents = serde_json::to_string_pretty(disks)
        .map_err(|source| io::Error::new(io::ErrorKind::InvalidData, source))?;
    let temporary_path = temporary_registry_path(path)?;
    let write_result = write_temporary_file(&temporary_path, contents.as_bytes())
        .and_then(|()| rename_atomically(&temporary_path, path));

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }

    write_result
}

fn validate_registry(disks: &[Disk]) -> io::Result<()> {
    for (index, disk) in disks.iter().enumerate() {
        if disks[..index]
            .iter()
            .any(|previous| previous.mount_name == disk.mount_name)
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("duplicate mount name {:?}", disk.mount_name),
            ));
        }
        if disks[..index]
            .iter()
            .any(|previous| previous.path == disk.path)
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("duplicate disk path {:?}", disk.path),
            ));
        }
    }

    Ok(())
}

fn temporary_registry_path(path: &Path) -> io::Result<PathBuf> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path.file_name().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "registry path must name a file",
        )
    })?;
    let sequence = TEMPORARY_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    Ok(parent.join(format!(
        ".{}.{}.{}.tmp",
        file_name.to_string_lossy(),
        std::process::id(),
        sequence
    )))
}

fn write_temporary_file(path: &Path, contents: &[u8]) -> io::Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(contents)?;
    file.sync_all()
}

#[cfg(windows)]
fn rename_atomically(from: &Path, to: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;

    unsafe extern "system" {
        fn MoveFileExW(
            existing_file_name: *const u16,
            new_file_name: *const u16,
            flags: u32,
        ) -> i32;
    }

    let from_wide = from
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let to_wide = to
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(
            from_wide.as_ptr(),
            to_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };

    if result == 0 {
        return Err(io::Error::last_os_error());
    }

    Ok(())
}

#[cfg(not(windows))]
fn rename_atomically(from: &Path, to: &Path) -> io::Result<()> {
    fs::rename(from, to)
}

/// Gets live status for every disk, or for one disk selected by mount name.
pub fn status(
    disks: &[Disk],
    mount_name: Option<&str>,
    probe: &dyn MountProbe,
) -> io::Result<Vec<DiskStatus>> {
    let selected: Vec<&Disk> = match mount_name {
        Some(mount_name) => vec![
            disks
                .iter()
                .find(|disk| disk.mount_name == mount_name)
                .ok_or_else(|| {
                    io::Error::new(
                        io::ErrorKind::NotFound,
                        format!("disk {mount_name:?} is not registered"),
                    )
                })?,
        ],
        None => disks.iter().collect(),
    };

    selected
        .into_iter()
        .map(|disk| {
            Ok(DiskStatus {
                path: disk.path.clone(),
                mount_name: disk.mount_name.clone(),
                capacity_bytes: disk.capacity_bytes,
                mounted: probe.is_mounted(disk)?,
            })
        })
        .collect()
}
