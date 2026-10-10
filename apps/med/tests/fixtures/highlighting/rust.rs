use std::collections::HashMap;
use core::char::from_u32;

/// A cache of parsed entries.
#[derive(Debug, Clone)]
pub struct Cache<'a, T: Clone> {
    items: HashMap<&'a str, Vec<T>>,
    limit: usize,
}

impl<'a, T: Clone> Cache<'a, T> {
    pub fn get(&self, key: &str) -> Option<&[T]> {
        let found = self.items.get(key)?;
        match found.len() {
            0 => None,
            n if n > self.limit => panic!("over {} entries", self.limit),
            _ => Some(&found[..]),
        }
    }
}
