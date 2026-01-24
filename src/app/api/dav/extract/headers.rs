#![allow(dead_code)]
use salvo::Request;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Depth {
    Zero,
    One,
    Infinity,
}

impl Depth {
    #[must_use]
    pub fn default_for_propfind() -> Self {
        Self::Zero
    }
}

/// ## Summary
/// Parses the `WebDAV` `Depth` header.
///
/// ## Errors
/// Returns `None` if the header is missing or malformed.
#[must_use]
pub fn parse_depth(req: &Request) -> Option<Depth> {
    let value = req.headers().get("Depth")?.to_str().ok()?;

    match value.trim() {
        "0" => Some(Depth::Zero),
        "1" => Some(Depth::One),
        "infinity" | "Infinity" => Some(Depth::Infinity),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use salvo::prelude::*;

    /// ## Summary
    /// Helper to create a request with a Depth header.
    fn request_with_depth(value: &str) -> Request {
        let mut req = Request::default();
        req.headers_mut()
            .insert("Depth", value.parse().unwrap());
        req
    }

    #[test]
    fn depth_zero_parses() {
        let req = request_with_depth("0");
        assert_eq!(parse_depth(&req), Some(Depth::Zero));
    }

    #[test]
    fn depth_one_parses() {
        let req = request_with_depth("1");
        assert_eq!(parse_depth(&req), Some(Depth::One));
    }

    #[test]
    fn depth_infinity_lowercase_parses() {
        let req = request_with_depth("infinity");
        assert_eq!(parse_depth(&req), Some(Depth::Infinity));
    }

    #[test]
    fn depth_infinity_capitalized_parses() {
        let req = request_with_depth("Infinity");
        assert_eq!(parse_depth(&req), Some(Depth::Infinity));
    }

    #[test]
    fn depth_with_whitespace_parses() {
        let req = request_with_depth(" 1 ");
        assert_eq!(parse_depth(&req), Some(Depth::One));
    }

    #[test]
    fn depth_invalid_returns_none() {
        let req = request_with_depth("2");
        assert_eq!(parse_depth(&req), None);
    }

    #[test]
    fn depth_missing_returns_none() {
        let req = Request::default();
        assert_eq!(parse_depth(&req), None);
    }

    #[test]
    fn depth_default_for_propfind() {
        assert_eq!(Depth::default_for_propfind(), Depth::Zero);
    }
}
