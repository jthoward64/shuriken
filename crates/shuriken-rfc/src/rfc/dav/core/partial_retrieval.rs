//! Partial retrieval data structures for calendar-data and address-data.
//!
//! RFC 4791 §9.6 (calendar-data) and RFC 6352 §10.4 (address-data).

/// Component selection for calendar-data partial retrieval.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ComponentSelection {
    /// Component name (e.g., "VEVENT", "VTODO").
    pub name: String,
    /// Properties to include within this component.
    pub props: Vec<String>,
    /// Nested sub-components.
    pub comps: Vec<ComponentSelection>,
}

impl ComponentSelection {
    /// Creates a new component selection.
    #[must_use]
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            props: Vec::new(),
            comps: Vec::new(),
        }
    }

    /// Adds a property to include.
    #[must_use]
    pub fn with_prop(mut self, prop: impl Into<String>) -> Self {
        self.props.push(prop.into());
        self
    }

    /// Adds a nested component.
    #[must_use]
    pub fn with_comp(mut self, comp: ComponentSelection) -> Self {
        self.comps.push(comp);
        self
    }
}

/// Calendar-data with optional partial retrieval specification.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CalendarDataRequest {
    /// Content-type for the data (e.g., "text/calendar").
    pub content_type: Option<String>,
    /// Version (e.g., "2.0").
    pub version: Option<String>,
    /// Component selection for partial retrieval.
    pub selection: Option<ComponentSelection>,
}

impl CalendarDataRequest {
    /// Creates a request for full calendar data (no partial retrieval).
    #[must_use]
    pub fn full() -> Self {
        Self {
            content_type: None,
            version: None,
            selection: None,
        }
    }

    /// Creates a request with component selection.
    #[must_use]
    pub fn with_selection(selection: ComponentSelection) -> Self {
        Self {
            content_type: None,
            version: None,
            selection: Some(selection),
        }
    }
}

/// Address-data with optional partial retrieval specification.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct AddressDataRequest {
    /// Content-type for the data (e.g., "text/vcard").
    pub content_type: Option<String>,
    /// Version (e.g., "3.0", "4.0").
    pub version: Option<String>,
    /// Properties to include for partial retrieval.
    pub props: Vec<String>,
}

impl AddressDataRequest {
    /// Creates a request for full address data (no partial retrieval).
    #[must_use]
    pub fn full() -> Self {
        Self {
            content_type: None,
            version: None,
            props: Vec::new(),
        }
    }

    /// Creates a request with property selection.
    #[must_use]
    pub fn with_props(props: Vec<String>) -> Self {
        Self {
            content_type: None,
            version: None,
            props,
        }
    }
}
