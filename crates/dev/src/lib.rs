use std::{error::Error, fs, path::PathBuf, process::Command};

use clap::{Parser, Subcommand};
use dev_config::Config;
use serde::Serialize;

type Result<T> = std::result::Result<T, Box<dyn Error>>;

#[derive(Parser)]
#[command(version)]
struct Cli {
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Doctor,
    Root {
        #[command(subcommand)]
        command: RootCommands,
    },
    Paths,
    Wsl {
        #[command(subcommand)]
        command: WslCommands,
    },
}

#[derive(Subcommand)]
enum RootCommands {
    Get,
    Set { path: PathBuf },
}

#[derive(Subcommand)]
enum WslCommands {
    List,
    Default {
        #[command(subcommand)]
        command: DefaultWslCommands,
    },
}

#[derive(Subcommand)]
enum DefaultWslCommands {
    Get,
    Set { name: String },
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct WslDistro {
    pub name: String,
    pub version: u8,
}

#[derive(Serialize)]
struct Paths<'a> {
    root: &'a std::path::Path,
    disks: PathBuf,
    distros: PathBuf,
    backups: PathBuf,
    tmp: PathBuf,
}

pub fn run() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Doctor => doctor(cli.json),
        Commands::Root { command } => root(command, cli.json),
        Commands::Paths => paths(cli.json),
        Commands::Wsl { command } => wsl(command, cli.json),
    }
}

struct SystemDoctorProbe;

impl DoctorProbe for SystemDoctorProbe {
    fn wsl_executable_available(&self) -> bool {
        Command::new("wsl.exe").arg("--help").output().is_ok()
    }

    fn wsl_is_working(&mut self) -> bool {
        Command::new("wsl.exe")
            .arg("--status")
            .output()
            .is_ok_and(|output| output.status.success())
    }

    fn installed_wsl_distros(&mut self) -> std::result::Result<Vec<WslDistro>, Box<dyn Error>> {
        installed_wsl_distros()
    }

    fn distro_command_is_available(&mut self, distro: &str, command: &str) -> bool {
        Command::new("wsl.exe")
            .args(["--distribution", distro, "--exec", command, "--help"])
            .output()
            .is_ok_and(|output| output.status.success())
    }
}

fn doctor(json: bool) -> Result<()> {
    let mut probe = SystemDoctorProbe;
    let report = match Config::load() {
        Ok(config) => doctor_report(&config, &mut probe),
        Err(_) => doctor_report_without_config(&mut probe),
    };

    if json {
        println!("{}", serde_json::to_string(&report)?);
    } else {
        for check in report.checks() {
            let result = if check.is_ok() {
                check.detail().unwrap_or("ok")
            } else {
                "missing"
            };
            println!("{:<20} {result}", check.label());
        }
    }

    if report.is_ready() {
        Ok(())
    } else {
        Err("doctor found missing prerequisites".into())
    }
}

fn root(command: RootCommands, json: bool) -> Result<()> {
    let mut config = Config::load()?;
    match command {
        RootCommands::Get => print_value(config.root(), json),
        RootCommands::Set { path } => {
            config.set_root(path)?;
            for directory in [
                config.disks_dir(),
                config.distros_dir(),
                config.backups_dir(),
                config.tmp_dir(),
            ] {
                fs::create_dir_all(directory)?;
            }
            print_value(config.root(), json)
        }
    }
}

fn paths(json: bool) -> Result<()> {
    let config = Config::load()?;
    let paths = Paths {
        root: config.root(),
        disks: config.disks_dir(),
        distros: config.distros_dir(),
        backups: config.backups_dir(),
        tmp: config.tmp_dir(),
    };
    if json {
        println!("{}", serde_json::to_string(&paths)?);
    } else {
        println!("root: {}", paths.root.display());
        println!("disks: {}", paths.disks.display());
        println!("distros: {}", paths.distros.display());
        println!("backups: {}", paths.backups.display());
        println!("tmp: {}", paths.tmp.display());
    }
    Ok(())
}

