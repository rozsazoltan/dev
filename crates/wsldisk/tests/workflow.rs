use std::{collections::VecDeque, ffi::OsString, io, path::PathBuf};

use wsldisk::{CreatePlan, Process, create_and_register, read_registry};

struct FakeProcess {
    responses: VecDeque<io::Result<String>>,
    calls: Vec<(OsString, Vec<OsString>)>,
}

impl Process for FakeProcess {
    fn run(&mut self, program: OsString, args: Vec<OsString>) -> io::Result<String> {
        self.calls.push((program, args));
        self.responses.pop_front().expect("unexpected process call")
    }
}

#[test]
fn create_formats_detected_disk_detaches_then_returns_registry_record() {
    let plan = CreatePlan {
        path: PathBuf::from(r"D:\Dev\disks\projects.vhdx"),
        capacity_bytes: 68_719_476_736,
        dynamic: true,
    };
    let mut process = FakeProcess {
        responses: VecDeque::from([
            Ok(String::new()),
            Ok(r#"{"blockdevices":[{"name":"sda","type":"disk"}]}"#.into()),
            Ok(String::new()),
            Ok(
                r#"{"blockdevices":[{"name":"sda","type":"disk"},{"name":"sdd","type":"disk"}]}"#
                    .into(),
            ),
            Ok(String::new()),
            Ok(String::new()),
        ]),
        calls: vec![],
    };

    let registry =
        std::env::temp_dir().join(format!("wsldisk-workflow-{}.json", std::process::id()));
    let disk = create_and_register(&mut process, "Dev", "projects", &plan, &registry).unwrap();

    assert_eq!(disk.mount_name, "projects");
    assert_eq!(process.calls.len(), 6);
    assert!(process.calls[4].1.iter().any(|arg| arg == "mkfs.ext4"));
    assert!(process.calls[5].1.iter().any(|arg| arg == "--unmount"));
    assert_eq!(read_registry(&registry).unwrap(), vec![disk]);
    std::fs::remove_file(registry).unwrap();
}

#[test]
fn formatting_failure_still_detaches_and_never_returns_a_disk() {
    let plan = CreatePlan {
        path: PathBuf::from(r"D:\Dev\disks\projects.vhdx"),
        capacity_bytes: 68_719_476_736,
        dynamic: true,
    };
    let mut process = FakeProcess {
        responses: VecDeque::from([
            Ok(String::new()),
            Ok(r#"{"blockdevices":[]}"#.into()),
            Ok(String::new()),
            Ok(r#"{"blockdevices":[{"name":"sdd","type":"disk"}]}"#.into()),
            Err(io::Error::other("mkfs failed")),
            Ok(String::new()),
        ]),
        calls: vec![],
    };

    let registry =
        std::env::temp_dir().join(format!("wsldisk-failure-{}.json", std::process::id()));
    assert!(create_and_register(&mut process, "Dev", "projects", &plan, &registry).is_err());
    assert!(process.calls[5].1.iter().any(|arg| arg == "--unmount"));
    assert!(!registry.exists());
}
