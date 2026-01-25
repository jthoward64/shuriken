//! Recurrence expansion algorithm (RFC 5545 §3.3.10).
//!
//! This module implements the RRULE expansion algorithm to generate
//! individual occurrences from recurrence rules.

use chrono::{DateTime as ChronoDateTime, Datelike, Duration as ChronoDuration, NaiveDate, Timelike, TimeZone, Utc, Weekday as ChronoWeekday};
use std::collections::HashSet;

use crate::component::rfc::ical::core::{DateTime, RRule, RRuleUntil, Weekday};
use super::timezone::{TimezoneResolver, TimezoneDatabase, Result, TimezoneError};

/// ## Summary
/// Maximum number of instances to generate (safety limit).
///
/// This prevents infinite loops from malformed or extremely long-running rules.
const DEFAULT_MAX_INSTANCES: usize = 10000;

/// ## Summary
/// A set of recurring instances, combining RRULE, RDATE, and EXDATE.
///
/// This represents a complete recurrence set as defined in RFC 5545,
/// including the master recurrence rule, additional dates, and exceptions.
#[derive(Debug, Clone)]
pub struct RecurrenceSet {
    /// The base start datetime for the recurrence.
    pub dtstart: DateTime,
    
    /// The recurrence rule (if any).
    pub rrule: Option<RRule>,
    
    /// Additional recurrence dates (RDATE).
    pub rdates: Vec<DateTime>,
    
    /// Exception dates (EXDATE) - occurrences to exclude.
    pub exdates: Vec<DateTime>,
    
    /// Maximum number of instances to generate.
    pub max_instances: usize,
}

impl RecurrenceSet {
    /// Creates a new recurrence set with the given start datetime.
    #[must_use]
    pub fn new(dtstart: DateTime) -> Self {
        Self {
            dtstart,
            rrule: None,
            rdates: Vec::new(),
            exdates: Vec::new(),
            max_instances: DEFAULT_MAX_INSTANCES,
        }
    }

    /// Sets the recurrence rule.
    #[must_use]
    pub fn with_rrule(mut self, rrule: RRule) -> Self {
        self.rrule = Some(rrule);
        self
    }

    /// Adds an RDATE.
    #[must_use]
    pub fn with_rdate(mut self, rdate: DateTime) -> Self {
        self.rdates.push(rdate);
        self
    }

    /// Adds an EXDATE.
    #[must_use]
    pub fn with_exdate(mut self, exdate: DateTime) -> Self {
        self.exdates.push(exdate);
        self
    }

    /// Sets the maximum number of instances.
    #[must_use]
    pub fn with_max_instances(mut self, max: usize) -> Self {
        self.max_instances = max;
        self
    }

