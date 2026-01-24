//! Tests for OPTIONS method handlers.

use salvo::http::StatusCode;
use salvo::prelude::*;
use salvo::test::{ResponseExt, TestClient};

use super::options::{options, options_collection, options_item};

/// ## Summary
/// Test that OPTIONS handler returns OK status.
#[tokio::test]
async fn options_returns_ok() {
    let router = Router::new().options(options);
    let service = Service::new(router);
    
    let mut resp = TestClient::options("http://127.0.0.1:5800/")
        .send(&service)
        .await;
    
    assert_eq!(resp.status_code, Some(StatusCode::OK));
}

/// ## Summary
/// Test that OPTIONS handler sets Allow header with correct methods.
#[tokio::test]
async fn options_sets_allow_header() {
    let router = Router::new().options(options);
    let service = Service::new(router);
    
    let mut resp = TestClient::options("http://127.0.0.1:5800/")
        .send(&service)
        .await;
    
    assert_eq!(resp.status_code, Some(StatusCode::OK));
    
    let allow_header = resp.headers().get("Allow");
    assert!(allow_header.is_some(), "Allow header should be present");
    
    let allow_value = allow_header.unwrap().to_str().unwrap();
    assert!(allow_value.contains("OPTIONS"));
    assert!(allow_value.contains("GET"));
    assert!(allow_value.contains("HEAD"));
    assert!(allow_value.contains("PUT"));
    assert!(allow_value.contains("DELETE"));
    assert!(allow_value.contains("PROPFIND"));
}

/// ## Summary
/// Test that OPTIONS handler sets DAV header with compliance classes.
#[tokio::test]
async fn options_sets_dav_header() {
    let router = Router::new().options(options);
    let service = Service::new(router);
    
    let mut resp = TestClient::options("http://127.0.0.1:5800/")
        .send(&service)
        .await;
    
    assert_eq!(resp.status_code, Some(StatusCode::OK));
    
    let dav_header = resp.headers().get("DAV");
    assert!(dav_header.is_some(), "DAV header should be present");
    
    let dav_value = dav_header.unwrap().to_str().unwrap();
    assert!(dav_value.contains("1"), "Should support DAV class 1");
    assert!(dav_value.contains("3"), "Should support DAV class 3");
    assert!(dav_value.contains("calendar-access"), "Should support CalDAV");
    assert!(dav_value.contains("addressbook"), "Should support CardDAV");
}

/// ## Summary
/// Test that OPTIONS collection handler includes collection-specific methods.
#[tokio::test]
async fn options_collection_includes_mkcol_methods() {
    let router = Router::new().options(options_collection);
    let service = Service::new(router);
    
    let mut resp = TestClient::options("http://127.0.0.1:5800/")
        .send(&service)
        .await;
    
    assert_eq!(resp.status_code, Some(StatusCode::OK));
    
    let allow_header = resp.headers().get("Allow");
    assert!(allow_header.is_some());
    
    let allow_value = allow_header.unwrap().to_str().unwrap();
    assert!(allow_value.contains("MKCALENDAR"), "Collections should allow MKCALENDAR");
    assert!(allow_value.contains("MKCOL"), "Collections should allow MKCOL");
}

/// ## Summary
/// Test that OPTIONS item handler excludes collection methods.
#[tokio::test]
async fn options_item_excludes_collection_methods() {
    let router = Router::new().options(options_item);
    let service = Service::new(router);
    
    let mut resp = TestClient::options("http://127.0.0.1:5800/")
        .send(&service)
        .await;
    
    assert_eq!(resp.status_code, Some(StatusCode::OK));
    
    let allow_header = resp.headers().get("Allow");
    assert!(allow_header.is_some());
    
    let allow_value = allow_header.unwrap().to_str().unwrap();
    assert!(!allow_value.contains("MKCALENDAR"), "Items should not allow MKCALENDAR");
    assert!(!allow_value.contains("MKCOL"), "Items should not allow MKCOL");
    assert!(allow_value.contains("OPTIONS"), "Items should allow basic methods");
    assert!(allow_value.contains("GET"));
    assert!(allow_value.contains("DELETE"));
}

/// ## Summary
/// Test that all OPTIONS handlers set appropriate DAV compliance classes.
#[tokio::test]
async fn options_handlers_advertise_caldav_carddav() {
    // Test generic options handler
    let router1 = Router::new().options(options);
    let service1 = Service::new(router1);
    let resp1 = TestClient::options("http://127.0.0.1:5800/")
        .send(&service1)
        .await;
    
    let dav_header1 = resp1.headers().get("DAV");
    assert!(dav_header1.is_some());
    let dav_value1 = dav_header1.unwrap().to_str().unwrap();
    assert!(dav_value1.contains("calendar-access"));
    assert!(dav_value1.contains("addressbook"));
    
    // Test collection options handler
    let router2 = Router::new().options(options_collection);
    let service2 = Service::new(router2);
    let resp2 = TestClient::options("http://127.0.0.1:5800/")
        .send(&service2)
        .await;
    
    let dav_header2 = resp2.headers().get("DAV");
    assert!(dav_header2.is_some());
    let dav_value2 = dav_header2.unwrap().to_str().unwrap();
    assert!(dav_value2.contains("calendar-access"));
    assert!(dav_value2.contains("addressbook"));
    
    // Test item options handler
    let router3 = Router::new().options(options_item);
    let service3 = Service::new(router3);
    let resp3 = TestClient::options("http://127.0.0.1:5800/")
        .send(&service3)
        .await;
    
    let dav_header3 = resp3.headers().get("DAV");
    assert!(dav_header3.is_some());
    let dav_value3 = dav_header3.unwrap().to_str().unwrap();
    assert!(dav_value3.contains("calendar-access"));
    assert!(dav_value3.contains("addressbook"));
}
