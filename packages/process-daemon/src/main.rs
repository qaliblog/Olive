fn main() {
    if let Err(error) = olive_pty::client::run_cli() {
        eprintln!("error: {error:#}");
        std::process::exit(1);
    }
}
