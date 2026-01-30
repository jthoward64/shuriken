# Basic Authentication Implementation

This document describes the basic authentication implementation using password hashing with Argon2.

## Overview

Shuriken now supports three authentication methods:
1. **SingleUser** - Single user configuration (for testing/development)
2. **BasicAuth** - HTTP Basic Authentication with password hashing (NEW)
3. **Proxy** - Proxy authentication (not yet implemented)

## Configuration

To enable basic authentication, set the authentication method in your `config.toml` or environment variables:

```toml
[auth]
method = "basic_auth"
```

Or via environment variable:
```bash
AUTH_METHOD=basic_auth
```

## User Management

### Authorization-Based Access

User management endpoints are protected by ACL permissions. Only authenticated users with appropriate permissions can create or modify users:

- **Creating users**: Requires `Admin` access to `/calendars/**` (typically administrators)
- **Updating passwords**: Requires `Edit` access to `/calendars/{principal_id}/**` for the target user

This means:
- Administrators can create new users and manage all user passwords
- Users can update their own password (if they have edit access to their own resources)
- No public registration endpoint - all user creation is controlled via ACLs

### Creating Users

**Endpoint:** `POST /app/users`  
**Authorization:** Requires Admin permissions

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "secure_password_123"
}
```

**Success Response (201 Created):**
```json
{
  "user_id": "01930bb2-...",
  "principal_id": "01930bb2-...",
  "email": "john@example.com",
  "name": "John Doe"
}
```

**Error Responses:**
- **401 Unauthorized**: Not authenticated
- **403 Forbidden**: Insufficient permissions to create users
- **400 Bad Request**: Email already registered or invalid input
- **500 Internal Server Error**: Database error

### Updating Passwords

**Endpoint:** `PUT /app/users/{user_id}/password`  
**Authorization:** Requires Edit permissions for the target user's principal

**Request Body:**
```json
{
  "password": "new_secure_password_456"
}
```

**Success Response (200 OK):**
```json
{
  "user_id": "01930bb2-...",
  "principal_id": "01930bb2-...",
  "email": "john@example.com",
  "name": "John Doe"
}
```

**Error Responses:**
- **401 Unauthorized**: Not authenticated
- **403 Forbidden**: Insufficient permissions to update this user's password
- **404 Not Found**: User not found
- **400 Bad Request**: Invalid input
- **500 Internal Server Error**: Database error

## Using Basic Authentication

### With CalDAV/CardDAV Clients

Configure your CalDAV/CardDAV client with:
- **Server URL:** `http://localhost:8698/dav/` (or your server URL)
- **Username:** Your email address (e.g., `john@example.com`)
- **Password:** Your password

The client will automatically send HTTP Basic Authentication headers with each request.

### With cURL

```bash
# First, authenticate as an admin user to create a new user
curl -X POST http://localhost:8698/app/users \
  -u admin@example.com:admin_password \
  -H "Content-Type: application/json" \
  -d '{"name":"John Doe","email":"john@example.com","password":"secure123"}'

# Update a user's password (as admin or the user themselves)
curl -X PUT http://localhost:8698/app/users/01930bb2-.../password \
  -u admin@example.com:admin_password \
  -H "Content-Type: application/json" \
  -d '{"password":"new_secure123"}'

# User updating their own password
curl -X PUT http://localhost:8698/app/users/01930bb2-.../password \
  -u john@example.com:old_password \
  -H "Content-Type: application/json" \
  -d '{"password":"new_password"}'

# Make authenticated CalDAV request
curl -X PROPFIND http://localhost:8698/dav/cal/user-principal/ \
  -u john@example.com:secure123 \
  -H "Depth: 0"
```

## Implementation Details

### Password Storage

Passwords are hashed using **Argon2id** (the latest Argon2 variant) with the following characteristics:
- Random salt generated for each password
- Salt and hash stored together in PHC string format
- Stored in `auth_user` table:
  - `auth_source`: `"password"`
  - `auth_id`: Argon2 hash string (e.g., `$argon2id$v=19$m=...`)

