//! Database enum types with Diesel serialization.
//!
//! This module provides type-safe enum wrappers for database CHECK constraints.
//! Each enum implements `ToSql` and `FromSql` for automatic conversion between Rust and `PostgreSQL`.

use diesel::deserialize::{self, FromSql, FromSqlRow};
use diesel::expression::AsExpression;
use diesel::pg::{Pg, PgValue};
use diesel::serialize::{self, IsNull, Output, ToSql};
use diesel::sql_types::Text;
use std::fmt;
use std::io::Write;

/// Principal type classification.
///
/// Maps to `principal.principal_type` CHECK constraint.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    AsExpression,
    FromSqlRow,
    serde::Serialize,
    serde::Deserialize,
)]
#[diesel(sql_type = Text)]
pub enum PrincipalType {
    User,
    Group,
    System,
    Unauthenticated,
    Resource,
}

impl ToSql<Text, Pg> for PrincipalType {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Pg>) -> serialize::Result {
        let s = match self {
            Self::User => "user",
            Self::Group => "group",
            Self::System => "system",
            Self::Unauthenticated => "unauthenticated",
            Self::Resource => "resource",
        };
        out.write_all(s.as_bytes())?;
        Ok(IsNull::No)
    }
}

impl FromSql<Text, Pg> for PrincipalType {
    fn from_sql(bytes: PgValue<'_>) -> deserialize::Result<Self> {
        match bytes.as_bytes() {
            b"user" => Ok(Self::User),
            b"group" => Ok(Self::Group),
            b"system" => Ok(Self::System),
            b"unauthenticated" => Ok(Self::Unauthenticated),
            b"resource" => Ok(Self::Resource),
            _ => Err("Unrecognized enum variant".into()),
        }
    }
}

impl PrincipalType {
    /// Returns the database string representation of this principal type.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Group => "group",
            Self::System => "system",
            Self::Unauthenticated => "unauthenticated",
            Self::Resource => "resource",
        }
    }
}

impl fmt::Display for PrincipalType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Collection type for DAV storage.
///
/// Maps to `dav_collection.collection_type` CHECK constraint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, AsExpression, FromSqlRow)]
#[diesel(sql_type = Text)]
pub enum CollectionType {
    Collection,
    Calendar,
    Addressbook,
}

impl ToSql<Text, Pg> for CollectionType {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Pg>) -> serialize::Result {
        let s = match self {
            Self::Collection => "collection",
            Self::Calendar => "calendar",
            Self::Addressbook => "addressbook",
        };
        out.write_all(s.as_bytes())?;
        Ok(IsNull::No)
    }
}

impl FromSql<Text, Pg> for CollectionType {
    fn from_sql(bytes: PgValue<'_>) -> deserialize::Result<Self> {
        match bytes.as_bytes() {
            b"collection" => Ok(Self::Collection),
            b"calendar" => Ok(Self::Calendar),
            b"addressbook" => Ok(Self::Addressbook),
            _ => Err("Unrecognized enum variant".into()),
        }
    }
}

impl CollectionType {
    /// Returns the database string representation of this collection type.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Collection => "collection",
            Self::Calendar => "calendar",
            Self::Addressbook => "addressbook",
        }
    }
}

impl From<CollectionType> for shuriken_core::types::CollectionType {
    fn from(db_type: CollectionType) -> Self {
        match db_type {
            CollectionType::Collection => Self::Collection,
            CollectionType::Calendar => Self::Calendar,
            CollectionType::Addressbook => Self::Addressbook,
        }
    }
}

impl From<shuriken_core::types::CollectionType> for CollectionType {
    fn from(core_type: shuriken_core::types::CollectionType) -> Self {
        match core_type {
            shuriken_core::types::CollectionType::Collection => Self::Collection,
            shuriken_core::types::CollectionType::Calendar => Self::Calendar,
            shuriken_core::types::CollectionType::Addressbook => Self::Addressbook,
        }
    }
}

impl fmt::Display for CollectionType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Entity type for DAV storage (root component type).
///
/// Maps to `dav_entity.entity_type` CHECK constraint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, AsExpression, FromSqlRow)]
#[diesel(sql_type = Text)]
pub enum EntityType {
    ICalendar,
    VCard,
}

