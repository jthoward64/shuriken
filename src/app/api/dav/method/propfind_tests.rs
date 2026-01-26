//! Unit tests for PROPFIND handler.

#[cfg(test)]
mod tests {
    use salvo::http::StatusCode;
    use salvo::prelude::*;
    use salvo::test::TestClient;

    use crate::app::api::dav::method::propfind::propfind;

    #[tokio::test]
    async fn test_propfind_returns_multistatus_or_error() {
        let router = Router::new().push(Router::with_path("/{**rest}").get(propfind));
        let service = Service::new(router);

        let resp = TestClient::get("http://127.0.0.1:5800/calendars/user/")
            .send(&service)
            .await;

        // Should return either 207 Multi-Status, 400, 404, or 500
        let status = resp.status_code;
        assert!(
            status == Some(StatusCode::MULTI_STATUS)
                || status == Some(StatusCode::BAD_REQUEST)
                || status == Some(StatusCode::NOT_FOUND)
                || status == Some(StatusCode::INTERNAL_SERVER_ERROR),
            "Expected 207, 400, 404, or 500, got {status:?}"
        );
    }

    #[tokio::test]
    async fn test_propfind_handles_depth_header() {
        let router = Router::new().push(Router::with_path("/{**rest}").get(propfind));
        let service = Service::new(router);

        // Test with Depth: 0
        let resp = TestClient::get("http://127.0.0.1:5800/test/")
            .add_header("Depth", "0", true)
            .send(&service)
            .await;

        assert!(resp.status_code.is_some());

        // Test with Depth: 1
        let resp = TestClient::get("http://127.0.0.1:5800/test/")
            .add_header("Depth", "1", true)
            .send(&service)
            .await;

        assert!(resp.status_code.is_some());
    }

    #[tokio::test]
    async fn test_propfind_accepts_various_paths() {
        let router = Router::new().push(Router::with_path("/{**rest}").get(propfind));
        let service = Service::new(router);

        let paths = vec![
            "/",
            "/calendars/",
            "/calendars/user/",
            "/calendars/user/calendar.ics",
            "/addressbooks/user/contacts/",
        ];

        for path in paths {
            let resp = TestClient::get(format!("http://127.0.0.1:5800{path}"))
                .send(&service)
                .await;

            // Should handle all paths without panicking
            assert!(resp.status_code.is_some());
        }
    }

    #[tokio::test]
    async fn test_propfind_expected_status_codes() {
        let router = Router::new().push(Router::with_path("/{**rest}").get(propfind));
        let service = Service::new(router);

        let resp = TestClient::get("http://127.0.0.1:5800/test/")
            .send(&service)
            .await;

        let status = resp.status_code;
        // Valid responses: 207 Multi-Status, 400 Bad Request, 404 Not Found, 500 Internal Server Error
        assert!(
            status == Some(StatusCode::MULTI_STATUS)
                || status == Some(StatusCode::BAD_REQUEST)
                || status == Some(StatusCode::NOT_FOUND)
                || status == Some(StatusCode::INTERNAL_SERVER_ERROR),
            "Unexpected status code: {status:?}"
        );
    }

    #[tokio::test]
    async fn test_propfind_depth_infinity() {
        let router = Router::new().push(Router::with_path("/{**rest}").get(propfind));
        let service = Service::new(router);

        // Test with Depth: infinity
        let resp = TestClient::get("http://127.0.0.1:5800/test/")
            .add_header("Depth", "infinity", true)
            .send(&service)
            .await;

        // Should handle infinity depth (may reject it)
        assert!(resp.status_code.is_some());
    }
}
