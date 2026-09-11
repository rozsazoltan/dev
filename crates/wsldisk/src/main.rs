use std::{error::Error, ffi::OsString, io, process::Command};

use clap::{Parser, Subcommand};
use dev_config::Config;
use wsldisk::{
    CreateRequest, Disk, MountProbe, Process, create_and_register, plan_create, read_registry,
    status,
};

#[derive(Parser)]
#[command(version)]
struct Cli {
    #[arg(long, global = true)]
    json: bool,
    #[arg(long, global = true)]
    dry_run: bool,
    #[arg(long, global = true)]
    debug: bool,
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    List,
    Status {
        name: Option<String>,
        #[arg(long, conflicts_with = "name")]
        all: bool,
    },
    Create {
        name: String,
        #[arg(long)]
        size: Option<String>,
        #[arg(long)]
        path: Option<std::path::PathBuf>,
    },
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let cli = Cli::parse();
    let config = Config::load()?;
    let distro = config.require_default_wsl()?;
    match cli.command {
        Commands::List => print_value(
            &read_registry_or_empty(&config.disk_registry_path())?,
            cli.json,
        ),
        Commands::Status { name, all } => {
            let probe = SystemMountProbe { debug: cli.debug };
            let disks = read_registry_or_empty(&config.disk_registry_path())?;
            print_value(
                &status(&disks, if all { None } else { name.as_deref() }, &probe)?,
                cli.json,
            );
        }
        Commands::Create { name, size, path } => {
            let request = CreateRequest::new(&name, size.as_deref(), path)?;
            let plan = plan_create(&request, config.disks_dir());
            if cli.dry_run {
                print_value(
                    &DryRun {
                        path: &plan.path,
                        capacity_bytes: plan.capacity_bytes,
                        dynamic: plan.dynamic,
                    },
                    cli.json,
                );
            } else {
                let mut process = SystemProcess { debug: cli.debug };
                let disk = create_and_register(
                    &mut process,
                    distro,
                    &name,
                    &plan,
                    &config.disk_registry_path(),
                )?;
                print_value(&disk, cli.json);
            }
        }
    }
    Ok(())
}

fn read_registry_or_empty(path: &std::path::Path) -> io::Result<Vec<Disk>> {
    match read_registry(path) {
        Ok(disks) => Ok(disks),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error),
    }
}

#[derive(serde::Serialize)]
struct DryRun<'a> {
    path: &'a std::path::Path,
    capacity_bytes: u64,
    dynamic: bool,
}

fn print_value(value: &impl serde::Serialize, json: bool) {
    if json {
        println!(
            "{}",
            serde_json::to_string(value).expect("serializable output")
        );
    } else {
        println!(
            "{}",
            serde_json::to_string_pretty(value).expect("serializable output")
        );
    }
}

struct SystemProcess {
    debug: bool,
}
impl Process for SystemProcess {
    fn run(&mut self, program: OsString, args: Vec<OsString>) -> io::Result<String> {
        confirm_debug(self.debug, &program, &args)?;
        let output = Command::new(program).args(args).output()?;
        if !output.status.success() {
            return Err(io::Error::other(format!(
                "external command exited with {}: {}",
                output.status,
                decode_windows_output(&output.stderr).trim()
            )));
        }
        Ok(decode_windows_output(&output.stdout))
    }
}

fn decode_windows_output(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.chunks_exact(2).all(|pair| pair[1] == 0) {
        let bytes = bytes.strip_prefix(&[0xff, 0xfe]).unwrap_or(bytes);
        let units = bytes
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect::<Vec<_>>();
        return String::from_utf16_lossy(&units);
    }
    String::from_utf8_lossy(bytes).into_owned()
}

struct SystemMountProbe {
    debug: bool,
}
impl MountProbe for SystemMountProbe {
    fn is_mounted(&self, disk: &Disk) -> io::Result<bool> {
        let script = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("scripts")
            .join("get-vhd-status.ps1");
        let args = vec![
            OsString::from("-NoProfile"),
            OsString::from("-NonInteractive"),
            OsString::from("-File"),
            script.clone().into_os_string(),
            disk.path.clone().into_os_string(),
        ];
        confirm_debug(self.debug, &OsString::from("powershell.exe"), &args)?;
        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-File"])
            .arg(script)
            .arg(&disk.path)
            .output()?;
        if !output.status.success() {
            return Err(io::Error::other("disk status probe failed"));
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim() == "true")
    }
}

fn confirm_debug(debug: bool, program: &OsString, args: &[OsString]) -> io::Result<()> {
    if !debug {
        return Ok(());
    }
    eprintln!("debug: {:?} {:?}", program, args);
    eprint!("Run this command? [y/N] ");
    let mut answer = String::new();
    io::stdin().read_line(&mut answer)?;
    if answer.trim().eq_ignore_ascii_case("y") {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::Interrupted,
            "command not confirmed",
        ))
    }
}