impl ToSql<Text, Pg> for EntityType {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Pg>) -> serialize::Result {
        let s = match self {
            Self::ICalendar => "icalendar",
            Self::VCard => "vcard",
        };
        out.write_all(s.as_bytes())?;
        Ok(IsNull::No)
    }
}

impl FromSql<Text, Pg> for EntityType {
    fn from_sql(bytes: PgValue<'_>) -> deserialize::Result<Self> {
        match bytes.as_bytes() {
            b"icalendar" => Ok(Self::ICalendar),
            b"vcard" => Ok(Self::VCard),
            _ => Err("Unrecognized enum variant".into()),
        }
    }
}

impl EntityType {
    /// Returns the database string representation of this entity type.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ICalendar => "icalendar",
            Self::VCard => "vcard",
        }
    }
}

impl fmt::Display for EntityType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Content type for DAV instances (MIME type).
///
/// Maps to `dav_instance.content_type` and `dav_shadow.content_type` CHECK constraints.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, AsExpression, FromSqlRow)]
#[diesel(sql_type = Text)]
pub enum ContentType {
    TextCalendar,
    TextVCard,
}

impl ToSql<Text, Pg> for ContentType {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Pg>) -> serialize::Result {
        let s = match self {
            Self::TextCalendar => "text/calendar",
            Self::TextVCard => "text/vcard",
        };
        out.write_all(s.as_bytes())?;
        Ok(IsNull::No)
    }
}

impl FromSql<Text, Pg> for ContentType {
    fn from_sql(bytes: PgValue<'_>) -> deserialize::Result<Self> {
        match bytes.as_bytes() {
            b"text/calendar" => Ok(Self::TextCalendar),
            b"text/vcard" => Ok(Self::TextVCard),
            _ => Err("Unrecognized enum variant".into()),
        }
    }
}

impl ContentType {
    /// Returns the MIME type string representation of this content type.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::TextCalendar => "text/calendar",
            Self::TextVCard => "text/vcard",
        }
    }

    /// Checks if the content type string starts with the given prefix.
    #[must_use]
    pub fn starts_with(self, prefix: &str) -> bool {
        self.as_str().starts_with(prefix)
    }
}

impl fmt::Display for ContentType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl AsRef<str> for ContentType {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl From<ContentType> for String {
    fn from(ct: ContentType) -> Self {
        ct.as_str().to_owned()
    }
}

/// Value type for DAV properties (typed columns).
///
/// Maps to `dav_property.value_type` CHECK constraint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, AsExpression, FromSqlRow)]
#[diesel(sql_type = Text)]
pub enum ValueType {
    Text,
    Integer,
    Float,
    Boolean,
    Date,
    DateTime,
    Duration,
    Uri,
    Binary,
    Json,
}

impl ToSql<Text, Pg> for ValueType {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Pg>) -> serialize::Result {
        let s = match self {
            Self::Text => "TEXT",
            Self::Integer => "INTEGER",
            Self::Float => "FLOAT",
            Self::Boolean => "BOOLEAN",
            Self::Date => "DATE",
            Self::DateTime => "DATE_TIME",
            Self::Duration => "DURATION",
            Self::Uri => "URI",
            Self::Binary => "BINARY",
            Self::Json => "JSON",
        };
        out.write_all(s.as_bytes())?;
        Ok(IsNull::No)
    }
}

impl FromSql<Text, Pg> for ValueType {
    fn from_sql(bytes: PgValue<'_>) -> deserialize::Result<Self> {
        match bytes.as_bytes() {
            b"TEXT" => Ok(Self::Text),
            b"INTEGER" => Ok(Self::Integer),
            b"FLOAT" => Ok(Self::Float),
            b"BOOLEAN" => Ok(Self::Boolean),
            b"DATE" => Ok(Self::Date),
            b"DATE_TIME" => Ok(Self::DateTime),
            b"DURATION" => Ok(Self::Duration),
            b"URI" => Ok(Self::Uri),
            b"BINARY" => Ok(Self::Binary),
            b"JSON" => Ok(Self::Json),
            _ => Err("Unrecognized enum variant".into()),
        }
    }
}

impl ValueType {
    /// Returns the database string representation of this value type.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Text => "TEXT",
            Self::Integer => "INTEGER",
            Self::Float => "FLOAT",
            Self::Boolean => "BOOLEAN",
            Self::Date => "DATE",
            Self::DateTime => "DATE_TIME",
            Self::Duration => "DURATION",
            Self::Uri => "URI",
            Self::Binary => "BINARY",
            Self::Json => "JSON",
        }
    }
}

