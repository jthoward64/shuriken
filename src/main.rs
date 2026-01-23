use salvo::conn::TcpListener;
use salvo::{Listener, Router};
use shuriken::app::api::routes;
use shuriken::component::auth::casbin::init_casbin;
use shuriken::component::config::{get_config, load_config};
use shuriken::component::db::connection;
use tracing_subscriber::fmt;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    fmt::init();

    load_config()?;

    tracing::info!("Configuration loaded: {:?}", get_config());

    connection::create_pool(&get_config().database.url, 4).await?;

    init_casbin().await?;

    tracing::info!("Database connection pool created.");

    let acceptor = TcpListener::new("0.0.0.0:8698").bind().await;

    let router = Router::new().push(routes());

    salvo::Server::new(acceptor).serve(router).await;

    Ok(())
}
