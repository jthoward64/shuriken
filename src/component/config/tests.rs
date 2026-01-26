//! Tests for configuration module.

use super::*;

#[test_log::test]
fn test_auth_method_serialization() {
    tracing::debug!("Testing auth method serialization");

    // Test that AuthMethod variants can be constructed
    let single_user = AuthMethod::SingleUser;
    let proxy = AuthMethod::Proxy;

    // Verify Debug trait
    assert!(format!("{single_user:?}").contains("SingleUser"));
    assert!(format!("{proxy:?}").contains("Proxy"));

    tracing::debug!("Auth method serialization test passed");
}

#[test]
fn test_database_config_clone() {
    let config = DatabaseConfig {
        url: "postgresql://localhost/test".to_string(),
        max_connections: 4,
    };

    let cloned = config.clone();
    assert_eq!(cloned.url, config.url);
}

#[test]
fn test_single_user_auth_config() {
    let config = SingleUserAuthConfig {
        name: "Test User".to_string(),
        email: "test@example.com".to_string(),
    };

    assert_eq!(config.name, "Test User");
    assert_eq!(config.email, "test@example.com");

    let cloned = config.clone();
    assert_eq!(cloned.name, config.name);
    assert_eq!(cloned.email, config.email);
}

#[test]
fn test_proxy_auth_config() {
    let config = ProxyAuthConfig {};
    let cloned = config.clone();

    // Verify Debug trait works
    assert!(format!("{cloned:?}").contains("ProxyAuthConfig"));
}

#[test]
fn test_auth_config_with_single_user() {
    let config = AuthConfig {
        method: AuthMethod::SingleUser,
        proxy: None,
        single_user: Some(SingleUserAuthConfig {
            name: "Admin".to_string(),
            email: "admin@example.com".to_string(),
        }),
    };

    assert!(matches!(config.method, AuthMethod::SingleUser));
    assert!(config.single_user.is_some());
    assert!(config.proxy.is_none());
}

#[test]
fn test_auth_config_with_proxy() {
    let config = AuthConfig {
        method: AuthMethod::Proxy,
        proxy: Some(ProxyAuthConfig {}),
        single_user: None,
    };

    assert!(matches!(config.method, AuthMethod::Proxy));
    assert!(config.proxy.is_some());
    assert!(config.single_user.is_none());
}

#[test]
fn test_settings_structure() {
    let settings = Settings {
        database: DatabaseConfig {
            url: "postgresql://test".to_string(),
            max_connections: 8,
        },
        auth: AuthConfig {
            method: AuthMethod::SingleUser,
            proxy: None,
            single_user: Some(SingleUserAuthConfig {
                name: "Test".to_string(),
                email: "test@test.com".to_string(),
            }),
        },
        server: ServerConfig {
            host: "127.0.0.1".to_string(),
            port: 8698,
        },
        logging: LoggingConfig {
            level: "debug".to_string(),
        },
    };

    assert_eq!(settings.database.url, "postgresql://test");
    assert!(settings.auth.single_user.is_some());

    let cloned = settings.clone();
    assert_eq!(cloned.database.url, settings.database.url);
}

#[test]
fn test_settings_debug() {
    let settings = Settings {
        database: DatabaseConfig {
            url: "test_url".to_string(),
            max_connections: 8,
        },
        auth: AuthConfig {
            method: AuthMethod::Proxy,
            proxy: Some(ProxyAuthConfig {}),
            single_user: None,
        },
        server: ServerConfig {
            host: "127.0.0.1".to_string(),
            port: 8698,
        },
        logging: LoggingConfig {
            level: "info".to_string(),
        },
    };

    let debug_str = format!("{settings:?}");
    assert!(debug_str.contains("Settings"));
    assert!(debug_str.contains("database"));
    assert!(debug_str.contains("auth"));
}