    /// Expands the recurrence set within the given time range.
    ///
    /// ## Errors
    /// Returns an error if timezone conversion fails or the datetime is invalid.
    ///
    /// ## Panics
    /// Panics if the Unix epoch (1970-01-01 00:00:00 UTC) cannot be created,
    /// which should never happen in practice.
    pub fn expand(
        &self,
        range_start: Option<ChronoDateTime<Utc>>,
        range_end: Option<ChronoDateTime<Utc>>,
        tz_db: &TimezoneDatabase,
    ) -> Result<Vec<ChronoDateTime<Utc>>> {
        let mut instances = HashSet::new();

        // Always include DTSTART (unless excluded by EXDATE)
        let dtstart_utc = tz_db.to_utc(&self.dtstart)?;
        instances.insert(dtstart_utc.timestamp());

        // Expand RRULE if present
        if let Some(ref rrule) = self.rrule {
            let expander = RecurrenceExpander::new(self.dtstart.clone(), rrule.clone(), tz_db);
            let rrule_instances = expander.expand(range_start, range_end, self.max_instances)?;
            instances.extend(rrule_instances.iter().map(ChronoDateTime::timestamp));
        }

        // Add RDATE instances
        for rdate in &self.rdates {
            let rdate_utc = tz_db.to_utc(rdate)?;
            instances.insert(rdate_utc.timestamp());
        }

        // Remove EXDATE instances
        let exdate_set: HashSet<i64> = self
            .exdates
            .iter()
            .filter_map(|exdate| tz_db.to_utc(exdate).ok())
            .map(|dt| dt.timestamp())
            .collect();
        
        instances.retain(|ts| !exdate_set.contains(ts));

        // Filter by range
        // Note: Timestamps are derived from valid ChronoDateTime<Utc> instances,
        // so conversion back should always succeed.
        let mut result: Vec<_> = instances
            .into_iter()
            .map(|ts| {
                ChronoDateTime::from_timestamp(ts, 0)
                    .unwrap_or_else(|| {
                        // Fallback: Use Unix epoch as safe default (should never be reached
                        // in normal operation since timestamps come from valid instances).
                        // If this fails, something is critically wrong with timestamp conversion.
                        ChronoDateTime::from_timestamp(0, 0)
                            .expect("Unix epoch (timestamp 0) should always be convertible to DateTime")
                    })
            })
            .filter(|dt| {
                let after_start = range_start.is_none_or(|start| dt >= &start);
                let before_end = range_end.is_none_or(|end| dt < &end);
                after_start && before_end
            })
            .collect();

        result.sort();
        Ok(result)
    }
}

/// ## Summary
/// Expands RRULE into individual occurrences.
///
/// This implements the RFC 5545 recurrence expansion algorithm.
pub struct RecurrenceExpander<'a> {
    dtstart: DateTime,
    rrule: RRule,
    tz_db: &'a TimezoneDatabase,
}

impl<'a> RecurrenceExpander<'a> {
    /// Creates a new recurrence expander.
    #[must_use]
    pub fn new(dtstart: DateTime, rrule: RRule, tz_db: &'a TimezoneDatabase) -> Self {
        Self {
            dtstart,
            rrule,
            tz_db,
        }
    }

    /// Expands the recurrence rule within the given time range.
    ///
    /// ## Errors
    /// Returns an error if timezone conversion fails or datetime arithmetic fails.
    pub fn expand(
        &self,
        range_start: Option<ChronoDateTime<Utc>>,
        range_end: Option<ChronoDateTime<Utc>>,
        max_instances: usize,
    ) -> Result<Vec<ChronoDateTime<Utc>>> {
        // Validate that FREQ is set
        self.rrule.freq.ok_or_else(|| {
            TimezoneError::InvalidDateTime("RRULE missing FREQ".to_string())
        })?;

        let dtstart_utc = self.tz_db.to_utc(&self.dtstart)?;

        // Determine the end boundary
        let until_limit = if let Some(ref until) = self.rrule.until {
            Some(self.until_to_utc(until)?)
        } else {
            range_end
        };

        // Generate base candidates based on frequency
        let mut candidates = self.generate_candidates(dtstart_utc, until_limit, max_instances);

        // Apply BY-rules
        candidates = self.apply_by_rules(candidates);

        // Filter by range
        let result: Vec<_> = candidates
            .into_iter()
            .filter(|dt| {
                let after_start = range_start.is_none_or(|start| dt >= &start);
                let before_end = range_end.is_none_or(|end| dt < &end);
                after_start && before_end
            })
            .collect();

        Ok(result)
    }

    /// Converts RRULE UNTIL to UTC.
    fn until_to_utc(&self, until: &RRuleUntil) -> Result<ChronoDateTime<Utc>> {
        match until {
            RRuleUntil::Date(date) => {
                // Date is inclusive, so use end of day
                let dt = DateTime::floating(
                    date.year,
                    date.month,
                    date.day,
                    23,
                    59,
                    59,
                );
                self.tz_db.to_utc(&dt)
            }
            RRuleUntil::DateTime(dt) => self.tz_db.to_utc(dt),
        }
    }