fn wsl(command: WslCommands, json: bool) -> Result<()> {
    match command {
        WslCommands::List => print_wsl_list(&installed_wsl_distros()?, json),
        WslCommands::Default { command } => {
            let mut config = Config::load()?;
            match command {
                DefaultWslCommands::Get => match config.default_wsl() {
                    Some(name) => print_string(name, json),
                    None => Err("a default WSL distro must be configured".into()),
                },
                DefaultWslCommands::Set { name } => {
                    let distros = installed_wsl_distros()?;
                    if !distros
                        .iter()
                        .any(|distro| distro.name == name && distro.version == 2)
                    {
                        return Err(format!("{name:?} is not an installed WSL2 distro").into());
                    }
                    config.set_default_wsl(name)?;
                    print_string(config.require_default_wsl()?, json)
                }
            }
        }
    }
}

fn print_value(value: &std::path::Path, json: bool) -> Result<()> {
    print_string(&value.display().to_string(), json)
}

fn print_string(value: &str, json: bool) -> Result<()> {
    if json {
        println!("{}", serde_json::to_string(value)?);
    } else {
        println!("{value}");
    }
    Ok(())
}

fn print_wsl_list(distros: &[WslDistro], json: bool) -> Result<()> {
    if json {
        println!("{}", serde_json::to_string(distros)?);
    } else {
        for distro in distros {
            println!("{} (WSL{})", distro.name, distro.version);
        }
    }
    Ok(())
}

fn installed_wsl_distros() -> Result<Vec<WslDistro>> {
    let output = Command::new("wsl.exe")
        .args(["--list", "--verbose"])
        .output()?;
    if !output.status.success() {
        return Err(format!("wsl.exe exited with {}", output.status).into());
    }
    parse_wsl_list(&decode_wsl_output(&output.stdout)?)
}

fn decode_wsl_output(output: &[u8]) -> Result<String> {
    if is_utf16le(output) {
        let output = output.strip_prefix(&[0xff, 0xfe]).unwrap_or(output);
        let code_units = output
            .chunks_exact(2)
            .map(|bytes| u16::from_le_bytes([bytes[0], bytes[1]]))
            .collect::<Vec<_>>();
        return Ok(String::from_utf16(&code_units)?);
    }

    Ok(String::from_utf8(output.to_vec())?)
}

fn is_utf16le(output: &[u8]) -> bool {
    output.starts_with(&[0xff, 0xfe])
        || output.len() >= 2
            && output.chunks_exact(2).filter(|bytes| bytes[1] == 0).count() * 2 >= output.len()
}

pub fn parse_wsl_list(output: &str) -> Result<Vec<WslDistro>> {
    output
        .lines()
        .filter(|line| {
            !line.trim().is_empty() && !line.contains("NAME") && !line.contains("VERSION")
        })
        .map(|line| {
            let fields = line
                .trim()
                .trim_start_matches('*')
                .split_whitespace()
                .collect::<Vec<_>>();
            if fields.len() < 3 {
                return Err(format!("invalid wsl.exe output line: {line:?}").into());
            }
            let version = fields.last().unwrap().parse()?;
            Ok(WslDistro {
                name: fields[..fields.len() - 2].join(" "),
                version,
            })
        })
        .collect()
}

