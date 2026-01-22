use shuriken::app::db::connection;
use shuriken::component::config::Config;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = Config::load()?;

    let pool = connection::create_pool(&config.database.url).await?;

    println!("Database connection pool established");

    Ok(())
}
