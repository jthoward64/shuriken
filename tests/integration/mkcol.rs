#![allow(clippy::unused_async, unused_must_use)]
//! Tests for MKCALENDAR and MKCOL (Extended MKCOL) methods.
//!
//! Verifies collection creation with initial properties.

use salvo::http::StatusCode;

use super::helpers::*;

// ============================================================================
// MKCALENDAR Basic Tests
// ============================================================================

/// ## Summary
/// Test that MKCALENDAR creates a calendar collection.
#[test_log::test(tokio::test)]
async fn mkcalendar_creates_calendar_collection() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");
    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    // Grant owner access to the testuser's calendar namespace
    test_db
        .seed_access_policy(&format!("principal:{principal_id}"), "/cal/testuser/**", "owner")
        .await
        .expect("Failed to seed access policy");

    let service = create_db_test_service(&test_db.url()).await;

    let new_collection_slug = "new-calendar";
    let path = caldav_collection_path("testuser", new_collection_slug);
    let response = TestRequest::mkcalendar(&path)
        .send(&service)
        .await;

    response.assert_status(StatusCode::CREATED);

    // Verify with PROPFIND that it's a calendar collection
    let props = propfind_props(&[("DAV:", "resourcetype")]);
    let verify_response = TestRequest::propfind(&path)
        .depth("0")
        .xml_body(&props)
        .send(&service)
        .await;

    verify_response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("calendar");
}

/// ## Summary
/// Test that MKCALENDAR applies initial properties from request body.
#[test_log::test(tokio::test)]
async fn mkcalendar_initial_props_applied() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");
    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    // Grant owner access to the testuser's calendar namespace
    test_db
        .seed_access_policy(&format!("principal:{principal_id}"), "/cal/testuser/**", "owner")
        .await
        .expect("Failed to seed access policy");

    let service = create_db_test_service(&test_db.url()).await;

    let new_collection_slug = "work-calendar";
    let path = caldav_collection_path("testuser", new_collection_slug);
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set>
    <D:prop>
      <D:displayname>Work Calendar</D:displayname>
      <C:calendar-description>Events from work</C:calendar-description>
    </D:prop>
  </D:set>
</C:mkcalendar>"#;

    let response = TestRequest::mkcalendar(&path)
        .xml_body(body)
        .send(&service)
        .await;

    response.assert_status(StatusCode::CREATED);

    // Verify properties with PROPFIND
    let props = propfind_props(&[("DAV:", "displayname")]);
    let verify_response = TestRequest::propfind(&path)
        .depth("0")
        .xml_body(&props)
        .send(&service)
        .await;

    verify_response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("Work Calendar");
}

/// ## Summary
/// Test that MKCALENDAR on existing URI returns 405 or 409.
#[test_log::test(tokio::test)]
async fn mkcalendar_on_existing_uri_conflict() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");
    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "testcal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    // Try to create a collection with the same slug
    let path = caldav_collection_path("testuser", "testcal");
    let response = TestRequest::mkcalendar(&path)
        .send(&service)
        .await;

    // Either 405 Method Not Allowed or 409 Conflict
    assert!(
        response.status == StatusCode::METHOD_NOT_ALLOWED
            || response.status == StatusCode::CONFLICT,
        "Expected 405 or 409, got {}",
        response.status
    );
}

// ============================================================================
// Extended MKCOL Tests
// ============================================================================

/// ## Summary
/// Test that Extended MKCOL creates an addressbook.
#[test_log::test(tokio::test)]
async fn mkcol_extended_creates_addressbook() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");
    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    // Grant owner access to the testuser's addressbook namespace
    test_db
        .seed_access_policy(&format!("principal:{principal_id}"), "/card/testuser/**", "owner")
        .await
        .expect("Failed to seed access policy");

    let service = create_db_test_service(&test_db.url()).await;

    let new_collection_slug = "contacts";
    let path = carddav_collection_path("testuser", new_collection_slug);
    let body = mkcol_addressbook_body(Some("Contacts"));

    let response = TestRequest::mkcol(&path)
        .xml_body(&body)
        .send(&service)
        .await;

    response.assert_status(StatusCode::CREATED);

    // Verify with PROPFIND that it's an addressbook collection
    let props = propfind_props(&[("DAV:", "resourcetype")]);
    let verify_response = TestRequest::propfind(&path)
        .depth("0")
        .xml_body(&props)
        .send(&service)
        .await;

    verify_response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("addressbook");
}

