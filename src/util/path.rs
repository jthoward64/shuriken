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

/// ## Summary
/// Extracts the path component from a URL or URI string.
///
/// Handles both full URLs (e.g., `http://host/path`) and relative paths.
/// The Destination header in WebDAV COPY/MOVE operations contains full URLs,
/// this function extracts just the path portion.
///
/// ## Errors
/// Returns an error if the URL format is invalid.
pub fn extract_path_from_url(url_or_path: &str) -> anyhow::Result<String> {
    // If it doesn't contain "://", treat it as a path
    if !url_or_path.contains("://") {
        return Ok(url_or_path.to_string());
    }

    // Extract path from full URL
    // Format: scheme://host[:port]/path
    let path = url_or_path
        .split_once("://")
        .and_then(|(_, rest)| {
            // Find the first '/' after the host[:port]
            rest.split_once('/').map(|(_, path)| format!("/{path}"))
        })
        .unwrap_or_else(|| "/".to_string()); // Default to "/" if no path component

    Ok(path)
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

    #[test]
    fn test_extract_path_from_url_full_url() {
        let url = "http://example.com/path/to/resource.ics";
        let path = extract_path_from_url(url).expect("Should extract path");
        assert_eq!(path, "/path/to/resource.ics");
    }

    #[test]
    fn test_extract_path_from_url_with_port() {
        let url = "http://example.com:8080/caldav/collection/event.ics";
        let path = extract_path_from_url(url).expect("Should extract path");
        assert_eq!(path, "/caldav/collection/event.ics");
    }

    #[test]
    fn test_extract_path_from_url_relative_path() {
        let path = "/caldav/collection/event.ics";
        let result = extract_path_from_url(path).expect("Should return path as-is");
        assert_eq!(result, path);
    }

    #[test]
    fn test_extract_path_from_url_https() {
        let url = "https://example.com/path";
        let path = extract_path_from_url(url).expect("Should extract path");
        assert_eq!(path, "/path");
    }

    #[test]
    fn test_extract_path_from_url_no_path() {
        let url = "http://example.com";
        let path = extract_path_from_url(url).expect("Should return /");
        assert_eq!(path, "/");
    }

    #[test]
    fn test_extract_path_from_url_no_path_with_port() {
        let url = "http://example.com:8080";
        let path = extract_path_from_url(url).expect("Should return /");
        assert_eq!(path, "/");
    }
}
