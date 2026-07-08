---
sidebar_position: 11
---

# Roles

Every account has a role, shown on your profile if you're an admin:

- **Normal** — the default; full access to your own data plus anything
  shared with you.
- **Admin** — can also manage other users and groups from the **Users**
  and **Groups** admin pages.
- **Super admin** — full administrative access to everything on the
  server, including bypassing normal access-control restrictions.

Only a super admin can change someone's role. If your organization uses
single sign-on, your role may be automatically kept in sync with your
identity provider's group memberships — in that case, changing groups
in your organization's directory (not in shuriken-ts) is the way to
change your access level.
