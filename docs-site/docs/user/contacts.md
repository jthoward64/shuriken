---
sidebar_position: 3
---

# Contacts & Address books

## Creating an address book

Same flow as calendars: **Add address book → Create new**, with a slug
and optional display name.

## Browsing and searching

The contact list is paginated and searchable by name. You can switch
between address books you own and ones shared with you.

## Adding a contact

The contact form covers name, organization, multiple phone
numbers/emails/addresses (each with a type label like Home/Work),
birthday, and a photo (upload an image, paste a `data:` URI, or a
remote image URL).

## Importing and exporting

Import/export uses standard `.vcf` (vCard) files, including legacy
vCard 2.1 exports from very old address books — shuriken-ts normalizes
these automatically so old contacts still come in cleanly.

## Bulk actions

From the contact list, select multiple contacts with checkboxes to:
**download** them as a single `.vcf`, **clear photos**, or **delete**
them. These run in the background with a live progress bar since large
batches take a moment.

## Finding and merging duplicates

Visit **Merge contacts** to scan for duplicates — matched by any
combination of matching email, phone number, and/or name, scoped to one
address book or all of them. Each detected group gets a **Merge**
button. Merging automatically picks the most complete/most recently
edited card as the primary and combines in useful details from the
others (additional phone numbers, emails, addresses, etc. are kept, not
discarded) — nothing you'd notice missing is silently dropped.

## Cleanup / data-quality scan

Visit **Clean up contacts** to get individual suggestions for a chosen
address book:

- Duplicate email or phone on the same contact
- Inconsistent email casing
- Phone number formatting issues, or a phone number missing an area
  code (you'll be prompted to supply one, using a region you select)
- Generic/unhelpful labels (e.g. a phone marked "Other") with better
  options suggested
- Name casing/display-name issues

Each suggestion can be applied individually or dismissed — nothing
changes in bulk without your say.
