//! Custom `PostgreSQL` type mappings for Diesel
//!
//! This module provides type-safe wrappers for `PostgreSQL` types that don't have
//! direct Rust equivalents in the standard library.

use diesel::deserialize::{self, FromSql};
use diesel::pg::{Pg, PgValue};
use diesel::serialize::{self, IsNull, Output, ToSql};
use diesel::sql_types::{Interval, Range, Timestamptz};
use diesel::{AsExpression, FromSqlRow};
use std::io::Write;

/// Wrapper for `PostgreSQL` INTERVAL type
///
/// Represents a `PostgreSQL` INTERVAL as microseconds. This aligns with how
/// `PostgreSQL` stores intervals internally and allows for precise duration arithmetic.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, AsExpression, FromSqlRow)]
#[diesel(sql_type = Interval)]
pub struct PgInterval {
    /// Total microseconds in the interval
    pub microseconds: i64,
    /// Days component (separate from microseconds due to variable day length)
    pub days: i32,
    /// Months component (separate due to variable month length)
    pub months: i32,
}

impl PgInterval {
    /// Create a new interval from components
    #[must_use]
    pub const fn new(months: i32, days: i32, microseconds: i64) -> Self {
        Self {
            microseconds,
            days,
            months,
        }
    }

    /// Create an interval from a duration in seconds
    #[must_use]
    pub const fn from_seconds(seconds: i64) -> Self {
        Self {
            microseconds: seconds * 1_000_000,
            days: 0,
            months: 0,
        }
    }

    /// Create an interval from days
    #[must_use]
    pub const fn from_days(days: i32) -> Self {
        Self {
            microseconds: 0,
            days,
            months: 0,
        }
    }
}

impl FromSql<Interval, Pg> for PgInterval {
    fn from_sql(bytes: PgValue<'_>) -> deserialize::Result<Self> {
        // PostgreSQL INTERVAL is stored as 16 bytes:
        // - 8 bytes: microseconds (i64)
        // - 4 bytes: days (i32)
        // - 4 bytes: months (i32)
        let bytes = bytes.as_bytes();
        if bytes.len() != 16 {
            return Err("Invalid INTERVAL byte length".into());
        }

        let microseconds = i64::from_be_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        ]);
        let days = i32::from_be_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]);
        let months = i32::from_be_bytes([bytes[12], bytes[13], bytes[14], bytes[15]]);

        Ok(Self {
            microseconds,
            days,
            months,
        })
    }
}

impl ToSql<Interval, Pg> for PgInterval {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Pg>) -> serialize::Result {
        out.write_all(&self.microseconds.to_be_bytes())?;
        out.write_all(&self.days.to_be_bytes())?;
        out.write_all(&self.months.to_be_bytes())?;
        Ok(IsNull::No)
    }
}

/// Wrapper for `PostgreSQL` TSTZRANGE (timestamp with timezone range) type
///
/// Represents a range of timestamps with timezone. `PostgreSQL` ranges can be inclusive
/// or exclusive on either bound.
#[derive(Debug, Clone, PartialEq, Eq, AsExpression, FromSqlRow)]
#[diesel(sql_type = Range<Timestamptz>)]
pub struct PgTstzRange {
    /// Lower bound of the range (None = unbounded)
    pub lower: Option<chrono::DateTime<chrono::Utc>>,
    /// Upper bound of the range (None = unbounded)
    pub upper: Option<chrono::DateTime<chrono::Utc>>,
    /// Whether lower bound is inclusive (true) or exclusive (false)
    pub lower_inclusive: bool,
    /// Whether upper bound is inclusive (true) or exclusive (false)
    pub upper_inclusive: bool,
}

impl PgTstzRange {
    /// Create a new range with specified bounds and inclusivity
    #[must_use]
    pub const fn new(
        lower: Option<chrono::DateTime<chrono::Utc>>,
        upper: Option<chrono::DateTime<chrono::Utc>>,
        lower_inclusive: bool,
        upper_inclusive: bool,
    ) -> Self {
        Self {
            lower,
            upper,
            lower_inclusive,
            upper_inclusive,
        }
    }

    /// Create an inclusive range [lower, upper]
    #[must_use]
    pub const fn inclusive(
        lower: chrono::DateTime<chrono::Utc>,
        upper: chrono::DateTime<chrono::Utc>,
    ) -> Self {
        Self {
            lower: Some(lower),
            upper: Some(upper),
            lower_inclusive: true,
            upper_inclusive: true,
        }
    }

    /// Create a half-open range [lower, upper)
    #[must_use]
    pub const fn half_open(
        lower: chrono::DateTime<chrono::Utc>,
        upper: chrono::DateTime<chrono::Utc>,
    ) -> Self {
        Self {
            lower: Some(lower),
            upper: Some(upper),
            lower_inclusive: true,
            upper_inclusive: false,
        }
    }
}

