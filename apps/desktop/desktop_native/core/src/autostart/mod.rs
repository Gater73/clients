#[cfg_attr(target_os = "linux", path = "linux.rs")]
#[cfg_attr(target_os = "windows", path = "unimplemented.rs")]
#[cfg_attr(target_os = "macos", path = "unimplemented.rs")]
mod autostart;
pub use autostart::*;
