use assert_cmd::Command;

#[test]
fn help_exposes_registry_and_creation_commands() {
    let mut command = Command::cargo_bin("wsldisk").unwrap();

    command
        .arg("--help")
        .assert()
        .success()
        .stdout(predicates::str::contains("list"))
        .stdout(predicates::str::contains("status"))
        .stdout(predicates::str::contains("create"));
}