### Database Schema

The implementation uses the existing `auth_user` table:

```sql
CREATE TABLE auth_user (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    user_id UUID NOT NULL REFERENCES "user"(id),
    auth_source TEXT NOT NULL,  -- "password" for basic auth
    auth_id TEXT NOT NULL,      -- Argon2 hash for passwords
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Authentication Flow

1. Client sends HTTP Basic Authentication header: `Authorization: Basic base64(email:password)`
2. Server extracts and decodes credentials
3. Server looks up user by email
4. Server finds corresponding `auth_user` record with `auth_source = "password"`
5. Server verifies password against Argon2 hash stored in `auth_id`
6. On success, user is authenticated and can access resources based on their ACL permissions

### Authorization for User Management

User management follows Shuriken's ACL-based authorization model:

1. **Create User**: Checks for `Admin` action on `/calendars/**`
   - Only users with admin permissions across all calendars can create users
   - This is typically granted to system administrators

2. **Update Password**: Checks for `Edit` action on `/calendars/{principal_id}/**`
   - Users with edit permissions on a principal's resources can update that principal's password
   - This allows users to update their own password
   - Administrators with wildcard permissions can update any user's password

### Security Features

- **Argon2id**: Memory-hard and side-channel resistant password hashing
- **Random salts**: Each password gets a unique salt
- **Constant-time comparison**: Argon2 verifier uses constant-time comparison to prevent timing attacks
- **No plaintext storage**: Passwords are never stored in plaintext
- **Single hash per user**: One `auth_user` record per authentication method
- **ACL-based access control**: All user management operations require appropriate permissions

## Code Structure

### New Files

- `crates/shuriken-service/src/auth/password.rs` - Password hashing and verification utilities
- `crates/shuriken-app/src/app/api/app_specific/users.rs` - User management endpoints

### Modified Files

- `Cargo.toml` - Added `argon2` dependency
- `crates/shuriken-core/src/config.rs` - Added `BasicAuth` authentication method
- `crates/shuriken-service/src/auth/mod.rs` - Added password module
- `crates/shuriken-service/src/auth/authenticate.rs` - Added `authenticate_basic_auth()` function
- `crates/shuriken-app/src/app/api/app_specific/mod.rs` - Added users routes

## Testing

Unit tests for password hashing are included in `password.rs`:

```bash
cargo test -p shuriken-service password
```

All tests should pass:
- ✅ `test_hash_and_verify_password` - Verifies correct password validates
- ✅ `test_hash_generates_different_salts` - Ensures unique salts per hash
- ✅ `test_verify_invalid_hash_format` - Handles malformed hashes gracefully

## Initial Setup

For initial setup, you'll need to create the first administrator user manually via database or single_user auth:

1. **Option 1: Use single_user temporarily**
   ```toml
   [auth]
   method = "single_user"
   
   [auth.single_user]
   name = "Admin"
   email = "admin@example.com"
   ```
   
   Then use this admin account to create other users via the API, grant permissions, and switch to basic_auth.

2. **Option 2: Direct database insertion**
   ```sql
   -- Insert principal
   INSERT INTO principal (id, principal_type, slug, display_name)
   VALUES (uuidv7(), 'User', 'admin', 'Admin User');
   
   -- Insert user
   INSERT INTO "user" (name, email, principal_id)
   VALUES ('Admin', 'admin@example.com', '<principal_id>');
   
   -- Insert auth_user with Argon2 hash
   INSERT INTO auth_user (auth_source, auth_id, user_id)
   VALUES ('password', '$argon2id$...', '<user_id>');
   
   -- Grant admin permissions via Casbin policies
   ```

## Future Enhancements

Potential improvements for future implementation:
- Password strength requirements/validation
- Password reset flow with email verification
- Account lockout after failed attempts
- Session tokens (optional, for web clients)
- OAuth2 integration
- Multi-factor authentication (MFA)
- User self-service password change endpoint
- Audit logging for user management operations
