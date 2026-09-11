use std::path::PathBuf;

use assert_cmd::Command;

fn temporary_directory(name: &str) -> PathBuf {
    let directory = std::env::temp_dir().join(format!("dev-cli-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).unwrap();
    directory
}

#[test]
fn doctor_returns_structured_missing_results_for_an_incomplete_setup() {
    let local_app_data = temporary_directory("doctor");
    let mut command = Command::cargo_bin("dev").expect("dev binary is built");

    let output = command
        .env("LOCALAPPDATA", &local_app_data)
        .args(["--json", "doctor"])
        .output()
        .unwrap();

    assert!(!output.status.success());
    let report: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let checks = report["checks"].as_array().unwrap();
    assert!(
        checks
            .iter()
            .any(|check| { check["id"] == "root" && check["status"] == "missing" })
    );

    std::fs::remove_dir_all(local_app_data).unwrap();
}
