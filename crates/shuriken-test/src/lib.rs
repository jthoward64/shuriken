//! Shuriken CalDAV/CardDAV server - integration test support.
//!
//! This crate re-exports the workspace crates to support integration tests
//! that use `shuriken::` paths.

#![allow(ambiguous_glob_reexports)]

pub mod component {
    // Re-export core and service modules at the component level
    pub use shuriken_core::*;
    pub use shuriken_service::*;

    // Re-export db crate with all its public modules
    pub mod db {
        pub use shuriken_db::db::*;

        // Additional db handlers from app
        pub mod connection {
            pub use shuriken_app::db_handler::DbProviderHandler;
            pub use shuriken_db::db::connection::*;
        }
    }

    // Re-export models
    pub mod model {
        pub use shuriken_db::model::*;
    }

    // Re-export app middleware and handlers
    pub mod middleware {
        pub use shuriken_app::middleware::*;
    }

    // Re-export config from both core and app
    pub mod config {
        pub use shuriken_app::config::ConfigHandler;
        pub use shuriken_core::config::*;
    }
}

// Re-export top-level modules for convenience
pub mod app {
    pub use shuriken_app::*;

    pub mod api {
        pub use shuriken_app::app::api::*;
    }
}

pub use shuriken_rfc as rfc;
