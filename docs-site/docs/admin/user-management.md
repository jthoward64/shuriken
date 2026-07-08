---
sidebar_position: 5
---

# User & role management

## Roles

Three roles (`src/services/role/policy.ts`), stored as free text so new
roles never require a schema migration:

| Role | Behavior |
|---|---|
| `normal` (default) | No special virtual-resource grants. |
| `admin` | Granted `DAV:all` on the Users and Groups virtual resources — can manage other users/groups via the UI. |
| `super_admin` | Same grants as `admin`, **plus bypasses every ACL check entirely**. |

Grants are idempotent and re-applied whenever a user is provisioned or
promoted (`ProvisioningService.ensureAdminAces`).

## Creating and managing users

- **Automatically**: the [first-boot admin](./authentication), or OIDC
  auto-provisioning on first SSO login.
- **Manually**, via the admin UI at `/ui/users` (requires `admin` or
  `super_admin`): create/edit/delete accounts, set passwords, assign
  roles (role reassignment itself is restricted to `super_admin`),
  manage a user's group memberships, and create collections owned by
  that user. Use this when `OIDC_AUTO_PROVISION=false` and you want to
  pre-provision accounts before allowing SSO login.
- Provisioning a user (`ProvisioningService.provisionUser`) always
  creates their default calendar, address book, and CalDAV scheduling
  inbox/outbox alongside the account.

## Groups

Groups (`/ui/groups`, `src/services/group/`) are principal-like
entities that can hold ACL grants and own collections just like a user
can — granting a group access effectively shares with every member.
Each group can optionally declare `oidcGroups` claim names for
automatic membership sync from SSO (see [Authentication](./authentication#role-sync-from-idp-groups));
members added this way are marked "auto-assigned by OIDC" in the UI,
distinguishing them from manually-added members.

## App passwords

Per-device credentials (`src/services/app-password/`) that let a DAV
client authenticate without ever knowing the user's real password/SSO
identity. Users self-manage these at `/ui/profile/app-passwords`: each
one gets a machine-generated username (`ap-<random>`) and a
one-time-shown secret — neither is recoverable after generation, only
revocable. This is the primary connection method for SSO (OIDC) users.
