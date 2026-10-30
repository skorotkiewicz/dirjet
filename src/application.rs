use anyhow::{Context, Result};
use clap::Parser;
use tokio::net::TcpListener;

use crate::{cli::Cli, server::Server};

/// Starts the command-line server and drains active connections on Ctrl+C.
#[tokio::main]
pub async fn main() -> Result<()> {
    let cli = Cli::parse();
    let server = Server::new(&cli).await?;
    let listener = TcpListener::bind((cli.host, cli.port))
        .await
        .with_context(|| format!("could not listen on {}:{}", cli.host, cli.port))?;
    let address = listener.local_addr()?;
    println!("Serving {}", cli.path.display());
    println!("http://{address}");
    println!("Press Ctrl+C to stop.");

    axum::serve(listener, server.router())
        .with_graceful_shutdown(shutdown())
        .await
        .context("HTTP server failed")
}

async fn shutdown() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        match signal(SignalKind::terminate()) {
            Ok(mut terminate) => {
                tokio::select! {
                    result = tokio::signal::ctrl_c() => {
                        if let Err(error) = result {
                            eprintln!("could not listen for Ctrl+C: {error}");
                        }
                    }
                    _ = terminate.recv() => {}
                }
            }
            Err(error) => {
                eprintln!("could not listen for SIGTERM: {error}");
                let _ = tokio::signal::ctrl_c().await;
            }
        }
    }
    #[cfg(not(unix))]
    if let Err(error) = tokio::signal::ctrl_c().await {
        eprintln!("could not listen for Ctrl+C: {error}");
    }
}
