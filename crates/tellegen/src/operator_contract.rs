//! Stable, solver-facing operator contracts derived from the canonical PowerIO maps.
//!
//! This module deliberately does not solve a power-flow problem. It validates the
//! structural relationship between Tellegen's dense model axes and the source-row
//! provenance used to report results. Keeping this contract explicit prevents a
//! filtered analysis view from silently changing element identities.

use crate::model::{branch_source_rows, ModelSourceRows};
use powerio_matrix::AnalysisBranchSource;

/// A validated mapping from dense analysis branch columns back to source rows.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct BranchAxisContract {
    pub source_rows: Vec<Option<usize>>,
}

impl BranchAxisContract {
    /// Build the branch-axis provenance from the same source descriptors used by
    /// PowerIO's numerical preparation.
    pub(crate) fn from_sources(sources: &[AnalysisBranchSource]) -> Self {
        Self {
            source_rows: branch_source_rows(sources),
        }
    }

    /// Validate that provenance and the model's source-row metadata have identical
    /// branch-column shape and never alias an invalid source row.
    pub(crate) fn validate(
        &self,
        provenance: &ModelSourceRows,
    ) -> Result<(), String> {
        if self.source_rows.len() != provenance.branches.len() {
            return Err(format!(
                "branch operator axis has {} columns but provenance has {} rows",
                self.source_rows.len(),
                provenance.branches.len()
            ));
        }
        for (column, (&axis_row, provenance_row)) in self
            .source_rows
            .iter()
            .zip(&provenance.branches)
            .enumerate()
        {
            if axis_row != *provenance_row {
                return Err(format!(
                    "branch operator axis column {column} maps to {:?}, provenance maps to {:?}",
                    axis_row, provenance_row
                ));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use powerio_matrix::AnalysisBranchSource;

    #[test]
    fn branch_axis_contract_preserves_real_and_synthetic_rows() {
        let sources = vec![
            AnalysisBranchSource::Branch { row: 2 },
            AnalysisBranchSource::ThreeWindingWinding { transformer_row: 4, winding: 0 },
            AnalysisBranchSource::ThreeWindingWinding { transformer_row: 4, winding: 1 },
        ];
        let contract = BranchAxisContract::from_sources(&sources);
        let provenance = ModelSourceRows {
            buses: vec![],
            branches: vec![Some(2), None, None],
            generators: vec![],
            transformers_3w: vec![Some(4)],
        };
        contract.validate(&provenance).expect("consistent axis");
    }

    #[test]
    fn branch_axis_contract_rejects_drift() {
        let sources = vec![AnalysisBranchSource::Branch { row: 2 }];
        let contract = BranchAxisContract::from_sources(&sources);
        let provenance = ModelSourceRows {
            buses: vec![],
            branches: vec![Some(3)],
            generators: vec![],
            transformers_3w: vec![],
        };
        let error = contract.validate(&provenance).unwrap_err();
        assert!(error.contains("column 0"));
    }
}