    /// Generates candidate dates based on frequency.
    fn generate_candidates(
        &self,
        start: ChronoDateTime<Utc>,
        until: Option<ChronoDateTime<Utc>>,
        max_instances: usize,
    ) -> Vec<ChronoDateTime<Utc>> {
        use crate::component::rfc::ical::core::Frequency;

        let Some(freq) = self.rrule.freq else {
            return Vec::new();
        };

        let interval = i64::from(self.rrule.interval.unwrap_or(1));
        let mut candidates = Vec::new();
        let mut current = start;

        let count_limit = self.rrule.count.map(|c| c as usize);
        let limit = count_limit.unwrap_or(max_instances).min(max_instances);

        for _ in 0..limit {
            // Check until boundary
            if until.is_some_and(|until_dt| current > until_dt) {
                break;
            }

            candidates.push(current);

            // Advance by frequency and interval
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            {
                current = match freq {
                    Frequency::Yearly => {
                        add_years(current, interval as u32)
                    }
                    Frequency::Monthly => {
                        add_months(current, interval as u32)
                    }
                    Frequency::Weekly => {
                        current + ChronoDuration::weeks(interval)
                    }
                    Frequency::Daily => {
                        current + ChronoDuration::days(interval)
                    }
                    Frequency::Hourly => {
                        current + ChronoDuration::hours(interval)
                    }
                    Frequency::Minutely => {
                        current + ChronoDuration::minutes(interval)
                    }
                    Frequency::Secondly => {
                        current + ChronoDuration::seconds(interval)
                    }
                };
            }
        }

        candidates
    }

    /// Applies BY-rules to filter/expand candidates.
    fn apply_by_rules(&self, mut candidates: Vec<ChronoDateTime<Utc>>) -> Vec<ChronoDateTime<Utc>> {
        // Apply BYMONTH
        if !self.rrule.by_month.is_empty() {
            candidates = self.apply_by_month(candidates);
        }

        // Apply BYMONTHDAY
        if !self.rrule.by_monthday.is_empty() {
            candidates = self.apply_by_monthday(candidates);
        }

        // Apply BYDAY
        if !self.rrule.by_day.is_empty() {
            candidates = self.apply_by_day(candidates);
        }

        // Apply BYHOUR
        if !self.rrule.by_hour.is_empty() {
            candidates = self.apply_by_hour(candidates);
        }

        // Apply BYMINUTE
        if !self.rrule.by_minute.is_empty() {
            candidates = self.apply_by_minute(candidates);
        }

        // Apply BYSECOND
        if !self.rrule.by_second.is_empty() {
            candidates = self.apply_by_second(candidates);
        }

        // Apply BYSETPOS (must be last)
        if !self.rrule.by_setpos.is_empty() {
            candidates = self.apply_by_setpos(candidates);
        }

        candidates
    }

    #[allow(clippy::cast_possible_truncation)]
    fn apply_by_month(&self, candidates: Vec<ChronoDateTime<Utc>>) -> Vec<ChronoDateTime<Utc>> {
        candidates
            .into_iter()
            .filter(|dt| self.rrule.by_month.contains(&(dt.month() as u8)))
            .collect()
    }

    #[allow(clippy::cast_possible_truncation)]
    fn apply_by_monthday(&self, candidates: Vec<ChronoDateTime<Utc>>) -> Vec<ChronoDateTime<Utc>> {
        candidates
            .into_iter()
            .filter(|dt| {
                let day = dt.day() as i8;
                self.rrule.by_monthday.contains(&day)
                    || self.rrule.by_monthday.iter().any(|&md| {
                        if md < 0 {
                            // Negative day counts from end of month
                            let days_in_month = days_in_month(dt.year(), dt.month());
                            day == (days_in_month as i8 + md + 1)
                        } else {
                            false
                        }
                    })
            })
            .collect()
    }