impl fmt::Display for ValueType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Shadow storage direction (debug only).
///
/// Maps to `dav_shadow.direction` CHECK constraint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, AsExpression, FromSqlRow)]
#[diesel(sql_type = Text)]
pub enum ShadowDirection {
    Inbound,
    Outbound,
}

impl ToSql<Text, Pg> for ShadowDirection {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Pg>) -> serialize::Result {
        let s = match self {
            Self::Inbound => "inbound",
            Self::Outbound => "outbound",
        };
        out.write_all(s.as_bytes())?;
        Ok(IsNull::No)
    }
}

impl FromSql<Text, Pg> for ShadowDirection {
    fn from_sql(bytes: PgValue<'_>) -> deserialize::Result<Self> {
        match bytes.as_bytes() {
            b"inbound" => Ok(Self::Inbound),
            b"outbound" => Ok(Self::Outbound),
            _ => Err("Unrecognized enum variant".into()),
        }
    }
}

impl ShadowDirection {
    /// Returns the database string representation of this shadow direction.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Inbound => "inbound",
            Self::Outbound => "outbound",
        }
    }
}

impl fmt::Display for ShadowDirection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// iTIP method for calendar scheduling.
///
/// Maps to `cal_itip.method` CHECK constraint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, AsExpression, FromSqlRow)]
#[diesel(sql_type = Text)]
pub enum ItipMethod {
    Request,
    Reply,
    Cancel,
    Refresh,
    Counter,
    DeclineCounter,
    Add,
}

impl ToSql<Text, Pg> for ItipMethod {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Pg>) -> serialize::Result {
        let s = match self {
            Self::Request => "REQUEST",
            Self::Reply => "REPLY",
            Self::Cancel => "CANCEL",
            Self::Refresh => "REFRESH",
            Self::Counter => "COUNTER",
            Self::DeclineCounter => "DECLINECOUNTER",
            Self::Add => "ADD",
        };
        out.write_all(s.as_bytes())?;
        Ok(IsNull::No)
    }
}

impl FromSql<Text, Pg> for ItipMethod {
    fn from_sql(bytes: PgValue<'_>) -> deserialize::Result<Self> {
        match bytes.as_bytes() {
            b"REQUEST" => Ok(Self::Request),
            b"REPLY" => Ok(Self::Reply),
            b"CANCEL" => Ok(Self::Cancel),
            b"REFRESH" => Ok(Self::Refresh),
            b"COUNTER" => Ok(Self::Counter),
            b"DECLINECOUNTER" => Ok(Self::DeclineCounter),
            b"ADD" => Ok(Self::Add),
            _ => Err("Unrecognized enum variant".into()),
        }
    }
}

impl ItipMethod {
    /// Returns the database string representation of this iTIP method.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Request => "REQUEST",
            Self::Reply => "REPLY",
            Self::Cancel => "CANCEL",
            Self::Refresh => "REFRESH",
            Self::Counter => "COUNTER",
            Self::DeclineCounter => "DECLINECOUNTER",
            Self::Add => "ADD",
        }
    }
}

impl fmt::Display for ItipMethod {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// iTIP message delivery status.
///
/// Maps to `cal_itip.status` CHECK constraint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, AsExpression, FromSqlRow)]
#[diesel(sql_type = Text)]
pub enum ItipStatus {
    Pending,
    Delivered,
    Failed,
}

impl ToSql<Text, Pg> for ItipStatus {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Pg>) -> serialize::Result {
        let s = match self {
            Self::Pending => "pending",
            Self::Delivered => "delivered",
            Self::Failed => "failed",
        };
        out.write_all(s.as_bytes())?;
        Ok(IsNull::No)
    }
}

impl FromSql<Text, Pg> for ItipStatus {
    fn from_sql(bytes: PgValue<'_>) -> deserialize::Result<Self> {
        match bytes.as_bytes() {
            b"pending" => Ok(Self::Pending),
            b"delivered" => Ok(Self::Delivered),
            b"failed" => Ok(Self::Failed),
            _ => Err("Unrecognized enum variant".into()),
        }
    }
}

