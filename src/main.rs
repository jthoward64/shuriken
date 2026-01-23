use salvo::conn::TcpListener;
use salvo::{Listener, Router};
use shuriken::app::api::routes;
use shuriken::app::db::connection;
use shuriken::component::config::Settings;
use tracing_subscriber::fmt;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    fmt::init();

    let config = Settings::load()?;

    tracing::info!("Configuration loaded: {:?}", config);

    let pool = connection::create_pool(&config.database.url).await?;

    tracing::info!("Database connection pool created.");

    let acceptor = TcpListener::new("0.0.0.0:8698").bind().await;

    let router = Router::new().push(routes());

    salvo::Server::new(acceptor).serve(router).await;

    Ok(())
}
