"""Modulo de extracao de PDF: PyMuPDF + regex classifier."""

from .data_models import BlockData, PageData
from .pymupdf_extractor import PyMuPDFExtractor
from .regex_classifier import (
    ClassifiedDevice,
    classify_document,
    classify_to_devices,
)
from .sequence_validator import validate_article_sequence

__all__ = [
    "BlockData",
    "PageData",
    "PyMuPDFExtractor",
    "ClassifiedDevice",
    "classify_document",
    "classify_to_devices",
    "validate_article_sequence",
]
