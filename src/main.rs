//! Static file server with an npm-compatible command line.

#![warn(missing_docs)]
#![forbid(unsafe_code)]

mod application;
mod cli;
mod listing;
mod server;

#[cfg(test)]
mod server_tests;

pub use application::main;
