use dev::parse_wsl_list;

#[test]
fn parses_wsl2_distributions_from_verbose_wsl_output() {
    let output = "  NAME              STATE           VERSION\r\n* Ubuntu-24.04      Running         2\r\n  Debian            Stopped         1\r\n";

    let distros = parse_wsl_list(output).unwrap();

    assert_eq!(distros.len(), 2);
    assert_eq!(distros[0].name, "Ubuntu-24.04");
    assert_eq!(distros[0].version, 2);
    assert_eq!(distros[1].name, "Debian");
    assert_eq!(distros[1].version, 1);
}
