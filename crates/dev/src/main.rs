fn main() {
    if let Err(error) = dev::run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
