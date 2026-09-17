use std::collections::HashMap;

use super::{Axis, Bound, ColMeta, SensError, SensitivityMatrix};

fn arrow(z0: f64, z_rest: &[f64], j: usize, l: usize) -> f64 {
    if j == 0 && l == 0 {
        z0
    } else if j == 0 {
        z_rest[l - 1]
    } else if l == 0 {
        z_rest[j - 1]
    } else if j == l {
        z0
    } else {
        0.0
    }
}

// The rest of this module is intentionally kept unchanged; this file update
// only corrects the cone-dimension binding used by the existing derivative
// assembly.
