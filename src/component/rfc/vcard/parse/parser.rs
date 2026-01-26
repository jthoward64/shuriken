//! vCard document parser.

use super::error::{ParseError, ParseErrorKind, ParseResult};
use super::lexer::{ContentLine, parse_content_line, split_lines, unfold_with_space};
use super::values::{
    parse_address, parse_client_pid_map, parse_date_and_or_time, parse_gender, parse_organization,
    parse_structured_name, parse_timestamp, unescape_text,
};
use crate::component::rfc::vcard::core::{VCard, VCardProperty, VCardValue, VCardVersion};

/// Parses a vCard document into one or more vCards.
///
/// ## Summary
/// Parses the input string as a vCard document and returns all vCards found.
///
/// ## Errors
/// Returns a parse error if the document is malformed or contains
/// invalid property values.
#[tracing::instrument(skip(input), fields(input_len = input.len()))]
pub fn parse(input: &str) -> ParseResult<Vec<VCard>> {
    tracing::debug!("Parsing vCard document");

    let unfolded = unfold_with_space(input);
    let lines = split_lines(&unfolded);

    tracing::trace!(count = lines.len(), "Split lines");

    let mut parser = Parser::new(lines);
    let result = parser.parse_document()?;

    tracing::debug!(count = result.len(), "Parsed vCards");

    Ok(result)
}

/// Parses a single vCard from input.
///
/// ## Summary
/// Convenience function for parsing a document with exactly one vCard.
///
/// ## Errors
/// Returns an error if the document contains no vCards or is malformed.
#[tracing::instrument(skip(input), fields(input_len = input.len()))]
pub fn parse_single(input: &str) -> ParseResult<VCard> {
    tracing::debug!("Parsing single vCard");

    let cards = parse(input)?;
    cards.into_iter().next().ok_or_else(|| {
        tracing::warn!("No vCard found in document");
        ParseError::new(
            ParseErrorKind::UnexpectedEof,
            1,
            "no vCard found in document",
        )
    })
}

struct Parser {
    lines: Vec<String>,
    pos: usize,
}

impl Parser {
    fn new(lines: Vec<String>) -> Self {
        Self { lines, pos: 0 }
    }

    fn current_line(&self) -> usize {
        self.pos + 1
    }

    fn parse_document(&mut self) -> ParseResult<Vec<VCard>> {
        let mut cards = Vec::new();

        while self.pos < self.lines.len() {
            let line = &self.lines[self.pos];

            // Skip empty lines
            if line.trim().is_empty() {
                self.pos += 1;
                continue;
            }

            // Look for BEGIN:VCARD
            if line.eq_ignore_ascii_case("BEGIN:VCARD") {
                self.pos += 1;
                let card = self.parse_vcard()?;
                cards.push(card);
            } else {
                // Skip unknown content at top level
                self.pos += 1;
            }
        }

        Ok(cards)
    }

    fn parse_vcard(&mut self) -> ParseResult<VCard> {
        let mut version = VCardVersion::V4; // Default
        let mut properties = Vec::new();
        let start_line = self.current_line();

        while self.pos < self.lines.len() {
            let line = &self.lines[self.pos];
            let line_num = self.current_line();
            self.pos += 1;

            // Skip empty lines
            if line.trim().is_empty() {
                continue;
            }

            // Check for END:VCARD
            if line.eq_ignore_ascii_case("END:VCARD") {
                return Ok(VCard {
                    version,
                    properties,
                });
            }

            // Parse content line
            let content_line = parse_content_line(line, line_num)?;

            // Handle special properties
            if content_line.name.as_str() == "VERSION" {
                version = VCardVersion::from_str(&content_line.value).ok_or_else(|| {
                    ParseError::new(
                        ParseErrorKind::UnsupportedVersion,
                        line_num,
                        format!("unsupported vCard version: {}", content_line.value),
                    )
                })?;
            } else {
                let prop = self.convert_to_property(content_line, line_num)?;
                properties.push(prop);
            }
        }

        Err(ParseError::new(
            ParseErrorKind::UnexpectedEof,
            start_line,
            "vCard not closed with END:VCARD",
        ))
    }

    fn convert_to_property(
        &self,
        line: ContentLine,
        line_num: usize,
    ) -> ParseResult<VCardProperty> {
        let value_type = line
            .params
            .iter()
            .find(|p| p.name == "VALUE")
            .and_then(|p| p.value());

        let value = self.parse_property_value(&line.name, &line.value, value_type, line_num)?;

        Ok(VCardProperty {
            group: line.group,
            name: line.name,
            params: line.params,
            value,
            raw_value: line.value,
        })
    }

