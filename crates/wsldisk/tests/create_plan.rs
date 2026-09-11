use std::path::PathBuf;

use wsldisk::{CreateRequest, detect_new_disk, parse_size, plan_create};

#[test]
fn omitted_size_uses_a_64_gib_virtual_capacity() {
    let request = CreateRequest::new("projects", None, None).unwrap();

    assert_eq!(request.capacity_bytes, 68_719_476_736);
}

#[test]
fn explicit_size_overrides_the_64_gib_default() {
    let request = CreateRequest::new("projects", Some("128GB"), None).unwrap();

    assert_eq!(request.capacity_bytes, 137_438_953_472);
}

#[test]
fn size_parser_rejects_invalid_values() {
    assert!(parse_size("64").is_err());
    assert!(parse_size("0GB").is_err());
    assert!(parse_size("lots").is_err());
}

#[test]
fn dynamic_create_plan_uses_root_disks_path_and_never_fixed_allocation() {
    let request = CreateRequest::new("projects", None, None).unwrap();
    let plan = plan_create(&request, PathBuf::from(r"D:\Dev\disks"));

    assert_eq!(plan.path, PathBuf::from(r"D:\Dev\disks\projects.vhdx"));
    assert_eq!(plan.capacity_bytes, 68_719_476_736);
    assert!(plan.dynamic);
}

#[test]
fn explicit_path_overrides_the_default_disk_path() {
    let request = CreateRequest::new(
        "projects",
        Some("2GB"),
        Some(PathBuf::from(r"E:\Storage\projects.vhdx")),
    )
    .unwrap();
    let plan = plan_create(&request, PathBuf::from(r"D:\Dev\disks"));

    assert_eq!(plan.path, PathBuf::from(r"E:\Storage\projects.vhdx"));
    assert_eq!(plan.capacity_bytes, 2_147_483_648);
    assert!(plan.dynamic);
}

#[test]
fn detects_the_new_disk_from_lsblk_state_instead_of_assuming_sdb() {
    let before = r#"{"blockdevices":[{"name":"sda","type":"disk"},{"name":"sdc","type":"disk"}]}"#;
    let after = r#"{"blockdevices":[{"name":"sda","type":"disk"},{"name":"sdc","type":"disk"},{"name":"sdd","type":"disk"}]}"#;

    assert_eq!(detect_new_disk(before, after).unwrap(), "/dev/sdd");
}

#[test]
fn rejects_ambiguous_or_missing_new_disks() {
    let before = r#"{"blockdevices":[{"name":"sda","type":"disk"}]}"#;
    let ambiguous = r#"{"blockdevices":[{"name":"sda","type":"disk"},{"name":"sdc","type":"disk"},{"name":"sdd","type":"disk"}]}"#;

    assert!(detect_new_disk(before, before).is_err());
    assert!(detect_new_disk(before, ambiguous).is_err());
}
