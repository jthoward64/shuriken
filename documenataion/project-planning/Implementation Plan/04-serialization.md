# 4. Serialization

## 4.1 iCalendar Serialization

### 4.1.1 Content Line Formatting

1. Construct `NAME[;PARAM=VALUE]*:VALUE`
2. Fold at 75 octets (not breaking UTF-8 sequences)
3. Terminate with `CRLF`

```rust
fn serialize_property(prop: &ICalProperty) -> String {
    let mut line = prop.name.clone();
    for param in &prop.params {
        line.push(';');
        line.push_str(&param.name);
        line.push('=');
        // Quote if contains special chars
        line.push_str(&serialize_param_value(&param.values));
    }
    line.push(':');
    line.push_str(&serialize_value(&prop.value, &prop.name));
    fold_line(&line)
}

fn fold_line(line: &str) -> String {
    // Fold at 75 octets, insert CRLF + SPACE
    // Ensure UTF-8 boundaries respected
}
```

### 4.1.2 Canonical Ordering

For deterministic output (important for ETags):
1. VCALENDAR properties first (PRODID, VERSION, CALSCALE, METHOD)
2. VTIMEZONE components
3. Other components in UID order, then RECURRENCE-ID order
4. Properties within components in defined order

## 4.2 vCard Serialization

**Implementation Path**: `src/component/rfc/vcard/`

### 4.2.1 Content Line Formatting

Same general rules as iCalendar with vCard-specific considerations:

```rust
fn serialize_vcard_property(prop: &VCardProperty) -> String {
    let mut line = String::new();
    
    // Property group prefix
    if let Some(ref group) = prop.group {
        line.push_str(group);
        line.push('.');
    }
    
    // Property name
    line.push_str(&prop.name);
    
    // Parameters
    for param in &prop.params {
        line.push(';');
        line.push_str(&param.name);
        line.push('=');
        line.push_str(&serialize_vcard_param_value(&param.values));
    }
    
    // Value
    line.push(':');
    line.push_str(&serialize_vcard_value(&prop.value, &prop.name));
    
    fold_line(&line)
}
```

### 4.2.2 Value Escaping

```rust
fn escape_vcard_text(s: &str) -> String {
    let mut result = String::with_capacity(s.len() + 10);
    for c in s.chars() {
        match c {
            '\\' => result.push_str("\\\\"),
            ',' => result.push_str("\\,"),
            ';' => result.push_str("\\;"),
            '\n' => result.push_str("\\n"),
            _ => result.push(c),
        }
    }
    result
}

fn escape_vcard_component(s: &str) -> String {
    // For compound property fields (N, ADR, ORG)
    // Escape backslash, comma, semicolon, newline
    escape_vcard_text(s)
}
```

### 4.2.3 Structured Value Serialization

```rust
fn serialize_structured_name(n: &StructuredName) -> String {
    let components = [
        serialize_list_component(&n.family),
        serialize_list_component(&n.given),
        serialize_list_component(&n.additional),
        serialize_list_component(&n.prefixes),
        serialize_list_component(&n.suffixes),
    ];
    components.join(";")
}

fn serialize_list_component(values: &[String]) -> String {
    values.iter()
        .map(|v| escape_vcard_component(v))
        .collect::<Vec<_>>()
        .join(",")
}

fn serialize_address(adr: &Address) -> String {
    let components = [
        serialize_list_component(&adr.po_box),
        serialize_list_component(&adr.extended),
        serialize_list_component(&adr.street),
        serialize_list_component(&adr.locality),
        serialize_list_component(&adr.region),
        serialize_list_component(&adr.postal_code),
        serialize_list_component(&adr.country),
    ];
    components.join(";")
}
```

### 4.2.4 Parameter Value Serialization

