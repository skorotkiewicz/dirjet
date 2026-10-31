use std::{net::IpAddr, path::PathBuf};

use clap::Parser;

/// Command-line options for the static server.
#[derive(Debug, Parser)]
#[command(
    version,
    about,
    after_help = "Examples:\n  djet dist/\n  djet example.html\n  djet -s dist/ -l 8080\n  djet --host 0.0.0.0 --port 3000"
)]
pub(crate) struct Cli {
    /// Directory or file to serve.
    #[arg(default_value = ".")]
    pub(crate) path: PathBuf,

    /// TCP port; use 0 to choose an available port.
    #[arg(
        short = 'p',
        long,
        visible_short_alias = 'l',
        visible_alias = "listen",
        default_value_t = 3000
    )]
    pub(crate) port: u16,

    /// IP address to bind to.
    #[arg(long, default_value = "127.0.0.1")]
    pub(crate) host: IpAddr,

    /// Serve the entry HTML file for missing extensionless routes.
    #[arg(short = 's', long)]
    pub(crate) single: bool,

    /// Return 404 for directories without index.html.
    #[arg(long)]
    pub(crate) no_listing: bool,
}