impl FromSql<Range<Timestamptz>, Pg> for PgTstzRange {
    #[expect(clippy::too_many_lines)] // Complex binary parsing logic, difficult to split meaningfully
    #[expect(clippy::cast_sign_loss)] // PostgreSQL length prefixes are i32 but always non-negative
    #[expect(clippy::similar_names)] // lower_inc/lower_inf and upper_inc/upper_inf are standard range terminology
    fn from_sql(bytes: PgValue<'_>) -> deserialize::Result<Self> {
        // PostgreSQL range format:
        // 1 byte: flags (bit 0 = empty, bit 3 = lower inclusive, bit 4 = upper inclusive,
        //                bit 5 = lower infinite, bit 6 = upper infinite)
        // For non-empty, non-infinite bounds: 4-byte length prefix + timestamp bytes
        let bytes = bytes.as_bytes();
        if bytes.is_empty() {
            return Err("Empty TSTZRANGE bytes".into());
        }

        let flags = bytes[0];
        let empty = (flags & 0x01) != 0;
        if empty {
            return Err("Empty ranges not supported yet".into());
        }

        let lower_inc = (flags & 0x08) != 0;
        let upper_inc = (flags & 0x10) != 0;
        let lower_inf = (flags & 0x20) != 0;
        let upper_inf = (flags & 0x40) != 0;

        let mut offset = 1;

        let lower = if lower_inf {
            None
        } else {
            if offset + 4 > bytes.len() {
                return Err("Invalid TSTZRANGE lower bound".into());
            }
            let len = i32::from_be_bytes([
                bytes[offset],
                bytes[offset + 1],
                bytes[offset + 2],
                bytes[offset + 3],
            ]) as usize;
            offset += 4;

            if offset + len > bytes.len() {
                return Err("Invalid TSTZRANGE lower bound length".into());
            }

            let micros = i64::from_be_bytes([
                bytes[offset],
                bytes[offset + 1],
                bytes[offset + 2],
                bytes[offset + 3],
                bytes[offset + 4],
                bytes[offset + 5],
                bytes[offset + 6],
                bytes[offset + 7],
            ]);
            offset += len;

            // PostgreSQL epoch is 2000-01-01, convert to Unix epoch
            let pg_epoch_offset = 946_684_800_000_000i64; // microseconds
            let unix_micros = micros + pg_epoch_offset;
            let timestamp =
                chrono::DateTime::from_timestamp_micros(unix_micros).ok_or("Invalid timestamp")?;
            Some(timestamp)
        };

        let upper = if upper_inf {
            None
        } else {
            if offset + 4 > bytes.len() {
                return Err("Invalid TSTZRANGE upper bound".into());
            }
            let len = i32::from_be_bytes([
                bytes[offset],
                bytes[offset + 1],
                bytes[offset + 2],
                bytes[offset + 3],
            ]) as usize;
            offset += 4;

            if offset + len > bytes.len() {
                return Err("Invalid TSTZRANGE upper bound length".into());
            }

            let micros = i64::from_be_bytes([
                bytes[offset],
                bytes[offset + 1],
                bytes[offset + 2],
                bytes[offset + 3],
                bytes[offset + 4],
                bytes[offset + 5],
                bytes[offset + 6],
                bytes[offset + 7],
            ]);

            let pg_epoch_offset = 946_684_800_000_000i64;
            let unix_micros = micros + pg_epoch_offset;
            let timestamp =
                chrono::DateTime::from_timestamp_micros(unix_micros).ok_or("Invalid timestamp")?;
            Some(timestamp)
        };

        Ok(Self {
            lower,
            upper,
            lower_inclusive: lower_inc,
            upper_inclusive: upper_inc,
        })
    }
}

impl ToSql<Range<Timestamptz>, Pg> for PgTstzRange {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Pg>) -> serialize::Result {
        let mut flags = 0u8;

        if self.lower_inclusive {
            flags |= 0x08;
        }
        if self.upper_inclusive {
            flags |= 0x10;
        }
        if self.lower.is_none() {
            flags |= 0x20;
        }
        if self.upper.is_none() {
            flags |= 0x40;
        }

        out.write_all(&[flags])?;

        if let Some(lower) = self.lower {
            let pg_epoch_offset = 946_684_800_000_000i64;
            let unix_micros = lower.timestamp_micros();
            let pg_micros = unix_micros - pg_epoch_offset;

            out.write_all(&8i32.to_be_bytes())?; // timestamp is 8 bytes
            out.write_all(&pg_micros.to_be_bytes())?;
        }

        if let Some(upper) = self.upper {
            let pg_epoch_offset = 946_684_800_000_000i64;
            let unix_micros = upper.timestamp_micros();
            let pg_micros = unix_micros - pg_epoch_offset;

            out.write_all(&8i32.to_be_bytes())?;
            out.write_all(&pg_micros.to_be_bytes())?;
        }

        Ok(IsNull::No)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pg_interval_constructors() {
        let interval = PgInterval::from_seconds(3600);
        assert_eq!(interval.microseconds, 3_600_000_000);
        assert_eq!(interval.days, 0);
        assert_eq!(interval.months, 0);

        let interval = PgInterval::from_days(7);
        assert_eq!(interval.microseconds, 0);
        assert_eq!(interval.days, 7);
        assert_eq!(interval.months, 0);
    }

    #[test]
    fn pg_tstzrange_constructors() {
        let now = chrono::Utc::now();
        let later = now + chrono::Duration::hours(1);

        let range = PgTstzRange::inclusive(now, later);
        assert_eq!(range.lower, Some(now));
        assert_eq!(range.upper, Some(later));
        assert!(range.lower_inclusive);
        assert!(range.upper_inclusive);

        let range = PgTstzRange::half_open(now, later);
        assert!(range.lower_inclusive);
        assert!(!range.upper_inclusive);
    }
}