impl ItipStatus {
    /// Returns the database string representation of this iTIP status.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Delivered => "delivered",
            Self::Failed => "failed",
        }
    }
}

impl fmt::Display for ItipStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Participation status for attendees.
///
/// Maps to `cal_attendee.partstat` CHECK constraint (RFC 5545 §3.2.12).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, AsExpression, FromSqlRow)]
#[diesel(sql_type = Text)]
pub enum ParticipationStatus {
    NeedsAction,
    Accepted,
    Declined,
    Tentative,
    Delegated,
    Completed,
    InProcess,
}

impl ToSql<Text, Pg> for ParticipationStatus {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Pg>) -> serialize::Result {
        let s = match self {
            Self::NeedsAction => "NEEDS-ACTION",
            Self::Accepted => "ACCEPTED",
            Self::Declined => "DECLINED",
            Self::Tentative => "TENTATIVE",
            Self::Delegated => "DELEGATED",
            Self::Completed => "COMPLETED",
            Self::InProcess => "IN-PROCESS",
        };
        out.write_all(s.as_bytes())?;
        Ok(IsNull::No)
    }
}

impl FromSql<Text, Pg> for ParticipationStatus {
    fn from_sql(bytes: PgValue<'_>) -> deserialize::Result<Self> {
        match bytes.as_bytes() {
            b"NEEDS-ACTION" => Ok(Self::NeedsAction),
            b"ACCEPTED" => Ok(Self::Accepted),
            b"DECLINED" => Ok(Self::Declined),
            b"TENTATIVE" => Ok(Self::Tentative),
            b"DELEGATED" => Ok(Self::Delegated),
            b"COMPLETED" => Ok(Self::Completed),
            b"IN-PROCESS" => Ok(Self::InProcess),
            _ => Err("Unrecognized enum variant".into()),
        }
    }
}

impl ParticipationStatus {
    /// Returns the database string representation of this participation status.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::NeedsAction => "NEEDS-ACTION",
            Self::Accepted => "ACCEPTED",
            Self::Declined => "DECLINED",
            Self::Tentative => "TENTATIVE",
            Self::Delegated => "DELEGATED",
            Self::Completed => "COMPLETED",
            Self::InProcess => "IN-PROCESS",
        }
    }
}

impl fmt::Display for ParticipationStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Attendee role in calendar event.
///
/// Maps to `cal_attendee.role` CHECK constraint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, AsExpression, FromSqlRow)]
#[diesel(sql_type = Text)]
pub enum AttendeeRole {
    Chair,
    ReqParticipant,
    OptParticipant,
    NonParticipant,
}

impl ToSql<Text, Pg> for AttendeeRole {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Pg>) -> serialize::Result {
        let s = match self {
            Self::Chair => "CHAIR",
            Self::ReqParticipant => "REQ-PARTICIPANT",
            Self::OptParticipant => "OPT-PARTICIPANT",
            Self::NonParticipant => "NON-PARTICIPANT",
        };
        out.write_all(s.as_bytes())?;
        Ok(IsNull::No)
    }
}

impl FromSql<Text, Pg> for AttendeeRole {
    fn from_sql(bytes: PgValue<'_>) -> deserialize::Result<Self> {
        match bytes.as_bytes() {
            b"CHAIR" => Ok(Self::Chair),
            b"REQ-PARTICIPANT" => Ok(Self::ReqParticipant),
            b"OPT-PARTICIPANT" => Ok(Self::OptParticipant),
            b"NON-PARTICIPANT" => Ok(Self::NonParticipant),
            _ => Err("Unrecognized enum variant".into()),
        }
    }
}

impl AttendeeRole {
    /// Returns the database string representation of this attendee role.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Chair => "CHAIR",
            Self::ReqParticipant => "REQ-PARTICIPANT",
            Self::OptParticipant => "OPT-PARTICIPANT",
            Self::NonParticipant => "NON-PARTICIPANT",
        }
    }
}

impl fmt::Display for AttendeeRole {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Component type for calendar index.
///
/// Maps to `cal_index.component_type` CHECK constraint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, AsExpression, FromSqlRow)]
#[diesel(sql_type = Text)]
pub enum ComponentType {
    VEvent,
    VTodo,
    VJournal,
    VFreeBusy,
    Invalid,
}

impl ToSql<Text, Pg> for ComponentType {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Pg>) -> serialize::Result {
        let s = match self {
            Self::VEvent => "VEVENT",
            Self::VTodo => "VTODO",
            Self::VJournal => "VJOURNAL",
            Self::VFreeBusy => "VFREEBUSY",
            Self::Invalid => "INVALID",
        };
        out.write_all(s.as_bytes())?;
        Ok(IsNull::No)
    }
}

