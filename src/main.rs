use salvo::conn::TcpListener;
use salvo::{Listener, Router};
use shuriken::app::api::routes;
use shuriken::component::config::{Settings, get_config, load_config};
use shuriken::component::db::{build_pool, connection};
use tracing_subscriber::fmt;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    fmt::init();

    load_config()?;

    tracing::info!("Configuration loaded: {:?}", get_config());

    build_pool(&get_config().database.url, get_config().database.pool_size)?;

    tracing::info!("Database connection pool created.");

    let acceptor = TcpListener::new("0.0.0.0:8698").bind().await;

    let router = Router::new().push(routes());

    salvo::Server::new(acceptor).serve(router).await;

    Ok(())
}
