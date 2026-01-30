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

## User Registration

Users can register via the `/app/auth/register` endpoint:

**Endpoint:** `POST /app/auth/register`

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
  "email": "john@example.com",
  "name": "John Doe"
}
```

**Error Response (400 Bad Request):**
```json
{
  "error": "Email already registered"
}
```

## Testing Login (Optional)

To verify credentials, use the `/app/auth/login` endpoint:

**Endpoint:** `POST /app/auth/login`

**Request Body:**
```json
{
  "email": "john@example.com",
  "password": "secure_password_123"
}
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "user_id": "01930bb2-...",
  "email": "john@example.com",
  "name": "John Doe",
  "message": "Login successful. Use HTTP Basic Auth for CalDAV/CardDAV requests."
}
```

## Using Basic Authentication

### With CalDAV/CardDAV Clients

Configure your CalDAV/CardDAV client with:
- **Server URL:** `http://localhost:8698/dav/` (or your server URL)
- **Username:** Your email address (e.g., `john@example.com`)
- **Password:** Your password

The client will automatically send HTTP Basic Authentication headers with each request.

### With cURL

```bash
# Register a user
curl -X POST http://localhost:8698/app/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"John Doe","email":"john@example.com","password":"secure123"}'

# Test login
curl -X POST http://localhost:8698/app/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"john@example.com","password":"secure123"}'

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
6. On success, user is authenticated and can access resources

### Security Features

- **Argon2id**: Memory-hard and side-channel resistant password hashing
- **Random salts**: Each password gets a unique salt
- **Constant-time comparison**: Argon2 verifier uses constant-time comparison to prevent timing attacks
- **No plaintext storage**: Passwords are never stored in plaintext
- **Single hash per user**: One `auth_user` record per authentication method

## Code Structure

### New Files

- `crates/shuriken-service/src/auth/password.rs` - Password hashing and verification utilities
- `crates/shuriken-app/src/app/api/app_specific/auth.rs` - Registration and login endpoints

### Modified Files

- `Cargo.toml` - Added `argon2` dependency
- `crates/shuriken-core/src/config.rs` - Added `BasicAuth` authentication method
- `crates/shuriken-service/src/auth/mod.rs` - Added password module
- `crates/shuriken-service/src/auth/authenticate.rs` - Added `authenticate_basic_auth()` function
- `crates/shuriken-app/src/app/api/app_specific/mod.rs` - Added auth routes

## Testing

Unit tests for password hashing are included in `password.rs`:

```bash
cargo test -p shuriken-service password
```

All tests should pass:
- ✅ `test_hash_and_verify_password` - Verifies correct password validates
- ✅ `test_hash_generates_different_salts` - Ensures unique salts per hash
- ✅ `test_verify_invalid_hash_format` - Handles malformed hashes gracefully

## Migration from SingleUser

If you were using `single_user` authentication and want to switch to `basic_auth`:

1. Register the single user via `/app/auth/register` with their email and a new password
2. Update configuration to use `basic_auth` method
3. Update clients to use HTTP Basic Authentication

## Future Enhancements

Potential improvements for future implementation:
- Password strength requirements/validation
- Password reset flow
- Account lockout after failed attempts
- Session tokens (optional, for web clients)
- OAuth2 integration
- Multi-factor authentication (MFA)
