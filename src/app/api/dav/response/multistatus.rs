#![allow(dead_code)]
// 207 Multi-Status builders will live here.
//
// Phase 1 will introduce typed DAV XML response structs and serialization.

#[derive(Debug, Default, Clone)]
pub struct Multistatus {
    _private: (),
}
