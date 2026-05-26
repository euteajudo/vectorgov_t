"""
Modelos de dados para extracao de PDFs (PyMuPDF + regex).

Renomeado de vlm_models.py do parser original.
APENAS BlockData e PageData sao mantidos. Classes VLM (DeviceExtraction,
PageExtraction, DocumentExtraction) foram removidas: o vectorgov-t usa
somente o caminho PyMuPDF + Regex (sem VLM).
"""

from dataclasses import dataclass, field


@dataclass
class BlockData:
    """Um bloco de texto extraido pelo PyMuPDF com offset no canonical_text."""

    block_index: int          # indice do bloco na pagina
    char_start: int           # offset inicio no canonical_text global
    char_end: int             # offset fim no canonical_text global
    bbox_pdf: list[float]     # [x0, y0, x1, y1] em pontos PDF (72 DPI)
    text: str                 # texto do bloco
    page_number: int          # pagina de origem (1-indexed)
    lines: list = field(default_factory=list)  # line/span data para classifier
    has_strikethrough: bool = False  # True se linhas de riscado cruzam o bloco


@dataclass
class PageData:
    """Dados brutos de uma pagina extraidos via PyMuPDF."""

    page_number: int           # 1-indexed
    image_png: bytes           # PNG da pagina renderizada
    image_base64: str          # Base64 do PNG
    text: str                  # Texto concatenado dos blocos desta pagina
    width: float               # Largura da pagina em pontos PDF
    height: float              # Altura da pagina em pontos PDF
    img_width: int = 0         # Largura do pixmap em pixels
    img_height: int = 0        # Altura do pixmap em pixels
    blocks: list[BlockData] = field(default_factory=list)  # Blocos com offsets
    char_start: int = 0        # Offset do inicio desta pagina no canonical_text
    char_end: int = 0          # Offset do fim desta pagina no canonical_text