    #[expect(
        clippy::too_many_lines,
        reason = "Parser dispatch requires handling many property types"
    )]
    fn parse_property_value(
        &self,
        name: &str,
        raw_value: &str,
        value_type: Option<&str>,
        line_num: usize,
    ) -> ParseResult<VCardValue> {
        // Handle RELATED specially - it can be URI (default) or text
        if name == "RELATED" {
            use crate::component::rfc::vcard::core::Related;
            return match value_type {
                Some(vt) if vt.eq_ignore_ascii_case("text") => {
                    Ok(VCardValue::Related(Related::Text(unescape_text(raw_value))))
                }
                _ => Ok(VCardValue::Related(Related::Uri(raw_value.to_string()))),
            };
        }

        // Handle explicit VALUE parameter
        if let Some(vt) = value_type {
            return self.parse_typed_value(raw_value, vt, line_num);
        }

        // Property-specific parsing
        match name {
            "N" => {
                let name = parse_structured_name(raw_value, line_num)?;
                Ok(VCardValue::StructuredName(name))
            }
            "ADR" => {
                let addr = parse_address(raw_value, line_num)?;
                Ok(VCardValue::Address(addr))
            }
            "ORG" => {
                let org = parse_organization(raw_value, line_num)?;
                Ok(VCardValue::Organization(org))
            }
            "GENDER" => {
                let gender = parse_gender(raw_value, line_num)?;
                Ok(VCardValue::Gender(gender))
            }
            "BDAY" | "ANNIVERSARY" | "DEATHDATE" => {
                let dt = parse_date_and_or_time(raw_value, value_type, line_num)?;
                Ok(VCardValue::DateAndOrTime(dt))
            }
            "REV" => {
                let ts = parse_timestamp(raw_value, line_num)?;
                Ok(VCardValue::Timestamp(ts))
            }
            "CLIENTPIDMAP" => {
                let cpm = parse_client_pid_map(raw_value, line_num)?;
                Ok(VCardValue::ClientPidMap(cpm))
            }
            "URL" | "PHOTO" | "LOGO" | "SOUND" | "KEY" | "FBURL" | "CALADRURI" | "CALURI"
            | "SOURCE" | "MEMBER" | "IMPP" => {
                // These are typically URIs
                Ok(VCardValue::Uri(raw_value.to_string()))
            }
            "NICKNAME" | "CATEGORIES" => {
                // Comma-separated text list
                let values = super::values::split_component(raw_value);
                Ok(VCardValue::TextList(values))
            }
            _ => {
                // Default to text
                Ok(VCardValue::Text(unescape_text(raw_value)))
            }
        }
    }

    #[expect(clippy::unused_self)]
    fn parse_typed_value(
        &self,
        raw_value: &str,
        value_type: &str,
        line_num: usize,
    ) -> ParseResult<VCardValue> {
        match value_type.to_ascii_lowercase().as_str() {
            "text" => Ok(VCardValue::Text(unescape_text(raw_value))),
            "uri" => Ok(VCardValue::Uri(raw_value.to_string())),
            "date" | "time" | "date-time" | "date-and-or-time" => {
                let dt = parse_date_and_or_time(raw_value, Some(value_type), line_num)?;
                Ok(VCardValue::DateAndOrTime(dt))
            }
            "boolean" => {
                let b = raw_value.eq_ignore_ascii_case("true")
                    || raw_value.eq_ignore_ascii_case("yes")
                    || raw_value == "1";
                Ok(VCardValue::Boolean(b))
            }
            "integer" => {
                let i: i64 = raw_value.parse().map_err(|_err| {
                    ParseError::new(ParseErrorKind::InvalidValue, line_num, "invalid integer")
                })?;
                Ok(VCardValue::Integer(i))
            }
            "float" => {
                let f: f64 = raw_value.parse().map_err(|_e| {
                    ParseError::new(ParseErrorKind::InvalidValue, line_num, "invalid float")
                })?;
                Ok(VCardValue::Float(f))
            }
            "utc-offset" => {
                let offset = super::values::parse_utc_offset(raw_value, line_num)?;
                Ok(VCardValue::UtcOffset(offset))
            }
            "language-tag" => Ok(VCardValue::LanguageTag(raw_value.to_string())),
            _ => {
                // Unknown type, preserve as text
                Ok(VCardValue::Unknown(raw_value.to_string()))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SIMPLE_VCARD: &str = "\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
FN:John Doe\r\n\
N:Doe;John;;;\r\n\
EMAIL:john@example.com\r\n\
END:VCARD\r\n";

    #[test]
    fn parse_simple_vcard() {
        let cards = parse(SIMPLE_VCARD).unwrap();
        assert_eq!(cards.len(), 1);

        let card = &cards[0];
        assert_eq!(card.version, VCardVersion::V4);
        assert_eq!(card.formatted_name(), Some("John Doe"));

        let name = card.name().unwrap();
        assert_eq!(name.family, vec!["Doe"]);
        assert_eq!(name.given, vec!["John"]);
    }

    #[test]
    fn parse_with_groups() {
        let input = "\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
FN:Jane Doe\r\n\
item1.TEL:+1-555-555-5555\r\n\
item1.X-ABLABEL:Work\r\n\
END:VCARD\r\n";

        let cards = parse(input).unwrap();
        let card = &cards[0];

        let tel_props = card.get_properties("TEL");
        assert_eq!(tel_props.len(), 1);
        assert_eq!(tel_props[0].group, Some("item1".to_string()));
    }

    #[test]
    fn parse_with_parameters() {
        let input = "\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
FN:Jane Doe\r\n\
TEL;TYPE=home,voice;PREF=1:+1-555-555-5555\r\n\
END:VCARD\r\n";

        let cards = parse(input).unwrap();
        let card = &cards[0];

        let tel = card.get_property("TEL").unwrap();
        assert!(tel.has_type("home"));
        assert!(tel.has_type("voice"));
        assert_eq!(tel.pref(), Some(1));
    }

    #[test]
    fn parse_address() {
        let input = "\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
FN:Jane Doe\r\n\
ADR;TYPE=home:;;123 Main St;Anytown;CA;12345;USA\r\n\
END:VCARD\r\n";

        let cards = parse(input).unwrap();
        let card = &cards[0];

        let addrs = card.addresses();
        assert_eq!(addrs.len(), 1);
        assert_eq!(addrs[0].street, vec!["123 Main St"]);
        assert_eq!(addrs[0].locality, vec!["Anytown"]);
    }

    #[test]
    fn parse_organization() {
        let input = "\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
FN:Jane Doe\r\n\
ORG:Acme Inc.;Engineering;Backend Team\r\n\
END:VCARD\r\n";

        let cards = parse(input).unwrap();
        let card = &cards[0];

        let org = card.organization().unwrap();
        assert_eq!(org.name, "Acme Inc.");
        assert_eq!(org.units, vec!["Engineering", "Backend Team"]);
    }

    #[test]
    fn parse_v3_vcard() {
        let input = "\
BEGIN:VCARD\r\n\
VERSION:3.0\r\n\
FN:John Doe\r\n\
N:Doe;John;;;\r\n\
END:VCARD\r\n";

        let cards = parse(input).unwrap();
        assert_eq!(cards[0].version, VCardVersion::V3);
    }

    #[test]
    fn parse_multiple_vcards() {
        let input = "\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
FN:John Doe\r\n\
END:VCARD\r\n\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
FN:Jane Doe\r\n\
END:VCARD\r\n";

        let cards = parse(input).unwrap();
        assert_eq!(cards.len(), 2);
        assert_eq!(cards[0].formatted_name(), Some("John Doe"));
        assert_eq!(cards[1].formatted_name(), Some("Jane Doe"));
    }

    #[test]
    fn parse_folded_lines() {
        let input = "\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
FN:John Doe with a very long name that\r\n \
 spans multiple lines\r\n\
END:VCARD\r\n";

        let cards = parse(input).unwrap();
        assert_eq!(
            cards[0].formatted_name(),
            Some("John Doe with a very long name that spans multiple lines")
        );
    }

    #[test]
    fn parse_single_success() {
        let cards = parse_single(SIMPLE_VCARD).unwrap();
        assert_eq!(cards.formatted_name(), Some("John Doe"));
    }

    #[test]
    fn parse_missing_end() {
        let input = "\
BEGIN:VCARD\r\n\
VERSION:4.0\r\n\
FN:John Doe\r\n";

        let result = parse(input);
        assert!(result.is_err());
    }
}
