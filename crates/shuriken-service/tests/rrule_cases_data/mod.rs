use chrono::{DateTime, FixedOffset};
use rrule::{RRuleSet, Tz};

pub struct RRuleCase {
    pub name: &'static str,
    pub rruleset: &'static str,
    pub expected: Option<&'static [&'static str]>,
    pub expected_len: Option<usize>,
    pub limit: u16,
    pub after: Option<&'static str>,
    pub before: Option<&'static str>,
}

#[expect(clippy::too_many_lines)]
pub fn rrule_cases() -> Vec<RRuleCase> {
    vec![
        RRuleCase {
            name: "daily_basic",
            rruleset: "DTSTART:20120201T093000Z\nRRULE:FREQ=DAILY;COUNT=3",
            expected: Some(&[
                "2012-02-01T09:30:00+00:00",
                "2012-02-02T09:30:00+00:00",
                "2012-02-03T09:30:00+00:00",
            ]),
            expected_len: None,
            limit: 100,
            after: None,
            before: None,
        },
        RRuleCase {
            name: "weekly_basic",
            rruleset: "DTSTART:19970902T090000Z\nRRULE:FREQ=WEEKLY;COUNT=3;BYDAY=TU,TH",
            expected: Some(&[
                "1997-09-02T09:00:00+00:00",
                "1997-09-04T09:00:00+00:00",
                "1997-09-09T09:00:00+00:00",
            ]),
            expected_len: None,
            limit: 100,
            after: None,
            before: None,
        },
        RRuleCase {
            name: "monthly_basic",
            rruleset: "DTSTART:20120101T090000Z\nRRULE:FREQ=MONTHLY;COUNT=3;BYMONTHDAY=1",
            expected: Some(&[
                "2012-01-01T09:00:00+00:00",
                "2012-02-01T09:00:00+00:00",
                "2012-03-01T09:00:00+00:00",
            ]),
            expected_len: None,
            limit: 100,
            after: None,
            before: None,
        },
        RRuleCase {
            name: "yearly_basic",
            rruleset: "DTSTART:20120101T090000Z\nRRULE:FREQ=YEARLY;COUNT=3",
            expected: Some(&[
                "2012-01-01T09:00:00+00:00",
                "2013-01-01T09:00:00+00:00",
                "2014-01-01T09:00:00+00:00",
            ]),
            expected_len: None,
            limit: 100,
            after: None,
            before: None,
        },
        RRuleCase {
            name: "hourly_basic",
            rruleset: "DTSTART:20120101T090000Z\nRRULE:FREQ=HOURLY;COUNT=3",
            expected: Some(&[
                "2012-01-01T09:00:00+00:00",
                "2012-01-01T10:00:00+00:00",
                "2012-01-01T11:00:00+00:00",
            ]),
            expected_len: None,
            limit: 100,
            after: None,
            before: None,
        },
        RRuleCase {
            name: "minutely_basic",
            rruleset: "DTSTART:20120101T090000Z\nRRULE:FREQ=MINUTELY;COUNT=3",
            expected: Some(&[
                "2012-01-01T09:00:00+00:00",
                "2012-01-01T09:01:00+00:00",
                "2012-01-01T09:02:00+00:00",
            ]),
            expected_len: None,
            limit: 100,
            after: None,
            before: None,
        },
        RRuleCase {
            name: "secondly_basic",
            rruleset: "DTSTART:20120101T090000Z\nRRULE:FREQ=SECONDLY;COUNT=3",
            expected: Some(&[
                "2012-01-01T09:00:00+00:00",
                "2012-01-01T09:00:01+00:00",
                "2012-01-01T09:00:02+00:00",
            ]),
            expected_len: None,
            limit: 100,
            after: None,
            before: None,
        },
        RRuleCase {
            name: "rdate_exdate",
            rruleset: "DTSTART:20120201T093000Z\nRRULE:FREQ=DAILY;COUNT=3\nRDATE:20120210T093000Z\nEXDATE:20120202T093000Z",
            expected: Some(&[
                "2012-02-01T09:30:00+00:00",
                "2012-02-03T09:30:00+00:00",
                "2012-02-10T09:30:00+00:00",
            ]),
            expected_len: None,
            limit: 100,
            after: None,
            before: None,
        },
        RRuleCase {
            name: "after_before",
            rruleset: "DTSTART:20120201T093000Z\nRRULE:FREQ=DAILY;COUNT=3",
            expected: Some(&[
                "2012-02-02T09:30:00+00:00",
                "2012-02-03T09:30:00+00:00",
            ]),
            expected_len: None,
            limit: 100,
            after: Some("2012-02-01T10:00:00+00:00"),
            before: Some("2012-04-01T09:00:00+00:00"),
        },
        RRuleCase {
            name: "dst_new_york",
            rruleset: "DTSTART;TZID=America/New_York:20210313T090000\nRRULE:FREQ=DAILY;COUNT=3",
            expected: Some(&[
                "2021-03-13T09:00:00-05:00",
                "2021-03-14T09:00:00-04:00",
                "2021-03-15T09:00:00-04:00",
            ]),
            expected_len: None,
            limit: 100,
            after: None,
            before: None,
        },
        RRuleCase {
            name: "regression_issue_61",
            rruleset: "DTSTART;TZID=Europe/Berlin:18930401T010000\nRRULE:FREQ=DAILY",
            expected: None,
            expected_len: Some(10),
            limit: 10,
            after: None,
            before: None,
        },
        RRuleCase {
            name: "rfc_every_day_in_jan",
            rruleset: "DTSTART;TZID=America/New_York:19980101T090000\nRRULE:FREQ=YEARLY;UNTIL=20000131T140000Z;BYMONTH=1;BYDAY=SU,MO,TU,WE,TH,FR,SA",
            expected: None,
            expected_len: Some(93),
            limit: 200,
            after: None,
            before: None,
        },
    ]
}

pub fn assert_case(case: &RRuleCase) {
    let mut rrule_set: RRuleSet = case
        .rruleset
        .parse()
        .unwrap_or_else(|err| panic!("Failed to parse {}: {}", case.name, err));

    if let Some(after) = case.after {
        let after_dt = parse_rfc3339(after);
        rrule_set = rrule_set.after(after_dt.with_timezone(&Tz::UTC));
    }

    if let Some(before) = case.before {
        let before_dt = parse_rfc3339(before);
        rrule_set = rrule_set.before(before_dt.with_timezone(&Tz::UTC));
    }

    let result = rrule_set.all(case.limit);
    let actual_timestamps: Vec<i64> = result.dates.iter().map(chrono::DateTime::timestamp).collect();

    if let Some(expected) = case.expected {
        let expected_timestamps: Vec<i64> = expected
            .iter()
            .map(|value| parse_rfc3339(value).timestamp())
            .collect();
        assert_eq!(
            actual_timestamps, expected_timestamps,
            "Case {} did not match",
            case.name
        );
    }

    if let Some(expected_len) = case.expected_len {
        assert_eq!(
            result.dates.len(),
            expected_len,
            "Case {} expected {} occurrences",
            case.name,
            expected_len
        );
    }
}

fn parse_rfc3339(value: &str) -> DateTime<FixedOffset> {
    DateTime::parse_from_rfc3339(value).unwrap_or_else(|err| {
        panic!("Failed to parse rfc3339 value {value}: {err}")
    })
}
