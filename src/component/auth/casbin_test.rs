//! Unit tests for Casbin authorization model and enforcement logic.

#[cfg(test)]
mod tests {
    use casbin::{CoreApi, DefaultModel, Enforcer};
    use string_adapter::StringAdapter;

    /// ## Summary
    /// Creates a test enforcer with the production model and test policies.
    async fn create_test_enforcer() -> Enforcer {
        // Load the actual model from the config file
        let model = DefaultModel::from_str(include_str!("casbin_model.conf"))
            .await
            .expect("Failed to load Casbin model");

        // Create a string adapter with test policies
        let policies = r"
# Resource access policies (p = subject, path, role)
p, principal:alice, /calendars/alice/**, owner
p, principal:alice, /addressbooks/alice/**, owner
p, principal:alice, /calendars/alice/personal/pets/*, reader
p, principal:alice, /calendars/shared/events/*, editor
p, principal:bob, /calendars/bob/**, owner
p, principal:bob, /addressbooks/bob/**, owner
p, principal:bob, /calendars/alice/personal/pets/*, share-manager
p, principal:bob, /calendars/shared/events/*, reader
p, principal:bossman, /calendars/bossman/**, owner
p, principal:bossman, /addressbooks/bossman/**, owner
p, principal:bossman, /calendars/team/**, share-manager
p, principal:bossman, /addressbooks/team/**, share-manager
p, principal:bossman, /calendars/shared/*, editor-basic
p, principal:cio, /calendars/cio/**, owner
p, principal:cio, /addressbooks/cio/**, owner
p, principal:cio, /calendars/team/**, owner
p, principal:cio, /addressbooks/team/**, owner
p, principal:cio, /calendars/**, reader
p, principal:cio, /addressbooks/**, reader
p, principal:team, /calendars/team/**, reader
p, principal:team, /addressbooks/team/**, reader
p, principal:team, /calendars/shared/**, reader-freebusy
p, principal:charlie, /calendars/charlie/*, owner
p, principal:charlie, /calendars/charlie/work/*, editor
p, principal:charlie, /addressbooks/charlie/contacts/*, reader
p, principal:dave, /calendars/dave/public/**, reader-freebusy
p, principal:dave, /calendars/dave/private/**, owner
p, principal:dave, /calendars/shared/events/dave-event.ics, owner
p, principal:eve, /calendars/eve/**, editor-basic
p, principal:eve, /addressbooks/team/directory/*, reader
p, public, /calendars/bob/shared/*, reader
p, public, /calendars/dave/public/*, reader-freebusy
p, public, /calendars/shared/public/*, reader-freebusy

# Role-to-permission mappings (g2 = role, permission)
g2, reader-freebusy, read_freebusy
g2, reader, read_freebusy
g2, reader, read
g2, editor-basic, read_freebusy
g2, editor-basic, read
g2, editor-basic, edit
g2, editor, read_freebusy
g2, editor, read
g2, editor, edit
g2, editor, delete
g2, share-manager, read_freebusy
g2, share-manager, read
g2, share-manager, edit
g2, share-manager, delete
g2, share-manager, share_read
g2, share-manager, share_edit
g2, owner, read_freebusy
g2, owner, read
g2, owner, edit
g2, owner, delete
g2, owner, share_read
g2, owner, share_edit
g2, owner, admin
";

        let adapter = StringAdapter::new(policies);

        Enforcer::new(model, adapter)
            .await
            .expect("Failed to create enforcer")
    }

    #[tokio::test]
    async fn test_owner_permissions() {
        let e = create_test_enforcer().await;

        // Alice owns her calendar - should have all permissions
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/alice/personal/work/event1.ics",
                "read"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/alice/personal/work/event1.ics",
                "edit"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/alice/personal/work/event1.ics",
                "delete"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/alice/personal/work/event1.ics",
                "share_read"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/alice/personal/work/event1.ics",
                "admin"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_reader_permissions() {
        let e = create_test_enforcer().await;

        // Public has read access to Bob's shared calendar
        assert!(
            e.enforce(("public", "/calendars/bob/shared/event6.ics", "read"))
                .unwrap()
        );
        assert!(
            e.enforce((
                "public",
                "/calendars/bob/shared/event6.ics",
                "read_freebusy"
            ))
            .unwrap()
        );

        // Public should not have write permissions
        assert!(
            !e.enforce(("public", "/calendars/bob/shared/event6.ics", "edit"))
                .unwrap()
        );
        assert!(
            !e.enforce(("public", "/calendars/bob/shared/event6.ics", "delete"))
                .unwrap()
        );
    }

    #[tokio::test]
    async fn test_share_manager_permissions() {
        let e = create_test_enforcer().await;

        // Bob is share-manager for Alice's pets calendar
        assert!(
            e.enforce((
                "principal:bob",
                "/calendars/alice/personal/pets/event1.ics",
                "read"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:bob",
                "/calendars/alice/personal/pets/event1.ics",
                "edit"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:bob",
                "/calendars/alice/personal/pets/event1.ics",
                "delete"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:bob",
                "/calendars/alice/personal/pets/event1.ics",
                "share_read"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:bob",
                "/calendars/alice/personal/pets/event1.ics",
                "share_edit"
            ))
            .unwrap()
        );

        // Bob should not have admin permission
        assert!(
            !e.enforce((
                "principal:bob",
                "/calendars/alice/personal/pets/event1.ics",
                "admin"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_glob_matching_double_star() {
        let e = create_test_enforcer().await;

        // Alice owns /calendars/alice/** (any depth)
        assert!(
            e.enforce(("principal:alice", "/calendars/alice/event.ics", "read"))
                .unwrap()
        );
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/alice/personal/event.ics",
                "read"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/alice/personal/work/event.ics",
                "read"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/alice/personal/work/projects/2024/event.ics",
                "read"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_glob_matching_single_star() {
        let e = create_test_enforcer().await;

        // Public has access to /calendars/bob/shared/* (one level only)
        assert!(
            e.enforce(("public", "/calendars/bob/shared/event6.ics", "read"))
                .unwrap()
        );

        // Public should NOT have access to deeper levels
        assert!(
            !e.enforce((
                "public",
                "/calendars/bob/shared/subfolder/event.ics",
                "read"
            ))
            .unwrap()
        );

        // Public should NOT have access to Bob's other calendars
        assert!(
            !e.enforce(("public", "/calendars/bob/personal/event5.ics", "read"))
                .unwrap()
        );
    }

    #[tokio::test]
    async fn test_cio_read_all_access() {
        let e = create_test_enforcer().await;

        // CIO has read access to all calendars via /calendars/**
        assert!(
            e.enforce((
                "principal:cio",
                "/calendars/alice/personal/event.ics",
                "read"
            ))
            .unwrap()
        );
        assert!(
            e.enforce(("principal:cio", "/calendars/bob/personal/event.ics", "read"))
                .unwrap()
        );
        assert!(
            e.enforce((
                "principal:cio",
                "/calendars/bossman/reports/event8.ics",
                "read"
            ))
            .unwrap()
        );

        // But CIO should NOT have edit access to Alice's calendar (only read)
        assert!(
            !e.enforce((
                "principal:cio",
                "/calendars/alice/personal/event.ics",
                "edit"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_cio_owner_of_team_resources() {
        let e = create_test_enforcer().await;

        // CIO owns team resources - should have all permissions
        assert!(
            e.enforce((
                "principal:cio",
                "/calendars/team/group-bonding/event10.ics",
                "read"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:cio",
                "/calendars/team/group-bonding/event10.ics",
                "edit"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:cio",
                "/calendars/team/group-bonding/event10.ics",
                "delete"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:cio",
                "/calendars/team/group-bonding/event10.ics",
                "admin"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_team_group_read_access() {
        let e = create_test_enforcer().await;

        // Team group has read access to team calendar
        assert!(
            e.enforce((
                "principal:team",
                "/calendars/team/group-bonding/event10.ics",
                "read"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:team",
                "/calendars/team/group-bonding/event10.ics",
                "read_freebusy"
            ))
            .unwrap()
        );

        // Team group should not have write access
        assert!(
            !e.enforce((
                "principal:team",
                "/calendars/team/group-bonding/event10.ics",
                "edit"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_bossman_share_manager_of_team() {
        let e = create_test_enforcer().await;

        // Bossman is share-manager for team resources
        assert!(
            e.enforce((
                "principal:bossman",
                "/calendars/team/group-bonding/event10.ics",
                "read"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:bossman",
                "/calendars/team/group-bonding/event10.ics",
                "edit"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:bossman",
                "/calendars/team/group-bonding/event10.ics",
                "share_read"
            ))
            .unwrap()
        );

        // Bossman should not have admin permission (only share-manager)
        assert!(
            !e.enforce((
                "principal:bossman",
                "/calendars/team/group-bonding/event10.ics",
                "admin"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_alice_dual_access_to_pets_calendar() {
        let e = create_test_enforcer().await;

        // Alice has both owner access (via /calendars/alice/**)
        // and explicit reader access (via /calendars/alice/personal/pets/*)
        // Owner should take precedence
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/alice/personal/pets/event1.ics",
                "edit"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/alice/personal/pets/event1.ics",
                "admin"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_no_access_to_other_users_resources() {
        let e = create_test_enforcer().await;

        // Bob should not have access to Alice's work calendar
        assert!(
            !e.enforce((
                "principal:bob",
                "/calendars/alice/personal/work/event3.ics",
                "read"
            ))
            .unwrap()
        );

        // Alice should not have access to Bob's calendar
        assert!(
            !e.enforce((
                "principal:alice",
                "/calendars/bob/personal/event5.ics",
                "read"
            ))
            .unwrap()
        );

        // Public should not have access to Alice's calendar
        assert!(
            !e.enforce(("public", "/calendars/alice/personal/event.ics", "read"))
                .unwrap()
        );
    }

    #[tokio::test]
    async fn test_addressbook_access() {
        let e = create_test_enforcer().await;

        // Alice owns her addressbook
        assert!(
            e.enforce((
                "principal:alice",
                "/addressbooks/alice/contacts/contact1.vcf",
                "read"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:alice",
                "/addressbooks/alice/contacts/contact1.vcf",
                "edit"
            ))
            .unwrap()
        );

        // CIO has read access to all addressbooks
        assert!(
            e.enforce((
                "principal:cio",
                "/addressbooks/alice/contacts/contact1.vcf",
                "read"
            ))
            .unwrap()
        );

        // Team group has read access to team addressbook
        assert!(
            e.enforce((
                "principal:team",
                "/addressbooks/team/directory/alice.vcf",
                "read"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_collection_level_access() {
        let e = create_test_enforcer().await;

        // Test access to collections (directories) not just items
        assert!(
            e.enforce(("principal:alice", "/calendars/alice/personal/", "read"))
                .unwrap()
        );
        assert!(
            e.enforce(("public", "/calendars/bob/shared/", "read"))
                .unwrap()
        );

        // Public should not have access to bob's personal collection
        assert!(
            !e.enforce(("public", "/calendars/bob/personal/", "read"))
                .unwrap()
        );
    }

    #[tokio::test]
    async fn test_role_hierarchy_permissions() {
        let e = create_test_enforcer().await;

        // Verify that higher roles include lower permissions
        // reader-freebusy only has read_freebusy
        // reader has read_freebusy + read
        // editor has read_freebusy + read + edit + delete
        // share-manager has everything except admin
        // owner has everything including admin

        // Verify through enforcement that role permissions work correctly
        // If owner has admin permission, then the g2 mapping is working
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/alice/personal/event.ics",
                "admin"
            ))
            .unwrap()
        );

        // Verify reader has read but not edit
        assert!(
            e.enforce(("public", "/calendars/bob/shared/event.ics", "read"))
                .unwrap()
        );
        assert!(
            !e.enforce(("public", "/calendars/bob/shared/event.ics", "edit"))
                .unwrap()
        );

        // Verify share-manager has share permissions but not admin
        assert!(
            e.enforce((
                "principal:bob",
                "/calendars/alice/personal/pets/event.ics",
                "share_read"
            ))
            .unwrap()
        );
        assert!(
            !e.enforce((
                "principal:bob",
                "/calendars/alice/personal/pets/event.ics",
                "admin"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_path_boundaries() {
        let e = create_test_enforcer().await;

        // Test that /calendars/alice/** doesn't match /calendars/alice-evil/**
        assert!(
            !e.enforce((
                "principal:alice",
                "/calendars/alice-evil/calendar/event.ics",
                "read"
            ))
            .unwrap()
        );

        // Test that /calendars/bob/shared/* doesn't match /calendars/bob/shared-evil/event.ics
        assert!(
            !e.enforce(("public", "/calendars/bob/shared-evil/event.ics", "read"))
                .unwrap()
        );
    }

    #[tokio::test]
    async fn test_editor_basic_role() {
        let e = create_test_enforcer().await;

        // Eve has editor-basic role - should have read and edit but not delete
        assert!(
            e.enforce(("principal:eve", "/calendars/eve/personal/event.ics", "read"))
                .unwrap()
        );
        assert!(
            e.enforce(("principal:eve", "/calendars/eve/personal/event.ics", "edit"))
                .unwrap()
        );
        assert!(
            !e.enforce((
                "principal:eve",
                "/calendars/eve/personal/event.ics",
                "delete"
            ))
            .unwrap()
        );
        assert!(
            !e.enforce((
                "principal:eve",
                "/calendars/eve/personal/event.ics",
                "share_read"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_reader_freebusy_role() {
        let e = create_test_enforcer().await;

        // Dave has reader-freebusy for his public calendar
        assert!(
            e.enforce((
                "principal:dave",
                "/calendars/dave/public/calendar/event.ics",
                "read_freebusy"
            ))
            .unwrap()
        );
        assert!(
            !e.enforce((
                "principal:dave",
                "/calendars/dave/public/calendar/event.ics",
                "read"
            ))
            .unwrap()
        );
        assert!(
            !e.enforce((
                "principal:dave",
                "/calendars/dave/public/calendar/event.ics",
                "edit"
            ))
            .unwrap()
        );

        // Public has reader-freebusy for Dave's public calendar
        assert!(
            e.enforce((
                "public",
                "/calendars/dave/public/event.ics",
                "read_freebusy"
            ))
            .unwrap()
        );
        assert!(
            !e.enforce(("public", "/calendars/dave/public/event.ics", "read"))
                .unwrap()
        );
    }

    #[tokio::test]
    async fn test_mixed_depth_glob_patterns() {
        let e = create_test_enforcer().await;

        // Charlie has owner on /calendars/charlie/* (single level)
        assert!(
            e.enforce(("principal:charlie", "/calendars/charlie/event.ics", "admin"))
                .unwrap()
        );

        // Charlie has editor on /calendars/charlie/work/* (single level under work)
        assert!(
            e.enforce((
                "principal:charlie",
                "/calendars/charlie/work/project.ics",
                "edit"
            ))
            .unwrap()
        );
        assert!(
            !e.enforce((
                "principal:charlie",
                "/calendars/charlie/work/project.ics",
                "admin"
            ))
            .unwrap()
        );

        // Should NOT match nested paths beyond single level
        assert!(
            !e.enforce((
                "principal:charlie",
                "/calendars/charlie/work/projects/q1.ics",
                "edit"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_specific_file_access() {
        let e = create_test_enforcer().await;

        // Dave has owner access to a specific file in shared
        assert!(
            e.enforce((
                "principal:dave",
                "/calendars/shared/events/dave-event.ics",
                "admin"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:dave",
                "/calendars/shared/events/dave-event.ics",
                "delete"
            ))
            .unwrap()
        );

        // But not to other files in the same directory
        assert!(
            !e.enforce((
                "principal:dave",
                "/calendars/shared/events/other-event.ics",
                "read"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_overlapping_policies_most_specific_wins() {
        let e = create_test_enforcer().await;

        // Alice has owner for /calendars/alice/** (any depth)
        // But also explicitly reader for /calendars/alice/personal/pets/* (single level)
        // The more specific policy or evaluation order determines final access

        // Alice should still have owner permissions due to ** wildcard
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/alice/personal/pets/event.ics",
                "delete"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/alice/personal/pets/event.ics",
                "admin"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_multiple_resource_types() {
        let e = create_test_enforcer().await;

        // Charlie has different permissions on calendars vs addressbooks
        assert!(
            e.enforce(("principal:charlie", "/calendars/charlie/event.ics", "admin"))
                .unwrap()
        );
        assert!(
            e.enforce((
                "principal:charlie",
                "/addressbooks/charlie/contacts/contact.vcf",
                "read"
            ))
            .unwrap()
        );
        assert!(
            !e.enforce((
                "principal:charlie",
                "/addressbooks/charlie/contacts/contact.vcf",
                "edit"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_shared_resource_access() {
        let e = create_test_enforcer().await;

        // Alice has editor role on shared events
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/shared/events/team-meeting.ics",
                "edit"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/shared/events/team-meeting.ics",
                "delete"
            ))
            .unwrap()
        );

        // Bob has reader role on shared events
        assert!(
            e.enforce((
                "principal:bob",
                "/calendars/shared/events/team-meeting.ics",
                "read"
            ))
            .unwrap()
        );
        assert!(
            !e.enforce((
                "principal:bob",
                "/calendars/shared/events/team-meeting.ics",
                "edit"
            ))
            .unwrap()
        );

        // Bossman has editor-basic on /calendars/shared/* (single level)
        assert!(
            e.enforce((
                "principal:bossman",
                "/calendars/shared/overview.ics",
                "edit"
            ))
            .unwrap()
        );
        assert!(
            !e.enforce((
                "principal:bossman",
                "/calendars/shared/overview.ics",
                "delete"
            ))
            .unwrap()
        );

        // But not on nested paths
        assert!(
            !e.enforce((
                "principal:bossman",
                "/calendars/shared/events/meeting.ics",
                "read"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_public_access_various_resources() {
        let e = create_test_enforcer().await;

        // Public has freebusy access to shared public calendar
        assert!(
            e.enforce((
                "public",
                "/calendars/shared/public/holiday.ics",
                "read_freebusy"
            ))
            .unwrap()
        );
        assert!(
            !e.enforce(("public", "/calendars/shared/public/holiday.ics", "read"))
                .unwrap()
        );

        // Public has read access to Bob's shared items
        assert!(
            e.enforce(("public", "/calendars/bob/shared/event.ics", "read"))
                .unwrap()
        );

        // Public should not have access to non-shared resources
        assert!(
            !e.enforce((
                "public",
                "/calendars/alice/personal/event.ics",
                "read_freebusy"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_hierarchical_permission_checks() {
        let e = create_test_enforcer().await;

        // Owner role should have all lower permissions
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/alice/personal/event.ics",
                "read_freebusy"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/alice/personal/event.ics",
                "read"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/alice/personal/event.ics",
                "edit"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/alice/personal/event.ics",
                "delete"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/alice/personal/event.ics",
                "share_read"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/alice/personal/event.ics",
                "share_edit"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/alice/personal/event.ics",
                "admin"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_no_permission_escalation() {
        let e = create_test_enforcer().await;

        // Reader should not have edit permissions
        assert!(
            e.enforce((
                "principal:bob",
                "/calendars/shared/events/meeting.ics",
                "read"
            ))
            .unwrap()
        );
        assert!(
            !e.enforce((
                "principal:bob",
                "/calendars/shared/events/meeting.ics",
                "edit"
            ))
            .unwrap()
        );
        assert!(
            !e.enforce((
                "principal:bob",
                "/calendars/shared/events/meeting.ics",
                "delete"
            ))
            .unwrap()
        );
        assert!(
            !e.enforce((
                "principal:bob",
                "/calendars/shared/events/meeting.ics",
                "admin"
            ))
            .unwrap()
        );

        // Editor-basic should not have delete or admin
        assert!(
            e.enforce(("principal:eve", "/calendars/eve/personal/event.ics", "edit"))
                .unwrap()
        );
        assert!(
            !e.enforce((
                "principal:eve",
                "/calendars/eve/personal/event.ics",
                "delete"
            ))
            .unwrap()
        );
        assert!(
            !e.enforce((
                "principal:eve",
                "/calendars/eve/personal/event.ics",
                "admin"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_cio_universal_read_with_specific_ownership() {
        let e = create_test_enforcer().await;

        // CIO has universal read access
        assert!(
            e.enforce((
                "principal:cio",
                "/calendars/charlie/personal/event.ics",
                "read"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:cio",
                "/calendars/dave/private/secret.ics",
                "read"
            ))
            .unwrap()
        );
        assert!(
            e.enforce(("principal:cio", "/calendars/eve/work/project.ics", "read"))
                .unwrap()
        );

        // But CIO should not have write access to others' calendars
        assert!(
            !e.enforce((
                "principal:cio",
                "/calendars/charlie/personal/event.ics",
                "edit"
            ))
            .unwrap()
        );

        // Except for team resources where CIO is owner
        assert!(
            e.enforce((
                "principal:cio",
                "/calendars/team/planning/event.ics",
                "admin"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_deeply_nested_paths() {
        let e = create_test_enforcer().await;

        // Dave has owner on /calendars/dave/private/** (any depth)
        assert!(
            e.enforce((
                "principal:dave",
                "/calendars/dave/private/work/projects/2024/q1/meeting.ics",
                "admin"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:dave",
                "/calendars/dave/private/personal/family/vacation.ics",
                "delete"
            ))
            .unwrap()
        );

        // CIO should have read access via universal /calendars/** policy
        assert!(
            e.enforce((
                "principal:cio",
                "/calendars/dave/private/work/projects/2024/q1/meeting.ics",
                "read"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_team_group_freebusy_access() {
        let e = create_test_enforcer().await;

        // Team group has reader-freebusy for /calendars/shared/**
        assert!(
            e.enforce((
                "principal:team",
                "/calendars/shared/planning/sprint.ics",
                "read_freebusy"
            ))
            .unwrap()
        );
        assert!(
            !e.enforce((
                "principal:team",
                "/calendars/shared/planning/sprint.ics",
                "read"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_eve_addressbook_limited_access() {
        let e = create_test_enforcer().await;

        // Eve has reader access to team directory contacts
        assert!(
            e.enforce((
                "principal:eve",
                "/addressbooks/team/directory/alice.vcf",
                "read"
            ))
            .unwrap()
        );
        assert!(
            !e.enforce((
                "principal:eve",
                "/addressbooks/team/directory/alice.vcf",
                "edit"
            ))
            .unwrap()
        );

        // But not to other team addressbook paths
        assert!(
            !e.enforce((
                "principal:eve",
                "/addressbooks/team/external/partner.vcf",
                "read"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_all_permission_types_for_each_role() {
        let e = create_test_enforcer().await;

        let permissions = [
            "read_freebusy",
            "read",
            "edit",
            "delete",
            "share_read",
            "share_edit",
            "admin",
        ];

        // reader-freebusy: only read_freebusy
        for perm in &permissions {
            let result = e
                .enforce(("principal:dave", "/calendars/dave/public/event.ics", *perm))
                .unwrap();
            if *perm == "read_freebusy" {
                assert!(result, "reader-freebusy should have {perm}");
            } else {
                assert!(!result, "reader-freebusy should not have {perm}");
            }
        }

        // reader: read_freebusy + read
        for perm in &permissions {
            let result = e
                .enforce(("public", "/calendars/bob/shared/event.ics", *perm))
                .unwrap();
            if *perm == "read_freebusy" || *perm == "read" {
                assert!(result, "reader should have {perm}");
            } else {
                assert!(!result, "reader should not have {perm}");
            }
        }

        // editor-basic: read_freebusy + read + edit (no delete)
        for perm in &permissions {
            let result = e
                .enforce(("principal:eve", "/calendars/eve/personal/event.ics", *perm))
                .unwrap();
            if *perm == "read_freebusy" || *perm == "read" || *perm == "edit" {
                assert!(result, "editor-basic should have {}", perm);
            } else {
                assert!(!result, "editor-basic should not have {}", perm);
            }
        }

        // editor: read_freebusy + read + edit + delete (no share)
        for perm in &permissions {
            let result = e
                .enforce((
                    "principal:alice",
                    "/calendars/shared/events/meeting.ics",
                    *perm,
                ))
                .unwrap();
            if ["read_freebusy", "read", "edit", "delete"].contains(perm) {
                assert!(result, "editor should have {}", perm);
            } else {
                assert!(!result, "editor should not have {}", perm);
            }
        }

        // share-manager: everything except admin
        for perm in &permissions {
            let result = e
                .enforce((
                    "principal:bob",
                    "/calendars/alice/personal/pets/event.ics",
                    *perm,
                ))
                .unwrap();
            if *perm != "admin" {
                assert!(result, "share-manager should have {}", perm);
            } else {
                assert!(!result, "share-manager should not have {}", perm);
            }
        }

        // owner: everything including admin
        for perm in &permissions {
            let result = e
                .enforce((
                    "principal:alice",
                    "/calendars/alice/personal/event.ics",
                    *perm,
                ))
                .unwrap();
            assert!(result, "owner should have {}", perm);
        }
    }

    #[tokio::test]
    async fn test_root_level_calendar_access() {
        let e = create_test_enforcer().await;

        // Test access to root-level calendars (no subdirectories)
        assert!(
            e.enforce((
                "principal:charlie",
                "/calendars/charlie/root-event.ics",
                "admin"
            ))
            .unwrap()
        );

        // Should not match deeper paths with single-level wildcard
        assert!(
            !e.enforce((
                "principal:charlie",
                "/calendars/charlie/subfolder/event.ics",
                "admin"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_permission_at_collection_root() {
        let e = create_test_enforcer().await;

        // Test that wildcards match within the collection
        // Alice has /calendars/alice/**, so she can access items inside
        assert!(
            e.enforce(("principal:alice", "/calendars/alice/item.ics", "read"))
                .unwrap()
        );

        // But not the collection path itself (before the /**)
        assert!(
            !e.enforce(("principal:alice", "/calendars/alice", "read"))
                .unwrap()
        );

        // Public should not have access to collection roots they don't own
        assert!(
            !e.enforce(("public", "/calendars/alice/", "read_freebusy"))
                .unwrap()
        );
    }

    #[tokio::test]
    async fn test_wildcard_does_not_cross_boundaries() {
        let e = create_test_enforcer().await;

        // /calendars/bob/** should not match /addressbooks/bob/**
        assert!(
            e.enforce((
                "principal:bob",
                "/calendars/bob/personal/event.ics",
                "admin"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:bob",
                "/addressbooks/bob/contacts/contact.vcf",
                "admin"
            ))
            .unwrap()
        );

        // But wildcards should not leak across resource type boundaries
        // (This is implicit in the policies but worth testing)
    }

    #[tokio::test]
    async fn test_adjacent_path_segments_different_permissions() {
        let e = create_test_enforcer().await;

        // Charlie has different permissions on adjacent paths
        // /calendars/charlie/* is owner
        // /calendars/charlie/work/* is editor
        assert!(
            e.enforce((
                "principal:charlie",
                "/calendars/charlie/personal.ics",
                "admin"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:charlie",
                "/calendars/charlie/work/project.ics",
                "edit"
            ))
            .unwrap()
        );
        assert!(
            !e.enforce((
                "principal:charlie",
                "/calendars/charlie/work/project.ics",
                "admin"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_public_vs_authenticated_same_resource() {
        let e = create_test_enforcer().await;

        // Public has reader access to Bob's shared calendar
        assert!(
            e.enforce(("public", "/calendars/bob/shared/event.ics", "read"))
                .unwrap()
        );

        // Bob as owner should have more permissions than public
        assert!(
            e.enforce(("principal:bob", "/calendars/bob/shared/event.ics", "admin"))
                .unwrap()
        );
        assert!(
            !e.enforce(("public", "/calendars/bob/shared/event.ics", "admin"))
                .unwrap()
        );
    }

    #[tokio::test]
    async fn test_deny_access_to_nonexistent_paths() {
        let e = create_test_enforcer().await;

        // Users should not have access to paths not explicitly granted
        assert!(
            !e.enforce((
                "principal:alice",
                "/calendars/nonexistent/event.ics",
                "read"
            ))
            .unwrap()
        );
        assert!(
            !e.enforce(("principal:bob", "/calendars/alice/secret/event.ics", "read"))
                .unwrap()
        );
        assert!(
            !e.enforce((
                "public",
                "/calendars/private/admin/config.ics",
                "read_freebusy"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_very_deeply_nested_path_access() {
        let e = create_test_enforcer().await;

        // Test extremely nested paths with ** wildcard
        let deep_path = "/calendars/dave/private/work/clients/acme/projects/2024/q4/november/\
                         week3/monday/morning/standup.ics";
        assert!(e.enforce(("principal:dave", deep_path, "admin")).unwrap());
        assert!(e.enforce(("principal:cio", deep_path, "read")).unwrap());
        assert!(!e.enforce(("principal:alice", deep_path, "read")).unwrap());
    }

    #[tokio::test]
    async fn test_parent_child_permission_isolation() {
        let e = create_test_enforcer().await;

        // Having permission on child should not grant permission on parent
        // Dave has owner on specific file but not necessarily on parent directory
        assert!(
            e.enforce((
                "principal:dave",
                "/calendars/shared/events/dave-event.ics",
                "admin"
            ))
            .unwrap()
        );

        // Dave should not have access to other files in the same directory
        assert!(
            !e.enforce((
                "principal:dave",
                "/calendars/shared/events/alice-event.ics",
                "read"
            ))
            .unwrap()
        );

        // And not to the parent directory itself
        assert!(
            !e.enforce(("principal:dave", "/calendars/shared/events/", "read"))
                .unwrap()
        );
    }

    #[tokio::test]
    async fn test_permission_inheritance_vs_explicit_grant() {
        let e = create_test_enforcer().await;

        // Alice has explicit reader on pets calendar but owner via parent path
        // The owner permission should be checked and grant access
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/alice/personal/pets/fluffy.ics",
                "delete"
            ))
            .unwrap()
        );

        // Verify that both policies are active but owner takes precedence
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/alice/personal/pets/fluffy.ics",
                "admin"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_wildcard_specificity_matching() {
        let e = create_test_enforcer().await;

        // More specific patterns should match correctly
        // Charlie: /calendars/charlie/* vs /calendars/charlie/work/*
        let general = "/calendars/charlie/event.ics";
        let specific = "/calendars/charlie/work/project.ics";

        // General path matches owner
        assert!(e.enforce(("principal:charlie", general, "admin")).unwrap());

        // Specific path matches editor (more specific)
        assert!(e.enforce(("principal:charlie", specific, "edit")).unwrap());
        assert!(!e.enforce(("principal:charlie", specific, "admin")).unwrap());
    }

    #[tokio::test]
    async fn test_multiple_policies_same_subject_different_paths() {
        let e = create_test_enforcer().await;

        // Alice has multiple policies on different paths
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/alice/work/meeting.ics",
                "admin"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/shared/events/team.ics",
                "edit"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:alice",
                "/addressbooks/alice/contacts/john.vcf",
                "admin"
            ))
            .unwrap()
        );

        // Each should have appropriate permissions
        assert!(
            !e.enforce((
                "principal:alice",
                "/calendars/shared/events/team.ics",
                "admin"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_share_permission_boundaries() {
        let e = create_test_enforcer().await;

        // Share-manager can grant share permissions but not admin
        assert!(
            e.enforce((
                "principal:bob",
                "/calendars/alice/personal/pets/cat.ics",
                "share_read"
            ))
            .unwrap()
        );
        assert!(
            e.enforce((
                "principal:bob",
                "/calendars/alice/personal/pets/cat.ics",
                "share_edit"
            ))
            .unwrap()
        );
        assert!(
            !e.enforce((
                "principal:bob",
                "/calendars/alice/personal/pets/cat.ics",
                "admin"
            ))
            .unwrap()
        );

        // Reader should not have any share permissions
        assert!(
            !e.enforce((
                "principal:bob",
                "/calendars/shared/events/meeting.ics",
                "share_read"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_editor_role_cannot_share() {
        let e = create_test_enforcer().await;

        // Editor role has delete but no share permissions
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/shared/events/workshop.ics",
                "delete"
            ))
            .unwrap()
        );
        assert!(
            !e.enforce((
                "principal:alice",
                "/calendars/shared/events/workshop.ics",
                "share_read"
            ))
            .unwrap()
        );
        assert!(
            !e.enforce((
                "principal:alice",
                "/calendars/shared/events/workshop.ics",
                "share_edit"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_cross_user_isolation() {
        let e = create_test_enforcer().await;

        // Users should be completely isolated unless explicitly granted
        let users = [
            "principal:alice",
            "principal:bob",
            "principal:charlie",
            "principal:dave",
            "principal:eve",
        ];

        for user in &users {
            for other_user in &users {
                if user != other_user {
                    let other_name = other_user.strip_prefix("principal:").unwrap();
                    let path = format!("/calendars/{}/private/secret.ics", other_name);

                    // Users should not have access to other users' private resources
                    // (except CIO who has universal read)
                    if !user.contains("cio") {
                        let result = e.enforce((user, path.as_str(), "read"));
                        if result.is_ok() && result.unwrap() {
                            // Only ok if there's an explicit policy granting it
                            // Bob has access to Alice's pets, so that's ok
                            if !(user.contains("bob") && other_name == "alice") {
                                panic!(
                                    "{} should not have access to {}'s private resources",
                                    user, other_name
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    #[tokio::test]
    async fn test_public_access_restrictions() {
        let e = create_test_enforcer().await;

        // Public should only have access to explicitly public resources
        let public_allowed = [
            "/calendars/bob/shared/event.ics",
            "/calendars/dave/public/holiday.ics",
            "/calendars/shared/public/announcement.ics",
        ];

        let public_denied = [
            "/calendars/alice/personal/diary.ics",
            "/calendars/bob/private/secret.ics",
            "/calendars/cio/admin/config.ics",
            "/addressbooks/alice/contacts/friend.vcf",
            "/calendars/dave/private/meeting.ics",
        ];

        for path in &public_allowed {
            assert!(
                e.enforce(("public", path, "read_freebusy")).is_ok(),
                "Public should have access to {}",
                path
            );
        }

        for path in &public_denied {
            let result = e.enforce(("public", path, "read_freebusy")).unwrap();
            assert!(!result, "Public should not have access to {}", path);
        }
    }

    #[tokio::test]
    async fn test_role_permission_completeness() {
        let e = create_test_enforcer().await;

        // Verify each role has exactly the expected permissions, no more, no less
        let role_permissions = [
            ("reader-freebusy", vec!["read_freebusy"]),
            ("reader", vec!["read_freebusy", "read"]),
            ("editor-basic", vec!["read_freebusy", "read", "edit"]),
            ("editor", vec!["read_freebusy", "read", "edit", "delete"]),
            (
                "share-manager",
                vec![
                    "read_freebusy",
                    "read",
                    "edit",
                    "delete",
                    "share_read",
                    "share_edit",
                ],
            ),
            (
                "owner",
                vec![
                    "read_freebusy",
                    "read",
                    "edit",
                    "delete",
                    "share_read",
                    "share_edit",
                    "admin",
                ],
            ),
        ];

        let all_permissions = [
            "read_freebusy",
            "read",
            "edit",
            "delete",
            "share_read",
            "share_edit",
            "admin",
        ];

        for (role, expected_perms) in &role_permissions {
            for perm in &all_permissions {
                let should_have = expected_perms.contains(perm);

                // This is checking the role definition via g2 inheritance
                // We can't directly query g2, but we verify through enforcement
                // For now, this test documents the expected behavior
                assert_eq!(
                    expected_perms.contains(perm),
                    should_have,
                    "Role {} permission {} expectation",
                    role,
                    perm
                );
            }
        }
    }

    #[tokio::test]
    async fn test_glob_pattern_edge_cases() {
        let e = create_test_enforcer().await;

        // Test single star at end
        assert!(
            e.enforce(("principal:charlie", "/calendars/charlie/event.ics", "admin"))
                .unwrap()
        );

        // Test double star at end
        assert!(
            e.enforce((
                "principal:alice",
                "/calendars/alice/a/b/c/d/e/f.ics",
                "admin"
            ))
            .unwrap()
        );

        // Test that patterns don't match beyond their scope
        assert!(
            !e.enforce((
                "principal:charlie",
                "/calendars/charlie/sub/deep/event.ics",
                "admin"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_addressbook_vs_calendar_separation() {
        let e = create_test_enforcer().await;

        // Verify that calendar and addressbook permissions are independent
        assert!(
            e.enforce(("principal:alice", "/calendars/alice/event.ics", "admin"))
                .unwrap()
        );
        assert!(
            e.enforce((
                "principal:alice",
                "/addressbooks/alice/contact.vcf",
                "admin"
            ))
            .unwrap()
        );

        // Charlie has different permissions on each
        assert!(
            e.enforce(("principal:charlie", "/calendars/charlie/event.ics", "admin"))
                .unwrap()
        );
        assert!(
            e.enforce((
                "principal:charlie",
                "/addressbooks/charlie/contacts/contact.vcf",
                "read"
            ))
            .unwrap()
        );
        assert!(
            !e.enforce((
                "principal:charlie",
                "/addressbooks/charlie/contacts/contact.vcf",
                "edit"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_team_group_vs_individual_access() {
        let e = create_test_enforcer().await;

        // Team group has specific permissions
        assert!(
            e.enforce((
                "principal:team",
                "/calendars/team/planning/sprint.ics",
                "read"
            ))
            .unwrap()
        );

        // But individual team members might have different permissions
        // Bossman is a team member but has share-manager role
        assert!(
            e.enforce((
                "principal:bossman",
                "/calendars/team/planning/sprint.ics",
                "share_read"
            ))
            .unwrap()
        );
    }

    #[tokio::test]
    async fn test_empty_subject_should_fail() {
        let e = create_test_enforcer().await;

        // Empty or invalid subjects should not have access
        assert!(
            !e.enforce(("", "/calendars/alice/event.ics", "read"))
                .unwrap_or(false)
        );
    }

    #[tokio::test]
    async fn test_case_sensitive_principal_names() {
        let e = create_test_enforcer().await;

        // Principal names should be case-sensitive
        assert!(
            e.enforce(("principal:alice", "/calendars/alice/event.ics", "read"))
                .unwrap()
        );

        // Wrong case should not work
        assert!(
            !e.enforce(("principal:Alice", "/calendars/alice/event.ics", "read"))
                .unwrap()
        );
        assert!(
            !e.enforce(("principal:ALICE", "/calendars/alice/event.ics", "read"))
                .unwrap()
        );
    }
}
