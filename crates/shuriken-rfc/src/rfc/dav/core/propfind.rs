//! PROPFIND request types.

use super::property::PropertyName;

/// A PROPFIND request.
#[derive(Debug, Clone)]
pub struct PropfindRequest {
    /// The type of PROPFIND.
    pub propfind_type: PropfindType,
}

impl PropfindRequest {
    /// Creates an allprop request.
    #[must_use]
    pub fn allprop() -> Self {
        Self {
            propfind_type: PropfindType::AllProp {
                include: Vec::new(),
            },
        }
    }

    /// Creates an allprop request with include.
    #[must_use]
    pub fn allprop_with_include(include: Vec<PropertyName>) -> Self {
        Self {
            propfind_type: PropfindType::AllProp { include },
        }
    }

    /// Creates a propname request.
    #[must_use]
    pub fn propname() -> Self {
        Self {
            propfind_type: PropfindType::PropName,
        }
    }

    /// Creates a prop request.
    #[must_use]
    pub fn prop(properties: Vec<PropertyName>) -> Self {
        Self {
            propfind_type: PropfindType::Prop(properties),
        }
    }

    /// Returns whether this is an allprop request.
    #[must_use]
    pub fn is_allprop(&self) -> bool {
        matches!(self.propfind_type, PropfindType::AllProp { .. })
    }

    /// Returns whether this is a propname request.
    #[must_use]
    pub fn is_propname(&self) -> bool {
        matches!(self.propfind_type, PropfindType::PropName)
    }

    /// Returns the requested properties for a prop request.
    #[must_use]
    pub fn requested_properties(&self) -> Option<&[PropertyName]> {
        match &self.propfind_type {
            PropfindType::Prop(props) => Some(props),
            _ => None,
        }
    }
}

impl Default for PropfindRequest {
    fn default() -> Self {
        Self::allprop()
    }
}

/// The type of PROPFIND request.
#[derive(Debug, Clone)]
pub enum PropfindType {
    /// Request all defined properties.
    AllProp {
        /// Additional properties to include.
        include: Vec<PropertyName>,
    },
    /// Request only property names (no values).
    PropName,
    /// Request specific properties.
    Prop(Vec<PropertyName>),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rfc::dav::core::QName;

    #[test]
    fn propfind_allprop() {
        let req = PropfindRequest::allprop();
        assert!(req.is_allprop());
        assert!(!req.is_propname());
    }

    #[test]
    fn propfind_propname() {
        let req = PropfindRequest::propname();
        assert!(req.is_propname());
    }

    #[test]
    fn propfind_prop() {
        let req = PropfindRequest::prop(vec![
            PropertyName::new(QName::dav("displayname")),
            PropertyName::new(QName::dav("resourcetype")),
        ]);
        let props = req.requested_properties().unwrap();
        assert_eq!(props.len(), 2);
    }
}