pub trait DoctorProbe {
    fn wsl_executable_available(&self) -> bool;
    fn wsl_is_working(&mut self) -> bool;
    fn installed_wsl_distros(&mut self) -> std::result::Result<Vec<WslDistro>, Box<dyn Error>>;
    fn distro_command_is_available(&mut self, distro: &str, command: &str) -> bool;
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DoctorStatus {
    Ok,
    Missing,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct DoctorCheck {
    id: &'static str,
    label: &'static str,
    status: DoctorStatus,
    detail: Option<String>,
}

impl DoctorCheck {
    pub fn id(&self) -> &str {
        self.id
    }

    pub fn is_ok(&self) -> bool {
        self.status == DoctorStatus::Ok
    }

    pub fn label(&self) -> &str {
        self.label
    }

    pub fn detail(&self) -> Option<&str> {
        self.detail.as_deref()
    }
}

#[derive(Serialize)]
pub struct DoctorReport {
    checks: Vec<DoctorCheck>,
}

impl DoctorReport {
    pub fn checks(&self) -> &[DoctorCheck] {
        &self.checks
    }

    pub fn is_ready(&self) -> bool {
        self.checks.iter().all(DoctorCheck::is_ok)
    }
}

pub fn doctor_report(config: &Config, probe: &mut impl DoctorProbe) -> DoctorReport {
    doctor_report_from_settings(Some(config.root()), config.default_wsl(), probe)
}

pub fn doctor_report_without_config(probe: &mut impl DoctorProbe) -> DoctorReport {
    doctor_report_from_settings(None, None, probe)
}

fn doctor_report_from_settings(
    root: Option<&std::path::Path>,
    default_distro: Option<&str>,
    probe: &mut impl DoctorProbe,
) -> DoctorReport {
    let wsl_executable = probe.wsl_executable_available();
    let wsl_working = wsl_executable && probe.wsl_is_working();
    let root_ready = root.is_some_and(root_is_ready);
    let configured_distro = default_distro.map(str::to_owned);
    let distros = if wsl_working {
        probe.installed_wsl_distros().ok()
    } else {
        None
    };
    let distro = configured_distro.as_deref().and_then(|name| {
        distros
            .as_ref()
            .and_then(|distros| distros.iter().find(|distro| distro.name == name))
    });
    let distro_is_wsl2 = distro.is_some_and(|distro| distro.version == 2);

    let mut checks = vec![
        check("wsl-executable", "WSL executable", wsl_executable, None),
        check("wsl-working", "WSL", wsl_working, None),
        check(
            "root",
            "Root",
            root_ready,
            root.map(|path| path.display().to_string()),
        ),
        check(
            "default-distro",
            "Default distro",
            configured_distro.is_some(),
            configured_distro.clone(),
        ),
        check(
            "distro",
            "Configured distro",
            distro.is_some(),
            configured_distro.clone(),
        ),
        check(
            "wsl-version",
            "WSL version",
            distro_is_wsl2,
            distro.map(|distro| distro.version.to_string()),
        ),
    ];

    for (id, label, command) in [
        ("lsblk", "lsblk", "lsblk"),
        ("mkfs-ext4", "mkfs.ext4", "mkfs.ext4"),
        ("resize2fs", "resize2fs", "resize2fs"),
    ] {
        let available = if distro_is_wsl2 {
            probe
                .distro_command_is_available(&distro.expect("WSL2 distro is present").name, command)
        } else {
            false
        };
        checks.push(check(id, label, available, None));
    }

    DoctorReport { checks }
}

fn check(
    id: &'static str,
    label: &'static str,
    is_ok: bool,
    detail: Option<String>,
) -> DoctorCheck {
    DoctorCheck {
        id,
        label,
        status: if is_ok {
            DoctorStatus::Ok
        } else {
            DoctorStatus::Missing
        },
        detail,
    }
}

fn root_is_ready(root: &std::path::Path) -> bool {
    root.is_dir()
        && fs::metadata(root)
            .map(|metadata| !metadata.permissions().readonly())
            .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use dev_config::Config;

    use super::{DoctorProbe, WslDistro, doctor_report};

    struct ReadyProbe;

    impl DoctorProbe for ReadyProbe {
        fn wsl_executable_available(&self) -> bool {
            true
        }

        fn wsl_is_working(&mut self) -> bool {
            true
        }

        fn installed_wsl_distros(&mut self) -> super::Result<Vec<WslDistro>> {
            Ok(vec![WslDistro {
                name: "Dev".to_owned(),
                version: 2,
            }])
        }

        fn distro_command_is_available(&mut self, _distro: &str, _command: &str) -> bool {
            true
        }
    }

    struct UnavailableWslProbe;

    impl DoctorProbe for UnavailableWslProbe {
        fn wsl_executable_available(&self) -> bool {
            false
        }

        fn wsl_is_working(&mut self) -> bool {
            panic!("WSL must not be invoked when wsl.exe is unavailable")
        }

        fn installed_wsl_distros(&mut self) -> super::Result<Vec<WslDistro>> {
            panic!("WSL must not be invoked when wsl.exe is unavailable")
        }

        fn distro_command_is_available(&mut self, _distro: &str, _command: &str) -> bool {
            panic!("distro tools must not be invoked when WSL is unavailable")
        }
    }

    fn temporary_directory(name: &str) -> PathBuf {
        let directory =
            std::env::temp_dir().join(format!("dev-doctor-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        directory
    }

    #[test]
    fn reports_all_required_checks_for_a_ready_setup() {
        let local_app_data = temporary_directory("ready");
        let root = local_app_data.join("root");
        std::fs::create_dir(&root).unwrap();
        let config_path = local_app_data.join("config.toml");
        std::fs::write(
            &config_path,
            format!("root = {:?}\n[wsl]\ndefault = 'Dev'\n", root),
        )
        .unwrap();
        let config = Config::load_from_path(&config_path, &local_app_data).unwrap();

        let report = doctor_report(&config, &mut ReadyProbe);

        assert!(report.is_ready());
        assert_eq!(
            report
                .checks()
                .iter()
                .map(|check| check.id())
                .collect::<Vec<_>>(),
            vec![
                "wsl-executable",
                "wsl-working",
                "root",
                "default-distro",
                "distro",
                "wsl-version",
                "lsblk",
                "mkfs-ext4",
                "resize2fs",
            ]
        );
        assert!(report.checks().iter().all(|check| check.is_ok()));

        std::fs::remove_dir_all(local_app_data).unwrap();
    }

    #[test]
    fn reports_missing_prerequisites_without_running_wsl() {
        let local_app_data = temporary_directory("missing");
        let config_path = local_app_data.join("config.toml");
        let config = Config::load_from_path(&config_path, &local_app_data).unwrap();

        let report = doctor_report(&config, &mut UnavailableWslProbe);

        assert!(!report.is_ready());
        assert_eq!(report.checks()[0].id(), "wsl-executable");
        assert!(!report.checks()[0].is_ok());
        assert_eq!(report.checks()[1].id(), "wsl-working");
        assert!(!report.checks()[1].is_ok());
        assert_eq!(report.checks()[2].id(), "root");
        assert!(!report.checks()[2].is_ok());
        assert_eq!(report.checks()[3].id(), "default-distro");
        assert!(!report.checks()[3].is_ok());

        std::fs::remove_dir_all(local_app_data).unwrap();
    }

    #[test]
    fn decodes_utf16le_wsl_list_output_before_parsing_versions() {
        let output = "  NAME              STATE           VERSION\r\n* Ubuntu 24.04      Running         2\r\n  Debian            Stopped         1\r\n";
        let bytes = output
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>();

        let decoded = super::decode_wsl_output(&bytes).unwrap();
        let distros = super::parse_wsl_list(&decoded).unwrap();

        assert_eq!(distros.len(), 2);
        assert_eq!(distros[0].name, "Ubuntu 24.04");
        assert_eq!(distros[0].version, 2);
        assert_eq!(distros[1].name, "Debian");
        assert_eq!(distros[1].version, 1);
    }

    #[test]
    fn preserves_utf8_wsl_list_output() {
        let output =
            "  NAME              STATE           VERSION\n* Ubuntu            Running         2\n";

        assert_eq!(super::decode_wsl_output(output.as_bytes()).unwrap(), output);
    }
}
