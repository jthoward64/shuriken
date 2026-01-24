// Shared WebDAV methods (PROPFIND/PROPPATCH/etc) live here.

pub mod delete;
pub mod get_head;
pub mod options;
pub mod propfind;
pub mod report;

#[cfg(test)]
mod delete_tests;
#[cfg(test)]
mod get_head_tests;
#[cfg(test)]
mod options_tests;
