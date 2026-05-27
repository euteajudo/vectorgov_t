"""Modulo de chunking: normalizacao canonical + extracao de citacoes."""

from .canonical_offsets import (
    normalize_canonical_text,
    compute_canonical_hash,
    validate_offsets_hash,
)
from .citation_extractor import (
    CitationExtractor,
    NormativeReference,
    NormativeType,
    extract_citations_from_chunk,
)

__all__ = [
    "normalize_canonical_text",
    "compute_canonical_hash",
    "validate_offsets_hash",
    "CitationExtractor",
    "NormativeReference",
    "NormativeType",
    "extract_citations_from_chunk",
]