    fn apply_by_day(&self, candidates: Vec<ChronoDateTime<Utc>>) -> Vec<ChronoDateTime<Utc>> {
        candidates
            .into_iter()
            .filter(|dt| {
                let weekday = chrono_to_ical_weekday(dt.weekday());
                self.rrule.by_day.iter().any(|wd_num| {
                    if wd_num.ordinal.is_none() {
                        // Simple weekday match
                        wd_num.weekday == weekday
                    } else {
                        // Ordinal match (e.g., 1st Monday, last Friday)
                        // TODO: Implement ordinal matching properly
                        wd_num.weekday == weekday
                    }
                })
            })
            .collect()
    }

    #[allow(clippy::cast_possible_truncation)]
    fn apply_by_hour(&self, candidates: Vec<ChronoDateTime<Utc>>) -> Vec<ChronoDateTime<Utc>> {
        candidates
            .into_iter()
            .filter(|dt| self.rrule.by_hour.contains(&(dt.hour() as u8)))
            .collect()
    }

    #[allow(clippy::cast_possible_truncation)]
    fn apply_by_minute(&self, candidates: Vec<ChronoDateTime<Utc>>) -> Vec<ChronoDateTime<Utc>> {
        candidates
            .into_iter()
            .filter(|dt| self.rrule.by_minute.contains(&(dt.minute() as u8)))
            .collect()
    }

    #[allow(clippy::cast_possible_truncation)]
    fn apply_by_second(&self, candidates: Vec<ChronoDateTime<Utc>>) -> Vec<ChronoDateTime<Utc>> {
        candidates
            .into_iter()
            .filter(|dt| self.rrule.by_second.contains(&(dt.second() as u8)))
            .collect()
    }

    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        clippy::cast_possible_wrap
    )]
    fn apply_by_setpos(&self, candidates: Vec<ChronoDateTime<Utc>>) -> Vec<ChronoDateTime<Utc>> {
        if candidates.is_empty() {
            return candidates;
        }

        let mut result = Vec::new();
        let len = candidates.len() as i16;

        for &pos in &self.rrule.by_setpos {
            let idx = if pos > 0 {
                pos - 1
            } else {
                len + pos
            };

            if idx >= 0 && idx < len {
                result.push(candidates[idx as usize]);
            }
        }

        result
    }
}

/// Helper to add years to a datetime.
#[allow(clippy::cast_possible_wrap)]
fn add_years(dt: ChronoDateTime<Utc>, years: u32) -> ChronoDateTime<Utc> {
    let new_year = dt.year() + years as i32;
    dt.with_year(new_year).unwrap_or(dt)
}

/// Helper to add months to a datetime.
#[allow(clippy::cast_possible_truncation, clippy::cast_possible_wrap)]
fn add_months(dt: ChronoDateTime<Utc>, months: u32) -> ChronoDateTime<Utc> {
    let total_months = dt.month0() + months;
    let new_year = dt.year() + (total_months / 12) as i32;
    let new_month = (total_months % 12) + 1;
    
    // Handle day overflow (e.g., Jan 31 + 1 month = Feb 28/29)
    let max_day = days_in_month(new_year, new_month);
    let new_day = dt.day().min(max_day);
    
    NaiveDate::from_ymd_opt(new_year, new_month, new_day)
        .and_then(|date| date.and_hms_opt(dt.hour(), dt.minute(), dt.second()))
        .map_or(dt, |naive| ChronoDateTime::from_naive_utc_and_offset(naive, Utc))
}

/// Returns the number of days in a month.
fn days_in_month(year: i32, month: u32) -> u32 {
    NaiveDate::from_ymd_opt(year, month + 1, 1)
        .or_else(|| NaiveDate::from_ymd_opt(year + 1, 1, 1))
        .map_or(31, |d| d.pred_opt().map_or(31, |p| p.day()))
}

