//! Integration tests for ACL pseudo principals (authenticated, unauthenticated, all).
//!
//! RFC 3744 §5.5.1 defines three pseudo-principals:
//! - DAV:authenticated - represents any authenticated user
//! - DAV:unauthenticated - represents anonymous users
//! - DAV:all - represents everyone (authenticated + unauthenticated)

use salvo::http::StatusCode;
use shuriken_db::db::enums::CollectionType;

use super::helpers::*;

/// ## Summary
/// Test that PROPFIND returns ACL with DAV:all pseudo-principal.
///
/// RFC 3744 §5.5.1: DAV:all represents everyone (authenticated + unauthenticated).
#[test_log::test(tokio::test)]
async fn propfind_acl_shows_all_pseudo_principal() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let collection_id = test_db
        .seed_collection(
            principal_id,
            CollectionType::Calendar,
            "public-cal",
            Some("Public Calendar"),
        )
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    // Grant read access to "all" (everyone)
    let collection_path = shuriken_service::auth::ResourceLocation::from_segments(vec![
        shuriken_service::auth::PathSegment::ResourceType(
            shuriken_service::auth::ResourceType::Calendar,
        ),
        shuriken_service::auth::PathSegment::Owner(shuriken_service::auth::ResourceIdentifier::Id(
            principal_id,
        )),
        shuriken_service::auth::PathSegment::Collection(
            shuriken_service::auth::ResourceIdentifier::Id(collection_id),
        ),
    ])
    .expect("Valid resource location")
    .serialize_to_path(false, false)
    .expect("Failed to build resource path");
    test_db
        .seed_access_policy("all", &collection_path, "read")
        .await
        .expect("Failed to seed all read access");

    let service = create_db_test_service(&test_db.url()).await;

    let prop_request = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:acl/>
  </D:prop>
</D:propfind>"#;

    let response = TestRequest::propfind(&caldav_collection_path("testuser", "public-cal"))
        .depth("0")
        .xml_body(prop_request)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body = response.body_string();

    // RFC 3744 §5.5.1: DAV:all is represented as <D:all/>
    assert!(
        body.contains("<D:all/>"),
        "Response should contain <D:all/> pseudo-principal"
    );

    // Should have read privilege
    assert!(
        body.contains("<D:read/>"),
        "Response should contain read privilege for all"
    );
}

/// ## Summary
/// Test that PROPFIND returns ACL with DAV:authenticated pseudo-principal.
///
/// RFC 3744 §5.5.1: DAV:authenticated represents any authenticated user.
#[test_log::test(tokio::test)]
async fn propfind_acl_shows_authenticated_pseudo_principal() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let collection_id = test_db
        .seed_collection(
            principal_id,
            CollectionType::Calendar,
            "members-cal",
            Some("Members Only Calendar"),
        )
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    // Grant read access to "authenticated" (any logged-in user)
    let collection_path = shuriken_service::auth::ResourceLocation::from_segments(vec![
        shuriken_service::auth::PathSegment::ResourceType(
            shuriken_service::auth::ResourceType::Calendar,
        ),
        shuriken_service::auth::PathSegment::Owner(shuriken_service::auth::ResourceIdentifier::Id(
            principal_id,
        )),
        shuriken_service::auth::PathSegment::Collection(
            shuriken_service::auth::ResourceIdentifier::Id(collection_id),
        ),
    ])
    .expect("Valid resource location")
    .serialize_to_path(false, false)
    .expect("Failed to build resource path");
    test_db
        .seed_access_policy("authenticated", &collection_path, "read")
        .await
        .expect("Failed to seed authenticated read access");

    let service = create_db_test_service(&test_db.url()).await;

    let prop_request = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:acl/>
  </D:prop>
</D:propfind>"#;

    let response = TestRequest::propfind(&caldav_collection_path("testuser", "members-cal"))
        .depth("0")
        .xml_body(prop_request)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body = response.body_string();

    // RFC 3744 §5.5.1: DAV:authenticated is represented as <D:authenticated/>
    assert!(
        body.contains("<D:authenticated/>"),
        "Response should contain <D:authenticated/> pseudo-principal"
    );

    // Should have read privilege
    assert!(
        body.contains("<D:read/>"),
        "Response should contain read privilege for authenticated"
    );
}

