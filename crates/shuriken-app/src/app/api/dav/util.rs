use salvo::{Depot, Request};

use crate::config::get_config_from_depot;
use shuriken_service::auth::{
    ExpandedSubjects, PathSegment, ResourceLocation, ResourceType, Subject,
};

/// ## Summary
/// Returns the request origin, preferring the `Host` header and falling back to server config.
#[must_use]
pub fn request_origin(req: &Request, depot: &Depot) -> String {
    let scheme = if req.uri().scheme_str() == Some("https") {
        "https"
    } else {
        "http"
    };

    if let Some(host) = req
        .headers()
        .get("Host")
        .and_then(|h| h.to_str().ok())
        .filter(|h| !h.is_empty())
    {
        return format!("{scheme}://{host}");
    }

    match get_config_from_depot(depot) {
        Ok(settings) => settings.server.origin(),
        Err(e) => {
            tracing::warn!(error = %e, "Configuration missing; falling back to localhost origin");
            format!("{scheme}://localhost")
        }
    }
}

/// ## Summary
/// Builds a full URL for a resource, using a serialized `ResourceLocation` when possible.
#[must_use]
pub fn build_full_url(
    req: &Request,
    depot: &Depot,
    resource: Option<&ResourceLocation>,
    fallback_path: &str,
) -> String {
    let origin = request_origin(req, depot);
    let path = resource
        .and_then(|loc| loc.serialize_to_full_path(false, false).ok())
        .unwrap_or_else(|| fallback_path.to_string());

    format!("{}{}", origin.trim_end_matches('/'), path)
}

/// ## Summary
/// Extracts the resource type from a parsed `ResourceLocation`.
#[must_use]
pub fn resource_type_from_location(resource: &ResourceLocation) -> Option<ResourceType> {
    resource.segments().iter().find_map(|segment| {
        if let PathSegment::ResourceType(resource_type) = segment {
            Some(*resource_type)
        } else {
            None
        }
    })
}

/// ## Summary
/// Extracts the owner principal ID from authenticated subjects.
///
/// ## Errors
/// Returns an error if no principal subject is found.
pub fn owner_principal_id_from_subjects(subjects: &ExpandedSubjects) -> anyhow::Result<uuid::Uuid> {
    for subject in subjects.iter() {
        if let Subject::Principal(id) = subject {
            return Ok(*id);
        }
    }

    anyhow::bail!("No authenticated principal found in subjects")
}