impl FromSql<Text, Pg> for ComponentType {
    fn from_sql(bytes: PgValue<'_>) -> deserialize::Result<Self> {
        match bytes.as_bytes() {
            b"VEVENT" => Ok(Self::VEvent),
            b"VTODO" => Ok(Self::VTodo),
            b"VJOURNAL" => Ok(Self::VJournal),
            b"VFREEBUSY" => Ok(Self::VFreeBusy),
            b"INVALID" => Ok(Self::Invalid),
            _ => Err("Unrecognized enum variant".into()),
        }
    }
}

impl ComponentType {
    /// Returns the database string representation of this component type.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::VEvent => "VEVENT",
            Self::VTodo => "VTODO",
            Self::VJournal => "VJOURNAL",
            Self::VFreeBusy => "VFREEBUSY",
            Self::Invalid => "INVALID",
        }
    }
}

impl fmt::Display for ComponentType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl From<shuriken_rfc::rfc::ical::core::ComponentKind> for ComponentType {
    fn from(kind: shuriken_rfc::rfc::ical::core::ComponentKind) -> Self {
        use shuriken_rfc::rfc::ical::core::ComponentKind;
        match kind {
            ComponentKind::Event => Self::VEvent,
            ComponentKind::Todo => Self::VTodo,
            ComponentKind::Journal => Self::VJournal,
            ComponentKind::FreeBusy => Self::VFreeBusy,
            _ => Self::Invalid,
        }
    }
}

/// Time transparency for calendar events.
///
/// Maps to `cal_index.transp` CHECK constraint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, AsExpression, FromSqlRow)]
#[diesel(sql_type = Text)]
pub enum Transparency {
    Opaque,
    Transparent,
}

impl ToSql<Text, Pg> for Transparency {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Pg>) -> serialize::Result {
        let s = match self {
            Self::Opaque => "OPAQUE",
            Self::Transparent => "TRANSPARENT",
        };
        out.write_all(s.as_bytes())?;
        Ok(IsNull::No)
    }
}

impl FromSql<Text, Pg> for Transparency {
    fn from_sql(bytes: PgValue<'_>) -> deserialize::Result<Self> {
        match bytes.as_bytes() {
            b"OPAQUE" => Ok(Self::Opaque),
            b"TRANSPARENT" => Ok(Self::Transparent),
            _ => Err("Unrecognized enum variant".into()),
        }
    }
}

impl Transparency {
    /// Returns the database string representation of this transparency value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Opaque => "OPAQUE",
            Self::Transparent => "TRANSPARENT",
        }
    }
}

impl fmt::Display for Transparency {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Event status for calendar events.
///
/// Maps to `cal_index.status` CHECK constraint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, AsExpression, FromSqlRow)]
#[diesel(sql_type = Text)]
pub enum EventStatus {
    Tentative,
    Confirmed,
    Cancelled,
}

impl ToSql<Text, Pg> for EventStatus {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Pg>) -> serialize::Result {
        let s = match self {
            Self::Tentative => "TENTATIVE",
            Self::Confirmed => "CONFIRMED",
            Self::Cancelled => "CANCELLED",
        };
        out.write_all(s.as_bytes())?;
        Ok(IsNull::No)
    }
}

impl FromSql<Text, Pg> for EventStatus {
    fn from_sql(bytes: PgValue<'_>) -> deserialize::Result<Self> {
        match bytes.as_bytes() {
            b"TENTATIVE" => Ok(Self::Tentative),
            b"CONFIRMED" => Ok(Self::Confirmed),
            b"CANCELLED" => Ok(Self::Cancelled),
            _ => Err("Unrecognized enum variant".into()),
        }
    }
}

impl EventStatus {
    /// Returns the database string representation of this event status.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Tentative => "TENTATIVE",
            Self::Confirmed => "CONFIRMED",
            Self::Cancelled => "CANCELLED",
        }
    }
}

impl fmt::Display for EventStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}
