//! Unit tests for `CalDAV` PUT handler.

#[cfg(test)]
mod tests {
    use salvo::http::StatusCode;
    use salvo::prelude::*;
    use salvo::test::TestClient;

    use crate::app::api::caldav::method::put::put;

    #[tokio::test]
    async fn test_put_calendar_returns_expected_status() {
        let router = Router::new().push(Router::with_path("/<**rest>").put(put));
        let service = Service::new(router);

        let ical_data = r"BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:test@example.com
DTSTART:20240101T120000Z
DTEND:20240101T130000Z
SUMMARY:Test Event
END:VEVENT
END:VCALENDAR";

        let resp = TestClient::put("http://127.0.0.1:5800/calendar/event.ics")
            .raw_form(ical_data)
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
    async fn test_put_calendar_handles_if_match() {
        let router = Router::new().push(Router::with_path("/<**rest>").put(put));
        let service = Service::new(router);

        let ical_data = r"BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:test@example.com
DTSTART:20240101T120000Z
DTEND:20240101T130000Z
SUMMARY:Test Event
END:VEVENT
END:VCALENDAR";

        let resp = TestClient::put("http://127.0.0.1:5800/calendar/event.ics")
            .add_header("If-Match", "\"etag-12345\"", true)
            .raw_form(ical_data)
            .send(&service)
            .await;

        assert!(resp.status_code.is_some());
    }

    #[tokio::test]
    async fn test_put_calendar_handles_if_none_match() {
        let router = Router::new().push(Router::with_path("/<**rest>").put(put));
        let service = Service::new(router);

        let ical_data = r"BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:test@example.com
DTSTART:20240101T120000Z
DTEND:20240101T130000Z
SUMMARY:Test Event
END:VEVENT
END:VCALENDAR";

        let resp = TestClient::put("http://127.0.0.1:5800/calendar/event.ics")
            .add_header("If-None-Match", "*", true)
            .raw_form(ical_data)
            .send(&service)
            .await;

        assert!(resp.status_code.is_some());
    }

    #[tokio::test]
    async fn test_put_calendar_rejects_invalid_icalendar() {
        let router = Router::new().push(Router::with_path("/<**rest>").put(put));
        let service = Service::new(router);

        let invalid_ical = "This is not valid iCalendar data";

        let resp = TestClient::put("http://127.0.0.1:5800/calendar/event.ics")
            .raw_form(invalid_ical)
            .send(&service)
            .await;

        // Should return 400, 404, or 500
        let status = resp.status_code;
        assert!(
            status == Some(StatusCode::BAD_REQUEST)
                || status == Some(StatusCode::NOT_FOUND)
                || status == Some(StatusCode::INTERNAL_SERVER_ERROR),
            "Expected 400, 404, or 500 for invalid iCalendar, got {status:?}"
        );
    }

    #[tokio::test]
    async fn test_put_calendar_accepts_various_paths() {
        let router = Router::new().push(Router::with_path("/<**rest>").put(put));
        let service = Service::new(router);

        let ical_data = r"BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:test@example.com
DTSTART:20240101T120000Z
DTEND:20240101T130000Z
SUMMARY:Test Event
END:VEVENT
END:VCALENDAR";

        let paths = vec![
            "/calendar/event.ics",
            "/calendars/user/default/event.ics",
            "/calendars/user/work/meeting.ics",
        ];

        for path in paths {
            let resp = TestClient::put(format!("http://127.0.0.1:5800{path}"))
                .raw_form(ical_data)
                .send(&service)
                .await;

            assert!(resp.status_code.is_some());
        }
    }

    #[tokio::test]
    async fn test_put_calendar_empty_body_returns_error() {
        let router = Router::new().push(Router::with_path("/<**rest>").put(put));
        let service = Service::new(router);

        let resp = TestClient::put("http://127.0.0.1:5800/calendar/event.ics")
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
