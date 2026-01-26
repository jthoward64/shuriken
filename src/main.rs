use salvo::conn::TcpListener;
use salvo::{Listener, Router};
use shuriken::app::api::routes;
use shuriken::component::auth::casbin::{CasbinEnforcerHandler, init_casbin};
use shuriken::component::config::{ConfigHandler, load_config};
use shuriken::component::db::connection::{self, DbProviderHandler};
use tracing_subscriber::{EnvFilter, fmt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing with environment variable support
    // RUST_LOG can be used to control log levels, e.g.:
    // RUST_LOG=debug for debug logs
    // RUST_LOG=shuriken=debug for debug logs in shuriken only
    // RUST_LOG=shuriken::component::db=trace for trace logs in db component
    let env_filter: EnvFilter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    fmt()
        .with_env_filter(env_filter)
        .with_target(true)
        .with_thread_ids(true)
        .with_file(true)
        .with_line_number(true)
        .init();

    tracing::info!("Starting Shuriken CalDAV/CardDAV server");

    let config = load_config()?;

    tracing::info!(config = ?config, "Configuration loaded");

    let pool = connection::create_pool(
        &config.database.url,
        u32::from(config.database.max_connections),
    )
    .await?;

    let enforcer = init_casbin(pool.clone()).await?;

    tracing::info!("Database connection pool created.");

    let bind_addr = format!("{}:{}", config.server.host, config.server.port);
    let acceptor = TcpListener::new(bind_addr.clone()).bind().await;

    let router = Router::new()
        .hoop(DbProviderHandler { provider: pool })
        .hoop(ConfigHandler {
            settings: config.clone(),
        })
        .hoop(CasbinEnforcerHandler {
            enforcer: std::sync::Arc::new(enforcer),
        })
        .push(routes()?);

    tracing::info!("Server listening on {bind_addr}");

    salvo::Server::new(acceptor).serve(router).await;

    Ok(())
}
