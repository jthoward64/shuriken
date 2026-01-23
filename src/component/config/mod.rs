use std::sync::OnceLock;

use anyhow::Result;
use config::Config;
use serde::Deserialize;

static CONFIG: OnceLock<Settings> = OnceLock::new();

#[derive(Debug, Clone, Deserialize)]
pub struct Settings {
    pub database: DatabaseConfig,
    pub auth: AuthConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthMethod {
    SingleUser,
    Proxy,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AuthConfig {
    pub method: AuthMethod,
    pub proxy: Option<ProxyAuthConfig>,
    pub single_user: Option<SingleUserAuthConfig>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProxyAuthConfig {}

#[derive(Debug, Clone, Deserialize)]
pub struct SingleUserAuthConfig {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseConfig {
    pub url: String,
}

impl Settings {
    /// ## Summary
    /// Loads configuration from `.env` file and environment variables into a `Settings`.
    /// Environment variables take precedence over `.env` file values.
    ///
    /// ## Errors
    /// Returns an error if building the configuration or deserializing it fails.
    pub fn load() -> Result<Self> {
        Ok(Config::builder()
            // Env file
            .add_source(
                config::Environment::default()
                    .convert_case(config::Case::Snake)
                    .separator("_")
                    .ignore_empty(true)
                    .try_parsing(true),
            )
            // TOML file
            .add_source(config::File::with_name("config.toml").required(false))
            .build()?
            .try_deserialize::<Settings>()?)
    }
}

pub fn load_config() -> Result<()> {
    dotenv::dotenv().ok();

    let settings = Settings::load()?;
    CONFIG
        .set(settings)
        .expect("Failed to set global configuration");
    Ok(())
}

pub fn get_config() -> &'static Settings {
    CONFIG.get().expect("Configuration not loaded")
}
