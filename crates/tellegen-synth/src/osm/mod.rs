//! OpenStreetMap (Overpass) mapping. The parse and build steps land with the
//! OSM milestone; the session calls through this interface.

use crate::context::ContextData;
use crate::electrical::branches::DraftBranch;
use crate::electrical::generators::DraftGenerator;
use crate::error::SynthError;
use crate::report::{OsmProvenance, RegionContext, Warning};
use crate::request::SynthRequest;
use crate::rng::Stream;
use crate::site::DraftBus;
use crate::topology::{Corridor, TopologyOutput};

/// A parsed Overpass document.
pub struct ParsedDocument {
    pub provenance: OsmProvenance,
}

pub fn parse_document(_text: &str) -> Result<ParsedDocument, SynthError> {
    Err(SynthError::Osm(
        "OpenStreetMap generation is not available in this build".to_owned(),
    ))
}

pub struct OsmBuild {
    _parsed: ParsedDocument,
}

impl OsmBuild {
    pub fn new(parsed: ParsedDocument) -> Self {
        Self { _parsed: parsed }
    }

    pub fn site(
        &mut self,
        _req: &SynthRequest,
        _ctx: &RegionContext,
        _data: &ContextData,
        _rng: &mut Stream,
        _warnings: &mut Vec<Warning>,
    ) -> Result<Vec<DraftBus>, SynthError> {
        Err(SynthError::Osm("unavailable".to_owned()))
    }

    pub fn topology(
        &mut self,
        _buses: &[DraftBus],
        _data: &ContextData,
        _rng: &mut Stream,
    ) -> Result<TopologyOutput, SynthError> {
        Err(SynthError::Osm("unavailable".to_owned()))
    }

    pub fn generators(
        &mut self,
        _buses: &mut [DraftBus],
        _corridors: &[Corridor],
        _ctx: &RegionContext,
        _req: &SynthRequest,
        _rng: &mut Stream,
        _warnings: &mut Vec<Warning>,
    ) -> Vec<DraftGenerator> {
        Vec::new()
    }

    pub fn hvdc_links(&self) -> Vec<crate::build::DraftHvdc> {
        Vec::new()
    }

    pub fn branch_osm_ids(&self, branches: &[DraftBranch]) -> Vec<Vec<i64>> {
        vec![Vec::new(); branches.len()]
    }

    pub fn makeup_flags(&self, generators: &[DraftGenerator]) -> Vec<bool> {
        vec![false; generators.len()]
    }
}
