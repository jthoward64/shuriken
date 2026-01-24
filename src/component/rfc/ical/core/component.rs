//! iCalendar component types (RFC 5545 §3.4-3.6).

use super::Property;

/// Component kind for iCalendar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ComponentKind {
    /// VCALENDAR wrapper component.
    Calendar,
    /// VEVENT component.
    Event,
    /// VTODO component.
    Todo,
    /// VJOURNAL component.
    Journal,
    /// VFREEBUSY component.
    FreeBusy,
    /// VTIMEZONE component.
    Timezone,
    /// VALARM component (nested within VEVENT/VTODO).
    Alarm,
    /// STANDARD sub-component of VTIMEZONE.
    Standard,
    /// DAYLIGHT sub-component of VTIMEZONE.
    Daylight,
    /// Unknown/X-component.
    Unknown,
}

impl ComponentKind {
    /// Returns the string name for this component kind.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Calendar => "VCALENDAR",
            Self::Event => "VEVENT",
            Self::Todo => "VTODO",
            Self::Journal => "VJOURNAL",
            Self::FreeBusy => "VFREEBUSY",
            Self::Timezone => "VTIMEZONE",
            Self::Alarm => "VALARM",
            Self::Standard => "STANDARD",
            Self::Daylight => "DAYLIGHT",
            Self::Unknown => "X-UNKNOWN",
        }
    }

    /// Parses a component kind from a string (case-insensitive).
    #[must_use]
    pub fn parse(s: &str) -> Self {
        match s.to_ascii_uppercase().as_str() {
            "VCALENDAR" => Self::Calendar,
            "VEVENT" => Self::Event,
            "VTODO" => Self::Todo,
            "VJOURNAL" => Self::Journal,
            "VFREEBUSY" => Self::FreeBusy,
            "VTIMEZONE" => Self::Timezone,
            "VALARM" => Self::Alarm,
            "STANDARD" => Self::Standard,
            "DAYLIGHT" => Self::Daylight,
            _ => Self::Unknown,
        }
    }

    /// Returns whether this component can contain other components.
    #[must_use]
    pub const fn can_have_children(self) -> bool {
        matches!(
            self,
            Self::Calendar | Self::Event | Self::Todo | Self::Timezone
        )
    }

    /// Returns whether this is a schedulable component (VEVENT, VTODO, VJOURNAL).
    #[must_use]
    pub const fn is_schedulable(self) -> bool {
        matches!(self, Self::Event | Self::Todo | Self::Journal)
    }
}

impl std::fmt::Display for ComponentKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// An iCalendar component.
///
/// Components can contain properties and nested sub-components.
/// For example, a VCALENDAR contains VEVENTs, which may contain VALARMs.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Component {
    /// Component type/name.
    pub kind: Option<ComponentKind>,
    /// Original component name (preserved for X-components).
    pub name: String,
    /// Properties in order of appearance.
    pub properties: Vec<Property>,
    /// Nested sub-components.
    pub children: Vec<Component>,
}

impl Component {
    /// Creates a new component with the given kind.
    #[must_use]
    pub fn new(kind: ComponentKind) -> Self {
        Self {
            kind: Some(kind),
            name: kind.as_str().to_string(),
            properties: Vec::new(),
            children: Vec::new(),
        }
    }

    /// Creates a new component with a custom name (for X-components).
    #[must_use]
    pub fn custom(name: impl Into<String>) -> Self {
        let name = name.into();
        let kind = ComponentKind::parse(&name);
        Self {
            kind: Some(kind),
            name,
            properties: Vec::new(),
            children: Vec::new(),
        }
    }

    /// Creates a VCALENDAR component.
    #[must_use]
    pub fn calendar() -> Self {
        Self::new(ComponentKind::Calendar)
    }

    /// Creates a VEVENT component.
    #[must_use]
    pub fn event() -> Self {
        Self::new(ComponentKind::Event)
    }

    /// Creates a VTODO component.
    #[must_use]
    pub fn todo() -> Self {
        Self::new(ComponentKind::Todo)
    }

    /// Creates a VJOURNAL component.
    #[must_use]
    pub fn journal() -> Self {
        Self::new(ComponentKind::Journal)
    }

    /// Creates a VTIMEZONE component.
    #[must_use]
    pub fn timezone() -> Self {
        Self::new(ComponentKind::Timezone)
    }

    /// Creates a VALARM component.
    #[must_use]
    pub fn alarm() -> Self {
        Self::new(ComponentKind::Alarm)
    }

    /// Adds a property to this component.
    pub fn add_property(&mut self, prop: Property) {
        self.properties.push(prop);
    }

    /// Adds a child component.
    pub fn add_child(&mut self, child: Component) {
        self.children.push(child);
    }

    /// Returns the first property with the given name.
    #[must_use]
    pub fn get_property(&self, name: &str) -> Option<&Property> {
        let name_upper = name.to_ascii_uppercase();
        self.properties.iter().find(|p| p.name == name_upper)
    }

    /// Returns all properties with the given name.
    #[must_use]
    pub fn get_properties(&self, name: &str) -> Vec<&Property> {
        let name_upper = name.to_ascii_uppercase();
        self.properties
            .iter()
            .filter(|p| p.name == name_upper)
            .collect()
    }

    /// Returns the UID property value if present.
    #[must_use]
    pub fn uid(&self) -> Option<&str> {
        self.get_property("UID")?.as_text()
    }

    /// Returns the SUMMARY property value if present.
    #[must_use]
    pub fn summary(&self) -> Option<&str> {
        self.get_property("SUMMARY")?.as_text()
    }

    /// Returns the DESCRIPTION property value if present.
    #[must_use]
    pub fn description(&self) -> Option<&str> {
        self.get_property("DESCRIPTION")?.as_text()
    }

