use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use wsldisk::{Disk, DiskStatus, MountProbe, read_registry, status, write_registry};

const REGISTRY_FIXTURE: &str = r#"
[
  {
    "path": "D:\\dev\\disks\\projects.vhdx",
    "mount_name": "projects",
    "capacity_bytes": 68719476736
  },
  {
    "path": "D:\\dev\\disks\\archive.vhdx",
    "mount_name": "archive",
    "capacity_bytes": 137438953472
  }
]
"#;

struct FakeMountProbe {
    mounted_paths: HashSet<PathBuf>,
}

impl FakeMountProbe {
    fn with_mounted_paths(paths: impl IntoIterator<Item = PathBuf>) -> Self {
        Self {
            mounted_paths: paths.into_iter().collect(),
        }
    }
}

impl MountProbe for FakeMountProbe {
    fn is_mounted(&self, disk: &Disk) -> std::io::Result<bool> {
        Ok(self.mounted_paths.contains(&disk.path))
    }
}

fn temporary_directory(name: &str) -> PathBuf {
    let directory =
        std::env::temp_dir().join(format!("wsldisk-registry-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&directory);
    fs::create_dir_all(&directory).unwrap();
    directory
}

fn fixture_registry(path: &Path) {
    fs::write(path, REGISTRY_FIXTURE).unwrap();
}

#[test]
fn reads_and_writes_disk_registry_without_changing_record_order() {
    let directory = temporary_directory("round-trip");
    let source = directory.join("source.json");
    let destination = directory.join("destination.json");
    fixture_registry(&source);

    let disks = read_registry(&source).unwrap();

    assert_eq!(
        disks,
        vec![
            Disk {
                path: PathBuf::from(r"D:\dev\disks\projects.vhdx"),
                mount_name: "projects".to_owned(),
                capacity_bytes: 68_719_476_736,
            },
            Disk {
                path: PathBuf::from(r"D:\dev\disks\archive.vhdx"),
                mount_name: "archive".to_owned(),
                capacity_bytes: 137_438_953_472,
            },
        ]
    );

    write_registry(&destination, &disks).unwrap();

    assert_eq!(read_registry(&destination).unwrap(), disks);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn registry_rejects_duplicate_mount_names_and_paths() {
    let directory = temporary_directory("duplicates");
    let registry = directory.join("disks.json");
    fixture_registry(&registry);
    let mut disks = read_registry(&registry).unwrap();

    disks[1].mount_name = disks[0].mount_name.clone();
    let error = write_registry(&registry, &disks).unwrap_err();
    assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
    assert!(error.to_string().contains("mount name"));

    fixture_registry(&registry);
    let mut disks = read_registry(&registry).unwrap();
    disks[1].path = disks[0].path.clone();
    let error = write_registry(&registry, &disks).unwrap_err();
    assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
    assert!(error.to_string().contains("path"));

    fs::write(
        &registry,
        REGISTRY_FIXTURE.replace("archive\",", "projects\","),
    )
    .unwrap();
    let error = read_registry(&registry).unwrap_err();
    assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
    assert!(error.to_string().contains("mount name"));
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn write_registry_replaces_an_existing_file_without_leaving_a_temporary_file() {
    let directory = temporary_directory("atomic-write");
    let registry = directory.join("disks.json");
    fixture_registry(&registry);
    let disks = vec![Disk {
        path: PathBuf::from(r"D:\dev\disks\new.vhdx"),
        mount_name: "new".to_owned(),
        capacity_bytes: 68_719_476_736,
    }];

    write_registry(&registry, &disks).unwrap();

    assert_eq!(read_registry(&registry).unwrap(), disks);
    assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn status_all_queries_live_mount_state_for_each_registered_disk() {
    let directory = temporary_directory("status-all");
    let registry = directory.join("disks.json");
    fixture_registry(&registry);
    let disks = read_registry(&registry).unwrap();
    let probe = FakeMountProbe::with_mounted_paths([disks[1].path.clone()]);

    let statuses = status(&disks, None, &probe).unwrap();

    assert_eq!(
        statuses,
        vec![
            DiskStatus {
                path: disks[0].path.clone(),
                mount_name: "projects".to_owned(),
                capacity_bytes: 68_719_476_736,
                mounted: false,
            },
            DiskStatus {
                path: disks[1].path.clone(),
                mount_name: "archive".to_owned(),
                capacity_bytes: 137_438_953_472,
                mounted: true,
            },
        ]
    );

    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn status_for_unknown_disk_returns_a_descriptive_error() {
    let directory = temporary_directory("unknown");
    let registry = directory.join("disks.json");
    fixture_registry(&registry);
    let disks = read_registry(&registry).unwrap();
    let probe = FakeMountProbe::with_mounted_paths([]);

    let error = status(&disks, Some("missing"), &probe).unwrap_err();

    assert!(error.to_string().contains("missing"));
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn disk_status_serializes_to_a_stable_json_model() {
    let status = DiskStatus {
        path: PathBuf::from(r"D:\dev\disks\projects.vhdx"),
        mount_name: "projects".to_owned(),
        capacity_bytes: 68_719_476_736,
        mounted: true,
    };

    assert_eq!(
        serde_json::to_value(status).unwrap(),
        serde_json::json!({
            "path": r"D:\dev\disks\projects.vhdx",
            "mount_name": "projects",
            "capacity_bytes": 68_719_476_736_u64,
            "mounted": true,
        })
    );
}
