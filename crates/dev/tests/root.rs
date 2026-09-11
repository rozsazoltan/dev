use std::path::PathBuf;

use assert_cmd::Command;

fn temporary_directory(name: &str) -> PathBuf {
    let directory = std::env::temp_dir().join(format!("dev-cli-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).unwrap();
    directory
}

#[test]
fn root_set_creates_the_standard_directory_layout() {
    let local_app_data = temporary_directory("root-set");
    let root = local_app_data.join("data");
    let mut command = Command::cargo_bin("dev").expect("dev binary is built");

    command
        .env("LOCALAPPDATA", &local_app_data)
        .args(["root", "set", root.to_str().unwrap()])
        .assert()
        .success();

    for directory in [
        root.join("disks"),
        root.join("wsl").join("distros"),
        root.join("wsl").join("backups"),
        root.join("tmp"),
    ] {
        assert!(directory.is_dir(), "{} must exist", directory.display());
    }

    std::fs::remove_dir_all(local_app_data).unwrap();
}