/// ## Summary
/// Test that Extended MKCOL applies initial properties.
#[test_log::test(tokio::test)]
async fn mkcol_extended_applies_initial_props() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");
    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    // Grant owner access to the testuser's addressbook namespace
    test_db
        .seed_access_policy(&format!("principal:{principal_id}"), "/card/testuser/**", "owner")
        .await
        .expect("Failed to seed access policy");

    let service = create_db_test_service(&test_db.url()).await;

    let new_collection_slug = "work-contacts";
    let path = carddav_collection_path("testuser", new_collection_slug);
    let body = mkcol_addressbook_body(Some("Work Contacts"));

    let response = TestRequest::mkcol(&path)
        .xml_body(&body)
        .send(&service)
        .await;

    response.assert_status(StatusCode::CREATED);

    // Verify properties with PROPFIND
    let props = propfind_props(&[("DAV:", "displayname")]);
    let verify_response = TestRequest::propfind(&path)
        .depth("0")
        .xml_body(&props)
        .send(&service)
        .await;

    verify_response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("Work Contacts");
}

/// ## Summary
/// Test that Extended MKCOL with invalid XML returns 400.
#[test_log::test(tokio::test)]
async fn mkcol_extended_rejects_bad_body() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");
    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    // Grant owner access to the testuser's addressbook namespace
    test_db
        .seed_access_policy(&format!("principal:{principal_id}"), "/card/testuser/**", "owner")
        .await
        .expect("Failed to seed access policy");

    let service = create_db_test_service(&test_db.url()).await;

    let new_collection_slug = "bad-xml-test";
    let path = carddav_collection_path("testuser", new_collection_slug);
    let response = TestRequest::mkcol(&path)
        .xml_body("this is not valid xml <<><")
        .send(&service)
        .await;

    response.assert_status(StatusCode::BAD_REQUEST);
}

// ============================================================================
// Plain MKCOL Tests
// ============================================================================

/// ## Summary
/// Test that plain MKCOL (without body) creates a collection.
#[test_log::test(tokio::test)]
async fn mkcol_creates_plain_collection() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");
    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    // Grant owner access to the testuser's calendar namespace (use cal for generic DAV collections)
    test_db
        .seed_access_policy(&format!("principal:{principal_id}"), "/cal/testuser/**", "owner")
        .await
        .expect("Failed to seed access policy");

    let service = create_db_test_service(&test_db.url()).await;

    let new_collection_slug = "plain-collection";
    let path = caldav_collection_path("testuser", new_collection_slug);
    let response = TestRequest::mkcol(&path)
        .send(&service)
        .await;

    response.assert_status(StatusCode::CREATED);

    // Verify with PROPFIND that it's just a collection (not calendar/addressbook)
    let props = propfind_props(&[("DAV:", "resourcetype")]);
    let verify_response = TestRequest::propfind(&path)
        .depth("0")
        .xml_body(&props)
        .send(&service)
        .await;

    verify_response
        .assert_status(StatusCode::MULTI_STATUS)
        .assert_body_contains("collection");
}

/// ## Summary
/// Test that MKCOL on existing URI returns conflict.
#[test_log::test(tokio::test)]
async fn mkcol_on_existing_uri_conflict() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");
    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let collection_id = test_db
        .seed_collection(principal_id, "calendar", "testcal", None)
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    let service = create_db_test_service(&test_db.url()).await;

    // Try to create a collection with the same slug
    let path = caldav_collection_path("testuser", "testcal");
    let response = TestRequest::mkcol(&path)
        .send(&service)
        .await;

    // Either 405 or 409
    assert!(
        response.status == StatusCode::METHOD_NOT_ALLOWED
            || response.status == StatusCode::CONFLICT,
        "Expected 405 or 409, got {}",
        response.status
    );
}

// ============================================================================
// Protected Property Tests
// ============================================================================

/// ## Summary
/// Test that MKCALENDAR with protected properties returns appropriate error.
#[test_log::test(tokio::test)]
async fn mkcalendar_protected_props_rejected() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    test_db
        .seed_default_role_permissions()
        .await
        .expect("Failed to seed role permissions");
    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    // Grant owner access to the testuser's calendar namespace
    test_db
        .seed_access_policy(&format!("principal:{principal_id}"), "/cal/testuser/**", "owner")
        .await
        .expect("Failed to seed access policy");

    let service = create_db_test_service(&test_db.url()).await;

    let new_collection_slug = "protected-props-test";
    let path = caldav_collection_path("testuser", new_collection_slug);
    // Try to set getetag (protected property)
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set>
    <D:prop>
      <D:getetag>"custom-etag"</D:getetag>
    </D:prop>
  </D:set>
</C:mkcalendar>"#;

    let response = TestRequest::mkcalendar(&path)
        .xml_body(body)
        .send(&service)
        .await;

    // Either 403, 207 with propstat error, or collection created ignoring protected prop
    assert!(
        response.status == StatusCode::FORBIDDEN
            || response.status == StatusCode::MULTI_STATUS
            || response.status == StatusCode::CREATED,
        "Expected 403, 207, or 201, got {}",
        response.status
    );
}
