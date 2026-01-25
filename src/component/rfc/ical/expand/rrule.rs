//! RRULE expansion using the `rrule` crate.

use chrono::{DateTime, Utc};
use std::collections::HashSet;

/// Error during recurrence expansion.
#[derive(Debug, thiserror::Error)]
pub enum ExpansionError {
    /// Failed to parse RRULE string.
    #[error("Failed to parse RRULE: {0}")]
    ParseError(String),
    
    /// Invalid DTSTART value.
    #[error("Invalid DTSTART: {0}")]
    InvalidDtstart(String),
    
    /// Expansion exceeded maximum limit.
    #[error("Expansion exceeded maximum limit of {0} occurrences")]
    TooManyOccurrences(usize),
}

/// Options for recurrence expansion.
#[derive(Debug, Clone)]
pub struct ExpansionOptions {
    /// Maximum number of occurrences to generate.
    pub max_instances: usize,
    
    /// Start of time range filter (inclusive).
    pub range_start: Option<DateTime<Utc>>,
    
    /// End of time range filter (exclusive).
    pub range_end: Option<DateTime<Utc>>,
}

impl Default for ExpansionOptions {
    fn default() -> Self {
        Self {
            max_instances: 1000, // Default limit to prevent infinite expansion
            range_start: None,
            range_end: None,
        }
    }
}

impl ExpansionOptions {
    /// Creates expansion options with a time range.
    #[must_use]
    pub fn with_range(start: DateTime<Utc>, end: DateTime<Utc>) -> Self {
        Self {
            range_start: Some(start),
            range_end: Some(end),
            ..Self::default()
        }
    }
    
    /// Sets the maximum number of instances.
    #[must_use]
    pub fn with_max_instances(mut self, max: usize) -> Self {
        self.max_instances = max;
        self
    }
}

