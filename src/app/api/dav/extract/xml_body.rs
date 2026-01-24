use salvo::Request;

/// ## Summary
/// Reads the request body as raw bytes for DAV XML parsing.
///
/// Phase 1 will replace this with typed DAV XML parsing.
///
/// ## Errors
/// Returns an error if the body cannot be read.
pub async fn read_xml_bytes(req: &mut Request) -> anyhow::Result<Vec<u8>> {
    let bytes = req.payload().await?;
    Ok(bytes.to_vec())
}
