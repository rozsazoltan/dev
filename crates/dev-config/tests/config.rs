use std::path::PathBuf;

use dev_config::{Config, validate_identifier};

fn temporary_directory(name: &str) -> PathBuf {
    let directory = std::env::temp_dir().join(format!("dev-config-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).unwrap();
    directory
}

#[test]
fn missing_config_uses_root_derived_standard_paths() {
    let local_app_data = temporary_directory("missing-config");
    let config_path = local_app_data.join("dev").join("config.toml");

    let config = Config::load_from_path(&config_path, &local_app_data).unwrap();

    let root = local_app_data.join("dev");
    assert_eq!(config.root(), root);
    assert_eq!(config.disks_dir(), root.join("disks"));
    assert_eq!(config.disk_registry_path(), root.join("disks.json"));
    assert_eq!(config.distros_dir(), root.join("wsl").join("distros"));
    assert_eq!(config.backups_dir(), root.join("wsl").join("backups"));
    assert_eq!(config.tmp_dir(), root.join("tmp"));

    std::fs::remove_dir_all(local_app_data).unwrap();
}

#[test]
fn missing_default_wsl_is_allowed_until_an_operation_requires_it() {
    let local_app_data = temporary_directory("missing-default-wsl");
    let config_path = local_app_data.join("dev").join("config.toml");

    let config = Config::load_from_path(&config_path, &local_app_data).unwrap();

    assert!(
        config
            .require_default_wsl()
            .unwrap_err()
            .to_string()
            .contains("default WSL distro")
    );

    std::fs::remove_dir_all(local_app_data).unwrap();
}

#[test]
fn configured_root_overrides_the_default_data_root() {
    let local_app_data = temporary_directory("custom-root");
    let config_path = local_app_data.join("config.toml");
    std::fs::write(&config_path, r#"root = 'D:\Dev'"#).unwrap();

    let config = Config::load_from_path(&config_path, &local_app_data).unwrap();

    assert_eq!(config.root(), PathBuf::from(r"D:\Dev"));
    assert_eq!(
        config.disk_registry_path(),
        PathBuf::from(r"D:\Dev\disks.json")
    );

    std::fs::remove_dir_all(local_app_data).unwrap();
}

#[test]
fn configured_default_wsl_is_available_to_required_operations() {
    let local_app_data = temporary_directory("configured-default-wsl");
    let config_path = local_app_data.join("config.toml");
    std::fs::write(&config_path, "[wsl]\ndefault = 'Dev'\n").unwrap();

    let config = Config::load_from_path(&config_path, &local_app_data).unwrap();

    assert_eq!(config.require_default_wsl().unwrap(), "Dev");

    std::fs::remove_dir_all(local_app_data).unwrap();
}

#[test]
fn identifier_validation_accepts_names_but_rejects_paths_and_traversal() {
    assert_eq!(validate_identifier("Dev-01").unwrap(), "Dev-01");

    for identifier in ["", ".", "..", "a/b", "a\\b", "../disk"] {
        assert!(
            validate_identifier(identifier).is_err(),
            "{identifier:?} must be rejected"
        );
    }
}

#[test]
fn saving_root_persists_an_absolute_path() {
    let local_app_data = temporary_directory("save-root");
    let config_path = local_app_data.join("dev").join("config.toml");
    let root = local_app_data.join("workspace");

    let mut config = Config::load_from_path(&config_path, &local_app_data).unwrap();
    config.set_root(root.clone()).unwrap();

    let reloaded = Config::load_from_path(&config_path, &local_app_data).unwrap();
    assert_eq!(reloaded.root(), root);

    std::fs::remove_dir_all(local_app_data).unwrap();
}

#[test]
fn saving_relative_root_is_rejected() {
    let local_app_data = temporary_directory("relative-root");
    let config_path = local_app_data.join("dev").join("config.toml");
    let mut config = Config::load_from_path(&config_path, &local_app_data).unwrap();

    assert!(config.set_root(PathBuf::from("relative")).is_err());

    std::fs::remove_dir_all(local_app_data).unwrap();
}