```rust
fn serialize_vcard_param_value(values: &[String]) -> String {
    values.iter()
        .map(|v| {
            // Quote if contains special characters
            if needs_quoting(v) {
                format!("\"{}\"", v)
            } else {
                v.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(",")
}

fn needs_quoting(s: &str) -> bool {
    s.chars().any(|c| matches!(c, ':' | ';' | ',' | '"'))
}
```

### 4.2.5 Canonical Ordering

For deterministic output:

```rust
fn serialize_vcard(vcard: &VCard) -> String {
    let mut result = String::new();
    result.push_str("BEGIN:VCARD\r\n");
    result.push_str("VERSION:4.0\r\n");
    
    // Group properties by group prefix
    let mut grouped: BTreeMap<Option<&str>, Vec<&VCardProperty>> = BTreeMap::new();
    for prop in &vcard.properties {
        if prop.name != "VERSION" {
            grouped.entry(prop.group.as_deref())
                .or_default()
                .push(prop);
        }
    }
    
    // Output ungrouped properties first in defined order
    let property_order = [
        "FN", "N", "NICKNAME", "PHOTO", "BDAY", "ANNIVERSARY", "GENDER",
        "ADR", "TEL", "EMAIL", "IMPP", "LANG", "TZ", "GEO",
        "TITLE", "ROLE", "LOGO", "ORG", "MEMBER", "RELATED",
        "CATEGORIES", "NOTE", "PRODID", "REV", "SOUND", "UID",
        "CLIENTPIDMAP", "URL", "KEY", "FBURL", "CALADRURI", "CALURI",
    ];
    
    if let Some(props) = grouped.remove(&None) {
        for name in &property_order {
            for prop in &props {
                if prop.name.eq_ignore_ascii_case(name) {
                    result.push_str(&serialize_vcard_property(prop));
                }
            }
        }
        // X-properties and unknown properties last
        for prop in &props {
            if !property_order.iter().any(|n| prop.name.eq_ignore_ascii_case(n)) {
                result.push_str(&serialize_vcard_property(prop));
            }
        }
    }
    
    // Output grouped properties together
    for (group, props) in grouped {
        // Same ordering within group
        // ...
    }
    
    result.push_str("END:VCARD\r\n");
    result
}
```

### 4.2.6 vCard 4.0 to 3.0 Conversion

For clients requesting vCard 3.0:

| vCard 4.0 | vCard 3.0 | Conversion |
|-----------|-----------|------------|
| data: URI | ENCODING=B | Extract base64 from data: URI |
| PREF=1 | TYPE=PREF | Convert preference |
| VALUE=uri (TEL) | VALUE=uri (keep) or text | May need adjustment |
| KIND=group | X-ADDRESSBOOKSERVER-KIND | Apple compatibility |
| RELATED | X-* or drop | No direct equivalent |
| GENDER | X-GENDER | Custom property |

```rust
fn convert_v4_to_v3(v4: &VCard) -> VCard {
    let mut v3 = VCard::new();
    v3.add_property("VERSION", "3.0");
    
    for prop in &v4.properties {
        if prop.name == "VERSION" {
            continue;
        }
        
        let converted = match prop.name.as_str() {
            "KIND" if prop.value_text() == "group" => {
                VCardProperty::new("X-ADDRESSBOOKSERVER-KIND", "group")
            }
            "PHOTO" | "LOGO" | "SOUND" | "KEY" => {
                convert_media_property(prop)
            }
            _ => {
                convert_parameters_v4_to_v3(prop.clone())
            }
        };
        v3.properties.push(converted);
    }
    v3
}
```

## 4.3 WebDAV XML Serialization

Generate XML responses:

```rust
pub struct MultistatusResponse {
    pub responses: Vec<DavResponse>,
}

pub struct DavResponse {
    pub href: String,
    pub propstats: Vec<Propstat>,
    pub error: Option<DavError>,
}

pub struct Propstat {
    pub props: Vec<(QName, PropValue)>,
    pub status: StatusCode,
}
```

Use `quick-xml` writer with proper namespace handling.

---
