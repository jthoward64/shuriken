use anyhow::Result;
use config::Config;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Settings {
    pub database: DatabaseConfig,
    pub auth: AuthConfig,
    pub server: ServerConfig,
    pub logging: LoggingConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthMethod {
    SingleUser,
    BasicAuth,
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
    pub max_connections: u8,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub serve_origin: Option<String>,
}

impl ServerConfig {
    /// ## Summary
    /// Returns the server address as a string in the format "host:port".
    #[must_use]
    pub fn serve_origin(&self) -> String {
        format!("http://{}:{}", self.host, self.port)
    }

    /// ## Summary
    /// Returns the server origin URL.
    #[must_use]
    pub fn origin(&self) -> String {
        if let Some(origin) = &self.serve_origin {
            origin.clone()
        } else {
            self.serve_origin()
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct LoggingConfig {
    pub level: String,
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
            .set_default("server.host", "0.0.0.0")?
            .set_default("server.port", 8698)?
            .set_default("database.max_connections", 4)?
            .set_default("logging.level", "debug")?
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

/// ## Summary
/// Loads configuration from environment variables and `.env` file.
///
/// ## Errors
/// Returns an error if loading or deserializing the configuration fails.
pub fn load_config() -> Result<Settings> {
    dotenvy::dotenv().ok();

    Settings::load()
}
