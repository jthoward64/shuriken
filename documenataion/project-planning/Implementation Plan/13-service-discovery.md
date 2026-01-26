# 13. Service Discovery

## 13.1 Well-Known URIs (RFC 6764)

| URI | Target |
|-----|--------|
| `/.well-known/caldav` | CalDAV context path |
| `/.well-known/carddav` | CardDAV context path |

Server MUST redirect (e.g., 301/303/307) to the actual service root.

## 13.2 Principal Discovery

**Flow**:
1. Client accesses well-known URI → redirect to context path
2. PROPFIND on context path for `DAV:current-user-principal`
3. PROPFIND on principal for `CALDAV:calendar-home-set` / `CARDDAV:addressbook-home-set`
4. PROPFIND on home set for calendar/addressbook collections

## 13.3 DNS SRV Records (RFC 6764)

```
_caldavs._tcp.example.com. SRV 0 1 443 caldav.example.com.
_carddavs._tcp.example.com. SRV 0 1 443 carddav.example.com.
```

TXT record for context path:
```
_caldavs._tcp.example.com. TXT "path=/caldav"
```

---
