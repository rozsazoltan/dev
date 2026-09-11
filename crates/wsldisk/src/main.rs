use clap::{Parser, Subcommand};

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
    let _ = Cli::parse();
}
