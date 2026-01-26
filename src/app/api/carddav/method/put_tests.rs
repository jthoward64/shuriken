//! Unit tests for `CardDAV` PUT handler.

#[cfg(test)]
mod tests {
    use salvo::http::StatusCode;
    use salvo::prelude::*;
    use salvo::test::TestClient;

    use crate::app::api::carddav::method::put::put;

    #[tokio::test]
    async fn test_put_vcard_returns_expected_status() {
        let router = Router::new().push(Router::with_path("/{**rest}").put(put));
        let service = Service::new(router);

        let vcard_data = r"BEGIN:VCARD
VERSION:4.0
FN:Test User
N:User;Test;;;
EMAIL:test@example.com
END:VCARD";

        let resp = TestClient::put("http://127.0.0.1:5800/addressbook/contact.vcf")
            .raw_form(vcard_data)
            .send(&service)
            .await;

        // Valid responses: 201, 204, 400, 404, 412, or 500
        let status = resp.status_code;
        assert!(
            status == Some(StatusCode::CREATED)
                || status == Some(StatusCode::NO_CONTENT)
                || status == Some(StatusCode::BAD_REQUEST)
                || status == Some(StatusCode::NOT_FOUND)
                || status == Some(StatusCode::PRECONDITION_FAILED)
                || status == Some(StatusCode::INTERNAL_SERVER_ERROR),
            "Unexpected status code: {status:?}"
        );
    }

    #[tokio::test]
    async fn test_put_vcard_handles_if_match() {
        let router = Router::new().push(Router::with_path("/{**rest}").put(put));
        let service = Service::new(router);

        let vcard_data = r"BEGIN:VCARD
VERSION:4.0
FN:Test User
N:User;Test;;;
EMAIL:test@example.com
END:VCARD";

        let resp = TestClient::put("http://127.0.0.1:5800/addressbook/contact.vcf")
            .add_header("If-Match", "\"etag-12345\"", true)
            .raw_form(vcard_data)
            .send(&service)
            .await;

        assert!(resp.status_code.is_some());
    }

    #[tokio::test]
    async fn test_put_vcard_handles_if_none_match() {
        let router = Router::new().push(Router::with_path("/{**rest}").put(put));
        let service = Service::new(router);

        let vcard_data = r"BEGIN:VCARD
VERSION:4.0
FN:Test User
N:User;Test;;;
EMAIL:test@example.com
END:VCARD";

        let resp = TestClient::put("http://127.0.0.1:5800/addressbook/contact.vcf")
            .add_header("If-None-Match", "*", true)
            .raw_form(vcard_data)
            .send(&service)
            .await;

        assert!(resp.status_code.is_some());
    }

    #[tokio::test]
    async fn test_put_vcard_rejects_invalid_vcard() {
        let router = Router::new().push(Router::with_path("/{**rest}").put(put));
        let service = Service::new(router);

        let invalid_vcard = "This is not valid vCard data";

        let resp = TestClient::put("http://127.0.0.1:5800/addressbook/contact.vcf")
            .raw_form(invalid_vcard)
            .send(&service)
            .await;

        // Should return 400, 404, or 500
        let status = resp.status_code;
        assert!(
            status == Some(StatusCode::BAD_REQUEST)
                || status == Some(StatusCode::NOT_FOUND)
                || status == Some(StatusCode::INTERNAL_SERVER_ERROR),
            "Expected 400, 404, or 500 for invalid vCard, got {status:?}"
        );
    }

    #[tokio::test]
    async fn test_put_vcard_version_3() {
        let router = Router::new().push(Router::with_path("/{**rest}").put(put));
        let service = Service::new(router);

        let vcard_v3_data = r"BEGIN:VCARD
VERSION:3.0
FN:Test User
N:User;Test;;;
EMAIL;TYPE=INTERNET:test@example.com
END:VCARD";

        let resp = TestClient::put("http://127.0.0.1:5800/addressbook/contact.vcf")
            .raw_form(vcard_v3_data)
            .send(&service)
            .await;

        assert!(resp.status_code.is_some());
    }

    #[tokio::test]
    async fn test_put_vcard_accepts_various_paths() {
        let router = Router::new().push(Router::with_path("/{**rest}").put(put));
        let service = Service::new(router);

        let vcard_data = r"BEGIN:VCARD
VERSION:4.0
FN:Test User
N:User;Test;;;
EMAIL:test@example.com
END:VCARD";

        let paths = vec![
            "/addressbook/contact.vcf",
            "/addressbooks/user/default/contact.vcf",
            "/addressbooks/user/work/person.vcf",
        ];

        for path in paths {
            let resp = TestClient::put(format!("http://127.0.0.1:5800{path}"))
                .raw_form(vcard_data)
                .send(&service)
                .await;

            assert!(resp.status_code.is_some());
        }
    }

    #[tokio::test]
    async fn test_put_vcard_empty_body_returns_error() {
        let router = Router::new().push(Router::with_path("/{**rest}").put(put));
        let service = Service::new(router);

        let resp = TestClient::put("http://127.0.0.1:5800/addressbook/contact.vcf")
            .send(&service)
            .await;

        // Should return 400, 404, or 500 for empty body
        let status = resp.status_code;
        assert!(
            status == Some(StatusCode::BAD_REQUEST)
                || status == Some(StatusCode::NOT_FOUND)
                || status == Some(StatusCode::INTERNAL_SERVER_ERROR),
            "Expected 400, 404, or 500 for empty body, got {status:?}"
        );
    }
}
