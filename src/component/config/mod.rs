use anyhow::Result;
use config::Config as RawConfig;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub database: DatabaseConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseConfig {
    pub url: String,
}

#[derive(Debug, Clone, Deserialize)]
struct FlatConfig {
    database_url: String,
}

impl Config {
    /// ## Summary
    /// Loads configuration from `.env` file and environment variables into a `Config`.
    /// Environment variables take precedence over `.env` file values.
    ///
    /// ## Errors
    /// Returns an error if building the configuration or deserializing it fails.
    pub fn load() -> Result<Self> {
        dotenv::dotenv().ok();

        let flat: FlatConfig = RawConfig::builder()
            .add_source(config::Environment::default())
            .build()?
            .try_deserialize()?;

        Ok(Self {
            database: DatabaseConfig {
                url: flat.database_url,
            },
        })
    }
}