/// ## Summary
/// Expands a recurrence rule (RRULE) into a set of occurrence dates.
///
/// This function takes an RRULE string, a start time, and optional EXDATE/RDATE
/// lists to generate a set of occurrence times within the specified range.
///
/// ## Errors
///
/// Returns an error if:
/// - The RRULE string is malformed or invalid
/// - The DTSTART cannot be converted to a valid datetime
/// - The expansion exceeds the maximum instance limit
///
/// ## Side Effects
///
/// None - this is a pure function that performs expansion in memory.
pub fn expand_rrule(
    rrule_text: &str,
    dtstart: DateTime<Utc>,
    exdates: &[DateTime<Utc>],
    rdates: &[DateTime<Utc>],
    options: ExpansionOptions,
) -> Result<Vec<DateTime<Utc>>, ExpansionError> {
    // Parse the RRULE string using the rrule crate
    let rrule_string = format!("DTSTART:{}\nRRULE:{}", dtstart.format("%Y%m%dT%H%M%SZ"), rrule_text);
    
    let rrule_set = rrule_string
        .parse::<rrule::RRuleSet>()
        .map_err(|e| ExpansionError::ParseError(e.to_string()))?;
    
    // Convert EXDATE list to HashSet for efficient lookup
    let exdate_set: HashSet<DateTime<Utc>> = exdates.iter().copied().collect();
    
    // Generate occurrences with limit
    let mut occurrences = Vec::new();
    
    // Get all occurrences from the RRuleSet
    // Note: rrule crate handles time range filtering via after/before if needed
    let result = if options.range_start.is_some() || options.range_end.is_some() {
        // Build filtered rrule set
        let mut builder = rrule_set;
        if let Some(start) = options.range_start {
            // Convert chrono DateTime<Utc> to rrule Tz
            let start_tz = rrule::Tz::Tz(chrono_tz::UTC);
            let start_dt = start.with_timezone(&start_tz);
            builder = builder.after(start_dt);
        }
        if let Some(end) = options.range_end {
            let end_tz = rrule::Tz::Tz(chrono_tz::UTC);
            let end_dt = end.with_timezone(&end_tz);
            builder = builder.before(end_dt);
        }
        builder.all(options.max_instances as u16)
    } else {
        rrule_set.all(options.max_instances as u16)
    };
    
    // Convert from rrule DateTime to chrono DateTime<Utc>
    for dt in result.dates {
        // DateTime<Tz> has with_timezone method
        let chrono_dt = dt.with_timezone(&Utc);
        
        // Skip if in EXDATE list
        if exdate_set.contains(&chrono_dt) {
            continue;
        }
        
        occurrences.push(chrono_dt);
        
        // Check limit
        if occurrences.len() >= options.max_instances {
            break;
        }
    }
    
    // Add RDATE occurrences
    for rdate in rdates {
        if !exdate_set.contains(rdate) 
            && !occurrences.contains(rdate)
            && (options.range_start.is_none() || *rdate >= options.range_start.unwrap())
            && (options.range_end.is_none() || *rdate < options.range_end.unwrap())
        {
            occurrences.push(*rdate);
        }
    }
    
    // Sort occurrences chronologically
    occurrences.sort_unstable();
    
    // Apply max_instances limit after adding RDATEs
    if occurrences.len() > options.max_instances {
        occurrences.truncate(options.max_instances);
    }
    
    Ok(occurrences)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    
    #[test]
    fn test_daily_recurrence() {
        let dtstart = Utc.with_ymd_and_hms(2026, 1, 1, 10, 0, 0).unwrap();
        let rrule = "FREQ=DAILY;COUNT=5";
        
        let options = ExpansionOptions::default();
        let occurrences = expand_rrule(rrule, dtstart, &[], &[], options)
            .expect("expansion should succeed");
        
        assert_eq!(occurrences.len(), 5);
        assert_eq!(occurrences[0], dtstart);
        assert_eq!(occurrences[1], Utc.with_ymd_and_hms(2026, 1, 2, 10, 0, 0).unwrap());
    }
    
    #[test]
    fn test_weekly_recurrence_with_byday() {
        let dtstart = Utc.with_ymd_and_hms(2026, 1, 5, 9, 0, 0).unwrap(); // Monday
        let rrule = "FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=6";
        
        let options = ExpansionOptions::default();
        let occurrences = expand_rrule(rrule, dtstart, &[], &[], options)
            .expect("expansion should succeed");
        
        assert_eq!(occurrences.len(), 6);
        // Should get Mon, Wed, Fri, Mon, Wed, Fri
    }
    
    #[test]
    fn test_exdate_exclusion() {
        let dtstart = Utc.with_ymd_and_hms(2026, 1, 1, 10, 0, 0).unwrap();
        let rrule = "FREQ=DAILY;COUNT=5";
        
        let exdates = vec![
            Utc.with_ymd_and_hms(2026, 1, 2, 10, 0, 0).unwrap(),
            Utc.with_ymd_and_hms(2026, 1, 4, 10, 0, 0).unwrap(),
        ];
        
        let options = ExpansionOptions::default();
        let occurrences = expand_rrule(rrule, dtstart, &exdates, &[], options)
            .expect("expansion should succeed");
        
        // Should have 5 - 2 = 3 occurrences
        assert_eq!(occurrences.len(), 3);
        assert!(!occurrences.contains(&exdates[0]));
        assert!(!occurrences.contains(&exdates[1]));
    }
    
    #[test]
    fn test_rdate_inclusion() {
        let dtstart = Utc.with_ymd_and_hms(2026, 1, 1, 10, 0, 0).unwrap();
        let rrule = "FREQ=DAILY;COUNT=2";
        
        let rdates = vec![
            Utc.with_ymd_and_hms(2026, 1, 10, 10, 0, 0).unwrap(),
            Utc.with_ymd_and_hms(2026, 1, 15, 10, 0, 0).unwrap(),
        ];
        
        let options = ExpansionOptions::default();
        let occurrences = expand_rrule(rrule, dtstart, &[], &rdates, options)
            .expect("expansion should succeed");
        
        // Should have 2 + 2 = 4 occurrences
        assert_eq!(occurrences.len(), 4);
        assert!(occurrences.contains(&rdates[0]));
        assert!(occurrences.contains(&rdates[1]));
    }
    
    #[test]
    fn test_time_range_filter() {
        let dtstart = Utc.with_ymd_and_hms(2026, 1, 1, 10, 0, 0).unwrap();
        let rrule = "FREQ=DAILY;COUNT=10";
        
        let range_start = Utc.with_ymd_and_hms(2026, 1, 3, 0, 0, 0).unwrap();
        let range_end = Utc.with_ymd_and_hms(2026, 1, 7, 0, 0, 0).unwrap();
        
        let options = ExpansionOptions::with_range(range_start, range_end);
        let occurrences = expand_rrule(rrule, dtstart, &[], &[], options)
            .expect("expansion should succeed");
        
        // Should only get occurrences from Jan 3-6
        assert!(occurrences.len() <= 4);
        for occ in &occurrences {
            assert!(*occ >= range_start);
            assert!(*occ < range_end);
        }
    }
}
