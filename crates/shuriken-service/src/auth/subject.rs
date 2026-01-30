//! Subject types for authorization.
//!
//! A subject represents a principal (user, group) or special pseudo-principals.
//! The authorization system expands a user subject to include all their group
//! memberships plus special pseudo-principals (authenticated, unauthenticated, all).

use shuriken_db::model::user;

/// A subject for authorization checks.
///
/// In Casbin terms, this is the `sub` parameter in enforcement requests.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Subject {
    /// A principal identified by its UUID (user or group).
    Principal(uuid::Uuid),
    /// The unauthenticated pseudo-principal (RFC 3744 §5.5.1) - for anonymous access only.
    Unauthenticated,
    /// The authenticated pseudo-principal (RFC 3744 §5.5.1) - for any authenticated user.
    Authenticated,
    /// The all pseudo-principal (RFC 3744 §5.5.1) - for everyone (authenticated + unauthenticated).
    All,
}

impl Subject {
    /// Create a subject from a user.
    #[must_use]
    pub fn from_user(user: &user::User) -> Self {
        Self::Principal(user.principal_id)
    }

    /// Create a subject from a principal UUID.
    #[must_use]
    pub const fn from_principal_id(id: uuid::Uuid) -> Self {
        Self::Principal(id)
    }

    /// Returns the Casbin subject string.
    #[must_use]
    pub fn casbin_subject(self) -> String {
        match self {
            Self::Principal(id) => format!("principal:{id}"),
            Self::Unauthenticated => "unauthenticated".to_string(),
            Self::Authenticated => "authenticated".to_string(),
            Self::All => "all".to_string(),
        }
    }

    /// Parse a Casbin subject string.
    #[must_use]
    pub fn from_casbin_subject(s: &str) -> Option<Self> {
        match s {
            "unauthenticated" => Some(Self::Unauthenticated),
            "authenticated" => Some(Self::Authenticated),
            "all" => Some(Self::All),
            _ => {
                let id_str = s.strip_prefix("principal:")?;
                let id = uuid::Uuid::parse_str(id_str).ok()?;
                Some(Self::Principal(id))
            }
        }
    }
}

impl std::fmt::Display for Subject {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.casbin_subject())
    }
}

/// An expanded set of subjects for authorization.
///
/// When authorizing an authenticated user, we check permissions for:
/// - The user's principal
/// - All groups the user belongs to
/// - The `authenticated` pseudo-principal (any logged-in user)
/// - The `all` pseudo-principal (everyone)
///
/// When authorizing an unauthenticated user, we check permissions for:
/// - The `unauthenticated` pseudo-principal (anonymous only)
/// - The `all` pseudo-principal (everyone)
///
/// Access is granted if ANY of these subjects has the required permission.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExpandedSubjects {
    subjects: Vec<Subject>,
}

impl ExpandedSubjects {
    /// Create an expanded subject set from a user and their group memberships.
    ///
    /// ## Arguments
    ///
    /// - `user_principal_id`: The user's principal UUID.
    /// - `group_principal_ids`: Iterator of group principal UUIDs the user belongs to.
    #[must_use]
    pub fn new(
        user_principal_id: uuid::Uuid,
        group_principal_ids: impl IntoIterator<Item = uuid::Uuid>,
    ) -> Self {
        let mut subjects = Vec::new();

        // Add the user's principal
        subjects.push(Subject::Principal(user_principal_id));

        // Add all group principals
        for group_id in group_principal_ids {
            subjects.push(Subject::Principal(group_id));
        }

        // Include authenticated and all pseudo-principals for authenticated users
        subjects.push(Subject::Authenticated);
        subjects.push(Subject::All);

        Self { subjects }
    }

    /// Create an expanded subject set for unauthenticated/anonymous access only.
    ///
    /// Includes both `unauthenticated` (anonymous only) and `all` (everyone) pseudo-principals.
    #[must_use]
    pub fn unauthenticated_only() -> Self {
        Self {
            subjects: vec![Subject::Unauthenticated, Subject::All],
        }
    }

    /// Create an expanded subject set from a user model.
    ///
    /// This is a convenience method that creates a set with just the user,
    /// `authenticated`, and `all`. Use `new()` if you need to include group memberships.
    #[must_use]
    pub fn from_user(user: &user::User) -> Self {
        Self::new(user.principal_id, std::iter::empty())
    }

    /// Create an expanded subject set from a user with group memberships.
    #[must_use]
    pub fn from_user_with_groups(
        user: &user::User,
        group_principal_ids: impl IntoIterator<Item = uuid::Uuid>,
    ) -> Self {
        Self::new(user.principal_id, group_principal_ids)
    }

    /// Returns an iterator over all subjects.
    pub fn iter(&self) -> impl Iterator<Item = &Subject> {
        self.subjects.iter()
    }

    /// Returns all Casbin subject strings.
    #[must_use]
    pub fn casbin_subjects(&self) -> Vec<String> {
        self.subjects.iter().map(|s| s.casbin_subject()).collect()
    }

    /// Returns `true` if this set contains the given subject.
    #[must_use]
    pub fn contains(&self, subject: &Subject) -> bool {
        self.subjects.contains(subject)
    }

    /// Returns the number of subjects in this set.
    #[must_use]
    pub fn len(&self) -> usize {
        self.subjects.len()
    }

    /// Returns `true` if this set is empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.subjects.is_empty()
    }
}

impl<'a> IntoIterator for &'a ExpandedSubjects {
    type Item = &'a Subject;
    type IntoIter = std::slice::Iter<'a, Subject>;

    fn into_iter(self) -> Self::IntoIter {
        self.subjects.iter()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subject_casbin_roundtrip() {
        let id = uuid::Uuid::now_v7();
        let subjects = [Subject::Principal(id), Subject::Unauthenticated];

        for subject in subjects {
            let casbin_str = subject.casbin_subject();
            let parsed = Subject::from_casbin_subject(&casbin_str);
            assert_eq!(Some(subject), parsed, "Roundtrip failed for {subject:?}");
        }
    }

    #[test]
    fn expanded_subjects_contains_user_authenticated_and_all() {
        let user_id = uuid::Uuid::now_v7();
        let expanded = ExpandedSubjects::new(user_id, std::iter::empty());

        assert!(expanded.contains(&Subject::Principal(user_id)));
        assert!(expanded.contains(&Subject::Authenticated));
        assert!(expanded.contains(&Subject::All));
        assert_eq!(expanded.len(), 3);
    }

    #[test]
    fn expanded_subjects_with_groups() {
        let user_id = uuid::Uuid::now_v7();
        let group1_id = uuid::Uuid::now_v7();
        let group2_id = uuid::Uuid::now_v7();

        let expanded = ExpandedSubjects::new(user_id, [group1_id, group2_id]);

        assert!(expanded.contains(&Subject::Principal(user_id)));
        assert!(expanded.contains(&Subject::Principal(group1_id)));
        assert!(expanded.contains(&Subject::Principal(group2_id)));
        assert!(expanded.contains(&Subject::Authenticated));
        assert!(expanded.contains(&Subject::All));
        assert_eq!(expanded.len(), 5);
    }
}
