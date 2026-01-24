use crate::component::model::user;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Subject {
    Principal(uuid::Uuid),
    Public,
}

impl Subject {
    #[must_use]
    pub fn from_user(user: &user::User) -> Self {
        Self::Principal(user.principal_id)
    }

    #[must_use]
    pub fn casbin_subject(self) -> String {
        match self {
            Self::Principal(id) => format!("principal:{id}"),
            Self::Public => "public".to_string(),
        }
    }
}
