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
        Commands::List => print_value(&read_registry(&config.disk_registry_path())?, cli.json),
        Commands::Status { name, all } => {
            let probe = SystemMountProbe;
            let disks = read_registry(&config.disk_registry_path())?;
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
                let mut process = SystemProcess;
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

struct SystemProcess;
impl Process for SystemProcess {
    fn run(&mut self, program: OsString, args: Vec<OsString>) -> io::Result<String> {
        let output = Command::new(program).args(args).output()?;
        if !output.status.success() {
            return Err(io::Error::other(format!(
                "external command exited with {}",
                output.status
            )));
        }
        String::from_utf8(output.stdout)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
    }
}

struct SystemMountProbe;
impl MountProbe for SystemMountProbe {
    fn is_mounted(&self, disk: &Disk) -> io::Result<bool> {
        let script = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("scripts")
            .join("get-vhd-status.ps1");
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
