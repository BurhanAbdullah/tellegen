//! Canonical DC operator access for Tellegen.
//!
//! PowerIO owns the numerical construction of the DC incidence and
//! susceptance operators. This facade keeps that ownership explicit while
//! exposing stable provenance alongside the matrices consumed by Tellegen.
//! It is intentionally solver-independent: callers can validate dimensions
//! and source mappings before using an operator in a sensitivity or solve path.

use powerio_matrix::{AnalysisBranchSource, DcOperatorOptions, DcOperators, SparseMatrix};
use powerio_prob::DcPfInstance;

/// A validated, immutable view of the canonical PowerIO DC operators.
///
/// The matrices use PowerIO's documented conventions. In particular, the
/// incidence matrix is `m x n`, branch susceptances use PowerModels signs, and
/// the bus matrix is `A^T diag(b) A`.
#[derive(Clone, Debug)]
pub struct CanonicalDcOperators {
    inner: DcOperators,
}

impl CanonicalDcOperators {
    /// Build canonical operators from the same typed instance used by Tellegen.
    pub fn build(instance: &DcPfInstance) -> Result<Self, String> {
        DcOperators::build(instance)
            .map(|inner| Self { inner })
            .map_err(|error| error.to_string())
    }

    /// Build with an explicit zero-impedance policy.
    pub fn build_with(
        instance: &DcPfInstance,
        options: DcOperatorOptions,
    ) -> Result<Self, String> {
        DcOperators::build_with(instance, &options)
            .map(|inner| Self { inner })
            .map_err(|error| error.to_string())
    }

    /// Canonical PowerModels incidence matrix `A`, `m x n`.
    #[must_use]
    pub fn incidence(&self) -> SparseMatrix {
        self.inner.calc_incidence_matrix()
    }

    /// Canonical PowerModels branch susceptances, one value per operator column.
    #[must_use]
    pub fn branch_susceptances(&self) -> &[f64] {
        self.inner.calc_branch_susceptances()
    }

    /// Canonical branch-flow matrix `Bf = diag(b) A`.
    #[must_use]
    pub fn branch_flow_matrix(&self) -> SparseMatrix {
        self.inner.calc_branch_flow_matrix()
    }

    /// Canonical bus susceptance matrix `B = A^T diag(b) A`.
    #[must_use]
    pub fn bus_susceptance_matrix(&self) -> SparseMatrix {
        self.inner.calc_bus_susceptance_matrix()
    }

    /// Dense bus row to stable PowerIO bus identity.
    #[must_use]
    pub fn bus_ids(&self) -> &[powerio_tx::BusId] {
        self.inner.bus_ids()
    }

    /// Canonical operator column to source branch row.
    #[must_use]
    pub fn branch_rows(&self) -> &[usize] {
        self.inner.branch_rows()
    }

    /// Canonical operator column to its source component, including lowered
    /// three-winding transformer windings.
    #[must_use]
    pub fn analysis_sources(&self) -> &[AnalysisBranchSource] {
        self.inner.analysis_sources()
    }

    /// Rows explicitly omitted by the zero-impedance policy.
    #[must_use]
    pub fn skipped_branch_rows(&self) -> &[usize] {
        self.inner.skipped_branch_rows()
    }

    /// Check that all canonical axes agree with the supplied Tellegen shape.
    pub fn validate_shape(&self, n_buses: usize, n_branches: usize) -> Result<(), String> {
        if self.bus_ids().len() != n_buses {
            return Err(format!(
                "canonical DC bus axis has {} rows; Tellegen has {n_buses}",
                self.bus_ids().len()
            ));
        }
        if self.branch_susceptances().len() != n_branches {
            return Err(format!(
                "canonical DC branch axis has {} columns; Tellegen has {n_branches}",
                self.branch_susceptances().len()
            ));
        }
        if self.branch_rows().len() != n_branches {
            return Err(format!(
                "canonical DC branch provenance has {} rows; Tellegen has {n_branches}",
                self.branch_rows().len()
            ));
        }
        if self.analysis_sources().len() != n_branches {
            return Err(format!(
                "canonical DC source axis has {} rows; Tellegen has {n_branches}",
                self.analysis_sources().len()
            ));
        }
        Ok(())
    }

    /// Access the underlying PowerIO operator bundle.
    #[must_use]
    pub fn as_powerio(&self) -> &DcOperators {
        &self.inner
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use powerio_prob::DcOpfInstance;

    fn case3() -> DcPfInstance {
        let network = crate::model::parse_matpower(crate::model::CASE3).expect("case3");
        DcOpfInstance::from_network(network).expect("typed instance")
    }

    #[test]
    fn canonical_bundle_is_shape_consistent() {
        let instance = case3();
        let operators = CanonicalDcOperators::build(&instance).expect("operators");
        let active_branches = instance
            .network()
            .branches()
            .iter()
            .filter(|branch| branch.in_service && branch.from != branch.to)
            .count();
        operators
            .validate_shape(instance.network().buses().len(), active_branches)
            .expect("canonical shape");
        assert!(!operators.branch_susceptances().is_empty());
        assert_eq!(operators.branch_rows().len(), operators.analysis_sources().len());
        assert!(operators.skipped_branch_rows().is_empty());
    }

    #[test]
    fn canonical_bundle_exposes_operator_identities() {
        let instance = case3();
        let operators = CanonicalDcOperators::build(&instance).expect("operators");
        assert_eq!(operators.branch_rows().len(), operators.branch_susceptances().len());
        assert_eq!(operators.analysis_sources().len(), operators.branch_rows().len());
        assert_eq!(operators.bus_ids().len(), instance.network().buses().len());
        assert_eq!(
            operators.as_powerio().branch_identities().len(),
            operators.branch_rows().len()
        );
    }
}
