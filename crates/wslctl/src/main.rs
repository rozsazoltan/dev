use clap::Parser;

#[derive(Parser)]
#[command(version)]
struct Cli;

fn main() {
    Cli::parse();
}
