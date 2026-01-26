//! `WebDAV` XML types.
//!
//! This module defines the core types for `WebDAV` XML elements
//! used in `PROPFIND`, `PROPPATCH`, `REPORT`, and multistatus responses.

mod depth;
mod error;
mod href;
mod multistatus;
mod namespace;
mod partial_retrieval;
pub mod precondition;
pub mod property;
mod propfind;
mod proppatch;
mod report;

pub use depth::Depth;
pub use error::DavError;
pub use href::Href;
pub use multistatus::{Multistatus, Propstat, PropstatResponse, ResponseDescription, Status};
pub use namespace::{CALDAV_NS, CARDDAV_NS, CS_NS, DAV_NS, Namespace, QName};
pub use partial_retrieval::{AddressDataRequest, CalendarDataRequest, ComponentSelection};
pub use precondition::PreconditionError;
pub use property::{DavProperty, PropertyName, PropertyValue};
pub use propfind::{PropfindRequest, PropfindType};
pub use proppatch::{PropertyUpdate, ProppatchRequest, SetOrRemove};
pub use report::{
    AddressbookFilter, AddressbookMultiget, AddressbookQuery, CalendarFilter, CalendarMultiget,
    CalendarQuery, CompFilter, ExpandProperty, ExpandPropertyItem, FilterTest, FreeBusyQuery,
    MatchType, ParamFilter, PropFilter, RecurrenceExpansion, ReportRequest, ReportType,
    SyncCollection, SyncLevel, TextMatch, TimeRange,
};
