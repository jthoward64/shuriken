//! Path parsing utilities for extracting collection and resource information from request paths.

/// ## Summary
/// Extracts collection ID and resource URI from a CalDAV/CardDAV request path.
///
/// ## Path Format
/// Expected formats:
/// - `/caldav/{collection_id}/{resource}.ics`
/// - `/carddav/{collection_id}/{resource}.vcf`
/// - `/api/caldav/{collection_id}/{resource}.ics`
///
/// ## Errors
/// Returns an error if the path format is invalid or `collection_id` cannot be parsed as UUID.
pub fn parse_collection_and_uri(path: &str) -> anyhow::Result<(uuid::Uuid, String)> {
    let parts: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

    // We need at least 2 parts: collection_id and resource name
    if parts.len() < 2 {
        return Err(anyhow::anyhow!(
            "Path must contain at least collection_id and resource name: {path}"
        ));
    }

    // Try to find the collection_id (should be a UUID)
    // Typically it's the second-to-last or third-to-last segment
    let resource_uri = parts[parts.len() - 1];

    // Search backwards for a UUID
    for i in (0..parts.len() - 1).rev() {
        if let Ok(collection_id) = uuid::Uuid::parse_str(parts[i]) {
            return Ok((collection_id, resource_uri.to_string()));
        }
    }

    Err(anyhow::anyhow!(
        "Could not find valid UUID collection_id in path: {path}"
    ))
}

/// ## Summary
/// Extracts just the resource URI (filename) from a request path.
///
/// ## Errors
/// Returns an error if the path is empty or has no resource component.
pub fn extract_resource_uri(path: &str) -> anyhow::Result<String> {
    path.rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .map(String::from)
        .ok_or_else(|| anyhow::anyhow!("Could not extract resource URI from path: {path}"))
}

/// ## Summary
/// Extracts collection ID from request path.
///
/// Searches for a UUID in the path segments.
///
/// ## Errors
/// Returns an error if no valid UUID is found in the path.
pub fn extract_collection_id(path: &str) -> anyhow::Result<uuid::Uuid> {
    let parts: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

    // Search for a UUID in the path segments
    for part in parts {
        if let Ok(collection_id) = uuid::Uuid::parse_str(part) {
            return Ok(collection_id);
        }
    }

    Err(anyhow::anyhow!(
        "Could not find valid UUID collection_id in path: {path}"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_collection_and_uri_simple() {
        let collection_id = uuid::Uuid::new_v4();
        let path = format!("/caldav/{collection_id}/event.ics");

        let (parsed_id, uri) = parse_collection_and_uri(&path).expect("Should parse");
        assert_eq!(parsed_id, collection_id);
        assert_eq!(uri, "event.ics");
    }

    #[test]
    fn test_parse_collection_and_uri_with_api_prefix() {
        let collection_id = uuid::Uuid::new_v4();
        let path = format!("/api/caldav/{collection_id}/event.ics");

        let (parsed_id, uri) = parse_collection_and_uri(&path).expect("Should parse");
        assert_eq!(parsed_id, collection_id);
        assert_eq!(uri, "event.ics");
    }

    #[test]
    fn test_parse_collection_and_uri_carddav() {
        let collection_id = uuid::Uuid::new_v4();
        let path = format!("/carddav/{collection_id}/contact.vcf");

        let (parsed_id, uri) = parse_collection_and_uri(&path).expect("Should parse");
        assert_eq!(parsed_id, collection_id);
        assert_eq!(uri, "contact.vcf");
    }

    #[test]
    fn test_parse_collection_and_uri_invalid() {
        let result = parse_collection_and_uri("/no/uuid/here.ics");
        assert!(result.is_err());
    }

    #[test]
    fn test_extract_resource_uri() {
        let uri = extract_resource_uri("/path/to/event.ics").expect("Should extract");
        assert_eq!(uri, "event.ics");
    }

    #[test]
    fn test_extract_collection_id() {
        let collection_id = uuid::Uuid::new_v4();
        let path = format!("/api/caldav/{collection_id}/event.ics");

        let parsed_id = extract_collection_id(&path).expect("Should extract");
        assert_eq!(parsed_id, collection_id);
    }
}