/// ## Summary
/// Test that PROPFIND returns ACL with DAV:unauthenticated pseudo-principal.
///
/// RFC 3744 §5.5.1: DAV:unauthenticated represents anonymous users.
#[test_log::test(tokio::test)]
async fn propfind_acl_shows_unauthenticated_pseudo_principal() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let collection_id = test_db
        .seed_collection(
            principal_id,
            CollectionType::Calendar,
            "anon-cal",
            Some("Anonymous Access Calendar"),
        )
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    // Grant read access to "unauthenticated" (anonymous users only)
    let collection_path = shuriken_service::auth::ResourceLocation::from_segments(vec![
        shuriken_service::auth::PathSegment::ResourceType(
            shuriken_service::auth::ResourceType::Calendar,
        ),
        shuriken_service::auth::PathSegment::Owner(shuriken_service::auth::ResourceIdentifier::Id(
            principal_id,
        )),
        shuriken_service::auth::PathSegment::Collection(
            shuriken_service::auth::ResourceIdentifier::Id(collection_id),
        ),
    ])
    .expect("Valid resource location")
    .serialize_to_path(false, false)
    .expect("Failed to build resource path");
    test_db
        .seed_access_policy("unauthenticated", &collection_path, "read")
        .await
        .expect("Failed to seed unauthenticated read access");

    let service = create_db_test_service(&test_db.url()).await;

    let prop_request = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:acl/>
  </D:prop>
</D:propfind>"#;

    let response = TestRequest::propfind(&caldav_collection_path("testuser", "anon-cal"))
        .depth("0")
        .xml_body(prop_request)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body = response.body_string();

    // RFC 3744 §5.5.1: DAV:unauthenticated is represented as <D:unauthenticated/>
    assert!(
        body.contains("<D:unauthenticated/>"),
        "Response should contain <D:unauthenticated/> pseudo-principal"
    );

    // Should have read privilege
    assert!(
        body.contains("<D:read/>"),
        "Response should contain read privilege for unauthenticated"
    );
}

/// ## Summary
/// Test that ACL shows multiple pseudo-principals when different principals have different access.
///
/// RFC 3744 §5.5: ACL property shows the actual ACE entries from policies.
/// When authenticated and unauthenticated have different roles, both should appear.
#[test_log::test(tokio::test)]
async fn propfind_acl_shows_multiple_pseudo_principals() {
    let test_db = TestDb::new().await.expect("Failed to create test database");
    let principal_id = test_db
        .seed_authenticated_user()
        .await
        .expect("Failed to seed authenticated user");

    let collection_id = test_db
        .seed_collection(
            principal_id,
            CollectionType::Calendar,
            "multi-cal",
            Some("Multiple Principals Calendar"),
        )
        .await
        .expect("Failed to seed collection");

    test_db
        .seed_collection_owner(principal_id, collection_id, "calendar")
        .await
        .expect("Failed to seed collection owner");

    // Grant different levels of access to different pseudo-principals
    let collection_path = shuriken_service::auth::ResourceLocation::from_segments(vec![
        shuriken_service::auth::PathSegment::ResourceType(
            shuriken_service::auth::ResourceType::Calendar,
        ),
        shuriken_service::auth::PathSegment::Owner(shuriken_service::auth::ResourceIdentifier::Id(
            principal_id,
        )),
        shuriken_service::auth::PathSegment::Collection(
            shuriken_service::auth::ResourceIdentifier::Id(collection_id),
        ),
    ])
    .expect("Valid resource location")
    .serialize_to_path(false, false)
    .expect("Failed to build resource path");

    // Authenticated users can read and write
    test_db
        .seed_access_policy("authenticated", &collection_path, "edit")
        .await
        .expect("Failed to seed authenticated edit access");

    // Unauthenticated users get read-only (freebusy)
    test_db
        .seed_access_policy("unauthenticated", &collection_path, "read-freebusy")
        .await
        .expect("Failed to seed unauthenticated freebusy access");

    let service = create_db_test_service(&test_db.url()).await;

    let prop_request = r#"<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:acl/>
  </D:prop>
</D:propfind>"#;

    let response = TestRequest::propfind(&caldav_collection_path("testuser", "multi-cal"))
        .depth("0")
        .xml_body(prop_request)
        .send(&service)
        .await;

    let response = response.assert_status(StatusCode::MULTI_STATUS);
    let body = response.body_string();

    // RFC 3744 §5.5: ACL property shows actual policy entries
    // We have separate policies for authenticated and unauthenticated, so both should appear
    // Note: We do NOT synthesize a <D:all/> entry - we show what's in the policies
    assert!(
        body.contains("<D:authenticated/>"),
        "Response should contain <D:authenticated/> from policy"
    );
    assert!(
        body.contains("<D:unauthenticated/>"),
        "Response should contain <D:unauthenticated/> from policy"
    );

    // Verify different privileges are present for different principals
    assert!(
        body.contains("<D:write-content/>") || body.contains("<D:bind/>"),
        "Should have write privileges for authenticated"
    );
}