    /// Returns children of a specific kind.
    #[must_use]
    pub fn children_of_kind(&self, kind: ComponentKind) -> Vec<&Component> {
        self.children
            .iter()
            .filter(|c| c.kind == Some(kind))
            .collect()
    }

    /// Returns all VEVENT children.
    #[must_use]
    pub fn events(&self) -> Vec<&Component> {
        self.children_of_kind(ComponentKind::Event)
    }

    /// Returns all VTODO children.
    #[must_use]
    pub fn todos(&self) -> Vec<&Component> {
        self.children_of_kind(ComponentKind::Todo)
    }

    /// Returns all VTIMEZONE children.
    #[must_use]
    pub fn timezones(&self) -> Vec<&Component> {
        self.children_of_kind(ComponentKind::Timezone)
    }

    /// Returns all VJOURNAL children.
    #[must_use]
    pub fn journals(&self) -> Vec<&Component> {
        self.children_of_kind(ComponentKind::Journal)
    }

    /// Returns all VFREEBUSY children.
    #[must_use]
    pub fn freebusy(&self) -> Vec<&Component> {
        self.children_of_kind(ComponentKind::FreeBusy)
    }

    /// Returns all VALARM children.
    #[must_use]
    pub fn alarms(&self) -> Vec<&Component> {
        self.children_of_kind(ComponentKind::Alarm)
    }
}

/// Top-level iCalendar object.
///
/// This is a convenience wrapper around a VCALENDAR component
/// with helper methods for common operations.
#[derive(Debug, Clone, PartialEq)]
pub struct ICalendar {
    /// The root VCALENDAR component.
    pub root: Component,
}

impl ICalendar {
    /// Creates a new empty iCalendar with required properties.
    #[must_use]
    pub fn new(prodid: impl Into<String>) -> Self {
        let mut root = Component::calendar();
        root.add_property(Property::text("VERSION", "2.0"));
        root.add_property(Property::text("PRODID", prodid));
        Self { root }
    }

    /// Returns the PRODID value.
    #[must_use]
    pub fn prodid(&self) -> Option<&str> {
        self.root.get_property("PRODID")?.as_text()
    }

    /// Returns the VERSION value.
    #[must_use]
    pub fn version(&self) -> Option<&str> {
        self.root.get_property("VERSION")?.as_text()
    }

    /// Returns the CALSCALE value (defaults to "GREGORIAN").
    #[must_use]
    pub fn calscale(&self) -> &str {
        self.root
            .get_property("CALSCALE")
            .and_then(|p| p.as_text())
            .unwrap_or("GREGORIAN")
    }

    /// Adds a VEVENT component.
    pub fn add_event(&mut self, event: Component) {
        self.root.add_child(event);
    }

    /// Adds a VTODO component.
    pub fn add_todo(&mut self, todo: Component) {
        self.root.add_child(todo);
    }

    /// Adds a VTIMEZONE component.
    pub fn add_timezone(&mut self, tz: Component) {
        self.root.add_child(tz);
    }

    /// Returns all VEVENT components.
    #[must_use]
    pub fn events(&self) -> Vec<&Component> {
        self.root.events()
    }

    /// Returns all VTODO components.
    #[must_use]
    pub fn todos(&self) -> Vec<&Component> {
        self.root.todos()
    }

    /// Returns all VTIMEZONE components.
    #[must_use]
    pub fn timezones(&self) -> Vec<&Component> {
        self.root.timezones()
    }

    /// Returns all VJOURNAL components.
    #[must_use]
    pub fn journals(&self) -> Vec<&Component> {
        self.root.journals()
    }

    /// Returns all VFREEBUSY components.
    #[must_use]
    pub fn freebusy(&self) -> Vec<&Component> {
        self.root.freebusy()
    }

    /// Returns all unique UIDs in this calendar.
    #[must_use]
    pub fn uids(&self) -> Vec<&str> {
        let mut uids: Vec<&str> = self.root.children.iter().filter_map(|c| c.uid()).collect();
        uids.sort_unstable();
        uids.dedup();
        uids
    }
}

impl Default for ICalendar {
    fn default() -> Self {
        Self::new("-//Shuriken//Shuriken CalDAV Server//EN")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn component_kind_parse() {
        assert_eq!(ComponentKind::parse("VEVENT"), ComponentKind::Event);
        assert_eq!(ComponentKind::parse("vtodo"), ComponentKind::Todo);
        assert_eq!(ComponentKind::parse("X-CUSTOM"), ComponentKind::Unknown);
    }

    #[test]
    fn icalendar_new() {
        let ical = ICalendar::new("-//Test//Test//EN");
        assert_eq!(ical.version(), Some("2.0"));
        assert_eq!(ical.prodid(), Some("-//Test//Test//EN"));
        assert_eq!(ical.calscale(), "GREGORIAN");
    }

    #[test]
    fn component_properties() {
        let mut event = Component::event();
        event.add_property(Property::text("UID", "test-uid-123"));
        event.add_property(Property::text("SUMMARY", "Test Event"));

        assert_eq!(event.uid(), Some("test-uid-123"));
        assert_eq!(event.summary(), Some("Test Event"));
    }

    #[test]
    fn icalendar_events() {
        let mut ical = ICalendar::default();

        let mut event1 = Component::event();
        event1.add_property(Property::text("UID", "event1"));
        ical.add_event(event1);

        let mut event2 = Component::event();
        event2.add_property(Property::text("UID", "event2"));
        ical.add_event(event2);

        assert_eq!(ical.events().len(), 2);
        assert_eq!(ical.uids(), vec!["event1", "event2"]);
    }
}
