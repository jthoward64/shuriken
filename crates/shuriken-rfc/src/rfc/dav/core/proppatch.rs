//! PROPPATCH request types.

use super::namespace::QName;
use super::property::DavProperty;

/// A PROPPATCH request.
#[derive(Debug, Clone)]
pub struct ProppatchRequest {
    /// Property updates in order.
    pub updates: Vec<PropertyUpdate>,
}

impl ProppatchRequest {
    /// Creates an empty PROPPATCH request.
    #[must_use]
    pub fn new() -> Self {
        Self {
            updates: Vec::new(),
        }
    }

    /// Adds a set operation.
    pub fn set(&mut self, prop: DavProperty) {
        self.updates.push(PropertyUpdate {
            operation: SetOrRemove::Set,
            property: prop,
        });
    }

    /// Adds a remove operation.
    pub fn remove(&mut self, name: QName) {
        self.updates.push(PropertyUpdate {
            operation: SetOrRemove::Remove,
            property: DavProperty::not_found(name),
        });
    }

    /// Returns all set operations.
    #[must_use]
    pub fn sets(&self) -> Vec<&DavProperty> {
        self.updates
            .iter()
            .filter(|u| u.operation == SetOrRemove::Set)
            .map(|u| &u.property)
            .collect()
    }

    /// Returns all remove operations.
    #[must_use]
    pub fn removes(&self) -> Vec<&QName> {
        self.updates
            .iter()
            .filter(|u| u.operation == SetOrRemove::Remove)
            .map(|u| &u.property.name)
            .collect()
    }
}

impl Default for ProppatchRequest {
    fn default() -> Self {
        Self::new()
    }
}

/// A single property update operation.
#[derive(Debug, Clone)]
pub struct PropertyUpdate {
    /// Whether to set or remove the property.
    pub operation: SetOrRemove,
    /// The property to set/remove.
    pub property: DavProperty,
}

/// Set or remove operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SetOrRemove {
    /// Set the property value.
    Set,
    /// Remove the property.
    Remove,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proppatch_set() {
        let mut req = ProppatchRequest::new();
        req.set(DavProperty::text(QName::dav("displayname"), "New Name"));

        assert_eq!(req.sets().len(), 1);
        assert_eq!(req.removes().len(), 0);
    }

    #[test]
    fn proppatch_remove() {
        let mut req = ProppatchRequest::new();
        req.remove(QName::caldav("calendar-description"));

        assert_eq!(req.sets().len(), 0);
        assert_eq!(req.removes().len(), 1);
    }

    #[test]
    fn proppatch_mixed() {
        let mut req = ProppatchRequest::new();
        req.set(DavProperty::text(QName::dav("displayname"), "New Name"));
        req.remove(QName::caldav("calendar-description"));
        req.set(DavProperty::text(
            QName::caldav("calendar-timezone"),
            "BEGIN:VTIMEZONE...",
        ));

        assert_eq!(req.sets().len(), 2);
        assert_eq!(req.removes().len(), 1);
    }
}
