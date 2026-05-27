"""Schemas Pydantic para documentos legais e resultado do parse."""

from .legal_document import (
    LegalDocument,
    Chapter,
    Article,
    Item,
    SubItem,
    Paragraph,
    PublicationDetails,
)
from .parse_result import (
    ParseResult,
    NormaMetadata,
    DispositivoChunk,
)

__all__ = [
    "LegalDocument",
    "Chapter",
    "Article",
    "Item",
    "SubItem",
    "Paragraph",
    "PublicationDetails",
    "ParseResult",
    "NormaMetadata",
    "DispositivoChunk",
]
