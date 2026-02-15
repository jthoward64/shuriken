//! Test execution context and variable substitution.
//!
//! Manages variables and state during test execution.

use crate::error::{Error, Result};
use std::collections::HashMap;

/// Test execution context holding variables and state
#[derive(Debug, Clone)]
pub struct TestContext {
    /// Variable storage
    variables: HashMap<String, String>,
}

impl TestContext {
    /// Create a new test context with default variables
    #[must_use]
    pub fn new() -> Self {
        let mut ctx = Self {
            variables: HashMap::new(),
        };
        ctx.init_default_variables();
        ctx
    }

    /// Initialize default CalDAV test variables
    fn init_default_variables(&mut self) {
        // Default server variables
        self.set("$host:", "localhost");
        self.set("$hostssl:", "localhost");
        self.set("$port:", "8080");
        self.set("$portssl:", "8443");

        // Default user paths
        self.set("$userid1:", "user01");
        self.set("$userid2:", "user02");
        self.set("$pswd1:", "user01");
        self.set("$pswd2:", "user02");

        // Calendar paths
        self.set("$pathprefix:", "/dav");
        self.set("$calendarhome1:", "/dav/calendars/user01");
        self.set("$calendarhome2:", "/dav/calendars/user02");
        self.set("$calendarpath1:", "/dav/calendars/user01/calendar");
        self.set("$calendarpath2:", "/dav/calendars/user02/calendar");

        // Address book paths
        self.set("$addressbookhome1:", "/dav/addressbooks/user01");
        self.set("$addressbookhome2:", "/dav/addressbooks/user02");
        self.set("$addressbookpath1:", "/dav/addressbooks/user01/addressbook");
        self.set("$addressbookpath2:", "/dav/addressbooks/user02/addressbook");
    }

    /// Set a variable value
    pub fn set(&mut self, name: &str, value: &str) {
        self.variables.insert(name.to_string(), value.to_string());
    }

    /// Get a variable value
    ///
    /// ## Errors
    /// Returns an error if the variable is not found.
    pub fn get(&self, name: &str) -> Result<&str> {
        self.variables
            .get(name)
            .map(String::as_str)
            .ok_or_else(|| Error::VariableNotFound(name.to_string()))
    }

    /// Substitute variables in a string
    ///
    /// Replaces `$variable:` patterns with their values.
    ///
    /// ## Errors
    /// Returns an error if a referenced variable is not found.
    pub fn substitute(&self, input: &str) -> Result<String> {
        let mut result = input.to_string();

        // Find and replace all variables
        for (var_name, var_value) in &self.variables {
            result = result.replace(var_name, var_value);
        }

        // Check if any unresolved variables remain
        if result.contains("$") && result.contains(":") {
            // Extract the variable name for better error message
            if let Some(start) = result.find('$') {
                if let Some(end) = result[start..].find(':') {
                    let var = &result[start..start + end + 1];
                    return Err(Error::VariableNotFound(var.to_string()));
                }
            }
        }

        Ok(result)
    }

    /// Substitute variables in an optional string
    ///
    /// ## Errors
    /// Returns an error if a referenced variable is not found.
    pub fn substitute_opt(&self, input: Option<&str>) -> Result<Option<String>> {
        match input {
            Some(s) => Ok(Some(self.substitute(s)?)),
            None => Ok(None),
        }
    }
}

impl Default for TestContext {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_variable_substitution() {
        let mut ctx = TestContext::new();
        ctx.set("$myvar:", "myvalue");

        let result = ctx.substitute("test $myvar: here").unwrap();
        assert_eq!(result, "test myvalue here");
    }

    #[test]
    fn test_missing_variable() {
        let ctx = TestContext::new();
        let result = ctx.substitute("test $missing: here");
        assert!(result.is_err());
    }

    #[test]
    fn test_default_variables() {
        let ctx = TestContext::new();
        assert_eq!(ctx.get("$host:").unwrap(), "localhost");
        assert_eq!(ctx.get("$userid1:").unwrap(), "user01");
    }
}
