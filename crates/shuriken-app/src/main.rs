use salvo::conn::TcpListener;
use salvo::{Listener, Router};
use shuriken_app::app::api::routes;
use shuriken_app::config::ConfigHandler;
use shuriken_app::db_handler::DbProviderHandler;
use shuriken_core::config::load_config;
use shuriken_db::db::connection::create_pool;
use shuriken_service::auth::casbin::{CasbinEnforcerHandler, init_casbin};
use tracing_subscriber::{EnvFilter, fmt, layer::SubscriberExt, reload, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let (filter_layer, filter_handle) = reload::Layer::new(EnvFilter::new("debug"));

    tracing_subscriber::registry()
        .with(filter_layer)
        .with(
            fmt::layer()
                .with_target(true)
                .with_thread_ids(true)
                .with_file(true)
                .with_line_number(true),
        )
        .init();

    tracing::info!("Starting Shuriken CalDAV/CardDAV server");

    let config = load_config()?;

    tracing::info!(config = ?config, "Configuration loaded");

    if let Ok(filter) = EnvFilter::try_new(config.logging.level.as_str()) {
        if let Err(e) = filter_handle.modify(|current| *current = filter) {
            tracing::warn!(error = %e, "Failed to update log filter from config");
        }
    } else {
        tracing::warn!(level = %config.logging.level, "Invalid log level in config, keeping debug");
    }

    let pool = create_pool(
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
