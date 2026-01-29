/// Route component constants shared across crates
pub const API_ROUTE_COMPONENT: &str = "api";
pub const API_ROUTE_PREFIX: &str = const_str::concat!("/", API_ROUTE_COMPONENT);

pub const DAV_ROUTE_COMPONENT: &str = "dav";
pub const DAV_ROUTE_PREFIX: &str = const_str::concat!(API_ROUTE_PREFIX, "/", DAV_ROUTE_COMPONENT);

pub const CALDAV_ROUTE_COMPONENT: &str = "cal";
pub const CALDAV_ROUTE_PREFIX: &str =
    const_str::concat!(DAV_ROUTE_PREFIX, "/", CALDAV_ROUTE_COMPONENT);

pub const CARDDAV_ROUTE_COMPONENT: &str = "card";
pub const CARDDAV_ROUTE_PREFIX: &str =
    const_str::concat!(DAV_ROUTE_PREFIX, "/", CARDDAV_ROUTE_COMPONENT);
