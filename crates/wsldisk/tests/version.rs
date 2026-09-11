use assert_cmd::Command;

#[test]
fn prints_the_package_version() {
    let mut command = Command::cargo_bin("wsldisk").expect("wsldisk binary is built");

    command
        .arg("--version")
        .assert()
        .success()
        .stdout("wsldisk 0.1.0\n");
}