/// Converts chrono Weekday to iCal Weekday.
fn chrono_to_ical_weekday(wd: ChronoWeekday) -> Weekday {
    match wd {
        ChronoWeekday::Mon => Weekday::Monday,
        ChronoWeekday::Tue => Weekday::Tuesday,
        ChronoWeekday::Wed => Weekday::Wednesday,
        ChronoWeekday::Thu => Weekday::Thursday,
        ChronoWeekday::Fri => Weekday::Friday,
        ChronoWeekday::Sat => Weekday::Saturday,
        ChronoWeekday::Sun => Weekday::Sunday,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::component::rfc::ical::core::{Date, RRule, Weekday, WeekdayNum};

    #[test]
    fn test_daily_simple() {
        let tz_db = TimezoneDatabase::new();
        let dtstart = DateTime::utc(2024, 1, 1, 10, 0, 0);
        let rrule = RRule::daily().with_count(5);
        
        let set = RecurrenceSet::new(dtstart).with_rrule(rrule);
        let instances = set.expand(None, None, &tz_db).unwrap();
        
        assert_eq!(instances.len(), 5);
        assert_eq!(instances[0].day(), 1);
        assert_eq!(instances[1].day(), 2);
        assert_eq!(instances[4].day(), 5);
    }

    #[test]
    fn test_weekly_byday() {
        let tz_db = TimezoneDatabase::new();
        let dtstart = DateTime::utc(2024, 1, 1, 10, 0, 0); // Monday
        let rrule = RRule::weekly()
            .with_count(3)
            .with_by_day(vec![
                WeekdayNum::every(Weekday::Monday),
                WeekdayNum::every(Weekday::Wednesday),
                WeekdayNum::every(Weekday::Friday),
            ]);
        
        let set = RecurrenceSet::new(dtstart).with_rrule(rrule);
        let instances = set.expand(None, None, &tz_db).unwrap();
        
        assert!(!instances.is_empty());
    }

    #[test]
    fn test_count_limit() {
        let tz_db = TimezoneDatabase::new();
        let dtstart = DateTime::utc(2024, 1, 1, 10, 0, 0);
        let rrule = RRule::daily().with_count(10);
        
        let set = RecurrenceSet::new(dtstart).with_rrule(rrule);
        let instances = set.expand(None, None, &tz_db).unwrap();
        
        assert_eq!(instances.len(), 10);
    }

    #[test]
    fn test_until_date() {
        let tz_db = TimezoneDatabase::new();
        let dtstart = DateTime::utc(2024, 1, 1, 10, 0, 0);
        let until = Date::new(2024, 1, 5);
        let rrule = RRule::daily().with_until_date(until);
        
        let set = RecurrenceSet::new(dtstart).with_rrule(rrule);
        let instances = set.expand(None, None, &tz_db).unwrap();
        
        // Should have instances for Jan 1-5
        assert!(instances.len() >= 5);
        assert!(instances.len() <= 6); // Inclusive boundary
    }

    #[test]
    fn test_exdate() {
        let tz_db = TimezoneDatabase::new();
        let dtstart = DateTime::utc(2024, 1, 1, 10, 0, 0);
        let rrule = RRule::daily().with_count(5);
        let exdate = DateTime::utc(2024, 1, 3, 10, 0, 0);
        
        let set = RecurrenceSet::new(dtstart)
            .with_rrule(rrule)
            .with_exdate(exdate);
        let instances = set.expand(None, None, &tz_db).unwrap();
        
        // Should have 4 instances (Jan 1, 2, 4, 5 - excluding Jan 3)
        assert_eq!(instances.len(), 4);
        assert!(!instances.iter().any(|dt| dt.day() == 3));
    }

    #[test]
    fn test_rdate() {
        let tz_db = TimezoneDatabase::new();
        let dtstart = DateTime::utc(2024, 1, 1, 10, 0, 0);
        let rdate = DateTime::utc(2024, 1, 15, 10, 0, 0);
        
        let set = RecurrenceSet::new(dtstart).with_rdate(rdate);
        let instances = set.expand(None, None, &tz_db).unwrap();
        
        // Should have 2 instances (dtstart + rdate)
        assert_eq!(instances.len(), 2);
    }
}
