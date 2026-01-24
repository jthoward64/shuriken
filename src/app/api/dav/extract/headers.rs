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
