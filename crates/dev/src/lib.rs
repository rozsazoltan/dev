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
        Commands::Root { command } => root(command, cli.json),
        Commands::Paths => paths(cli.json),
        Commands::Wsl { command } => wsl(command, cli.json),
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
    parse_wsl_list(&String::from_utf8(output.stdout)?)
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
