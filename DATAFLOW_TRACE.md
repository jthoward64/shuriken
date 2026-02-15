# vCard Parameter Name Casing - Complete Data Flow Trace

## Problem
Client sends vCard with lowercase parameter names (`EMAIL;type=WORK`), but server returns uppercase (`EMAIL;TYPE=WORK`).

## Data Flow Path

### 1. **Incoming Request** (Client → Server)
```
PUT /api/dav/card/.../1.vcf
Content-Type: text/vcard

BEGIN:VCARD
VERSION:3.0
EMAIL;type=WORK:test@example.com
END:VCARD
```
- **Location**: HTTP request body
- **Casing**: `type` (lowercase)

---

### 2. **HTTP Handler** 
- **File**: `crates/shuriken-app/src/app/api/carddav/method/put/mod.rs:257`
- **Code**: `shuriken_rfc::rfc::vcard::parse::parse_single(vcard_str)`
- **Action**: Parses raw vCard text string

---

### 3. **RFC Parser** 
- **File**: `crates/shuriken-rfc/src/rfc/vcard/parse/lexer.rs:163`
- **Code**: 
```rust
Ok(ContentLine {
    name: name.to_string(),  // ✓ Preserves original casing
    params,
    ...
})
```
- **File**: `crates/shuriken-rfc/src/rfc/vcard/parse/lexer.rs:233`
- **Code**: `VCardParameter::multi(name, values)` → calls constructor

- **File**: `crates/shuriken-rfc/src/rfc/vcard/core/parameter.rs:26`
- **Code**:
```rust
pub fn multi(name: impl Into<String>, values: Vec<String>) -> Self {
    Self {
        name: name.into(),  // ✓ Preserves original casing
        values,
    }
}
```
- **Result**: `VCardParameter { name: "type", values: ["WORK"] }`
- **Casing**: `type` (lowercase) ✓

---

### 4. **Service Layer**
- **File**: `crates/shuriken-service/src/carddav/service/object.rs:189`
- **Code**: `entity::insert_vcard_tree(tx, entity_id, &vcard)`
- **Action**: Passes VCard struct to database layer

---

### 5. **Database Insertion**
- **File**: `crates/shuriken-db/src/db/query/dav/entity/tree_insert.rs:152`
- **Code**:
```rust
let new_parameter = NewDavParameter {
    property_id,
    name: Box::leak(param.name.clone().into_boxed_str()),  // ✓ Uses param.name directly
    value: Box::leak(param_value.into_boxed_str()),
    ordinal: param_ord as i32,
};
```
- **Action**: Inserts into `dav_parameter` table
- **Expected DB value**: `name='type'` (lowercase)

---

### 6. **Database Storage**
- **Table**: `dav_parameter`
- **Column**: `name TEXT NOT NULL`
- **Migration**: `crates/shuriken-db/migrations/2026-01-23-020000-0003_dav_storage/up.sql:255`
- **Schema**: No uppercase constraint, no special collation
- **Expected**: `type` (lowercase)

---

### 7. **Database Retrieval**
- **File**: `crates/shuriken-db/src/db/map/dav/assemble.rs:224`
- **Code**:
```rust
fn build_vcard_parameter(param: DavParameter) -> VCardParameter {
    VCardParameter::multi(param.name, split_param_values(&param.value))
                       // ↑ param.name comes from DB
}
```
- **Action**: Reconstructs `VCardParameter` from `DavParameter` model
- **Expected**: `name='type'` from DB → `VCardParameter { name: "type" }`

---

### 8. **RFC Serialization**
- **File**: `crates/shuriken-db/src/db/map/dav/assemble.rs:119`
- **Code**: `vcard_build::serialize_single(&vcard)`

- **File**: `crates/shuriken-rfc/src/rfc/vcard/build/serializer.rs:196`
- **Code**:
```rust
fn serialize_parameter(param: &VCardParameter, output: &mut String) {
    output.push(';');
    // Preserve original parameter name casing
    output.push_str(&param.name);  // ✓ Uses param.name directly
    output.push('=');
    ...
}
```
- **Expected Output**: `;type=WORK`

---

### 9. **HTTP Response**
```
HTTP/1.1 200 OK
Content-Type: text/vcard

BEGIN:VCARD
VERSION:3.0
EMAIL;type=WORK:test@example.com
END:VCARD
```
- **Expected**: `type` (lowercase)
- **Actual**: `TYPE` (uppercase) ❌

---

## Analysis

All code paths correctly preserve casing:
- ✓ Parser preserves original casing
- ✓ Database insertion uses original casing  
- ✓ Database storage has no uppercase constraint
- ✓ Database retrieval uses stored value
- ✓ Serializer uses parameter name directly

## Hypothesis

Since the code changes are correct but tests still fail with uppercase, one of:

1. **Database already contains uppercase data** - The seed data or previous runs stored uppercase
2. **Parameter constructor is being called with uppercase strings** - Some code is passing uppercase strings to `VCardParameter::new("TYPE", ...)`
3. **Database collation** - Postgres is normalizing to uppercase (unlikely, but possible)

## Next Steps

1. Check actual database content: `SELECT name FROM dav_parameter LIMIT 10;`
2. Add debug logging in serializer to see actual `param.name` value
3. Check if convenience constructors like `VCardParameter::type_param()` use uppercase
4. Verify the binary being run is the newly compiled one
