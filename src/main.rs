use salvo::conn::TcpListener;
use salvo::{Listener, Router};
use shuriken::app::api::routes;
use shuriken::component::auth::casbin::init_casbin;
use shuriken::component::config::{get_config, load_config};
use shuriken::component::db::connection;
use tracing_subscriber::{fmt, EnvFilter};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing with environment variable support
    // RUST_LOG can be used to control log levels, e.g.:
    // RUST_LOG=debug for debug logs
    // RUST_LOG=shuriken=debug for debug logs in shuriken only
    // RUST_LOG=shuriken::component::db=trace for trace logs in db component
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));
    
    fmt()
        .with_env_filter(env_filter)
        .with_target(true)
        .with_thread_ids(true)
        .with_file(true)
        .with_line_number(true)
        .init();

    tracing::info!("Starting Shuriken CalDAV/CardDAV server");

    load_config()?;

    tracing::info!(config = ?get_config(), "Configuration loaded");

    connection::create_pool(&get_config().database.url, 4).await?;

    init_casbin().await?;

    tracing::info!("Database connection pool created.");

    let acceptor = TcpListener::new("0.0.0.0:8698").bind().await;

    let router = Router::new().push(routes());

    tracing::info!("Server listening on 0.0.0.0:8698");

    salvo::Server::new(acceptor).serve(router).await;

    Ok(())
}
