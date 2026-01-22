use shuriken::component::config::Config;

fn main() -> anyhow::Result<()> {
    let config = Config::load()?;

    println!(
        "Configuration loaded, database URL: {}",
        config.database.url
    );

    Ok(())
}
