"""
Schemas Pydantic do output do parser do vectorgov-t.

Define os modelos retornados pelo endpoint POST /parse:
- DispositivoChunk: um dispositivo individual extraido (artigo, paragrafo, inciso, alinea)
- NormaMetadata: metadados da norma
- ParseResult: resposta completa do parser
"""

from typing import Optional
from pydantic import BaseModel, Field


class DispositivoChunk(BaseModel):
    """Um dispositivo individual extraido (artigo, paragrafo, inciso, alinea)."""

    id: str = Field(..., description="ID estavel do dispositivo (ex: 'lc-214-2025-art-473').")
    norma_id: str = Field(..., description="ID da norma (ex: 'lc-214-2025').")
    tipo_dispositivo: str = Field(
        ...,
        description="Tipo do dispositivo: artigo, paragrafo, inciso, alinea, anexo.",
    )
    artigo: Optional[int] = Field(default=None, description="Numero do artigo.")
    paragrafo: Optional[str] = Field(
        default=None, description="Identificador do paragrafo: '1', '2', 'unico'."
    )
    inciso: Optional[str] = Field(default=None, description="Numeral romano: 'I', 'II', 'III'.")
    alinea: Optional[str] = Field(default=None, description="Letra: 'a', 'b', 'c'.")
    hierarquia_path: str = Field(
        ..., description="Caminho hierarquico legivel (ex: 'Livro I -> Titulo II -> Art. 473')."
    )
    texto: str = Field(..., description="Texto completo do dispositivo.")
    canonical_start: int = Field(..., description="Offset inicio no canonical_text.")
    canonical_end: int = Field(..., description="Offset fim no canonical_text.")
    page_number: Optional[int] = Field(default=None, description="Pagina do PDF (1-indexed).")
    citations: list[str] = Field(
        default_factory=list,
        description="Lista de citacoes (ex: ['LEI-14.133-2021 ART-009']).",
    )


class NormaMetadata(BaseModel):
    """Metadados da norma parseada."""

    id: str = Field(..., description="ID estavel da norma (ex: 'lc-214-2025').")
    tipo: str = Field(
        ...,
        description="Tipo: lei_complementar, decreto, emenda_constitucional, instrucao_normativa, lei.",
    )
    numero: str = Field(..., description="Numero da norma (ex: '214').")
    ano: int = Field(..., description="Ano de publicacao.")
    data_publicacao: str = Field(..., description="Data de publicacao no formato ISO (YYYY-MM-DD).")
    ementa: str = Field(default="", description="Ementa oficial.")
    orgao_emissor: Optional[str] = Field(default=None, description="Orgao emissor.")
    status: str = Field(default="vigente", description="Status atual: vigente, revogada, alterada.")


class ParseResult(BaseModel):
    """Resposta completa do parser de uma norma."""

    norma: NormaMetadata
    dispositivos: list[DispositivoChunk] = Field(default_factory=list)
    canonical_text: str = Field(..., description="Texto canonico normalizado.")
    canonical_hash: str = Field(..., description="SHA256 do canonical_text.")
    sumario: dict = Field(
        default_factory=dict,
        description="Arvore hierarquica navegavel para fs_listar_estrutura.",
    )
    total_dispositivos: int = Field(default=0, description="Total de dispositivos extraidos.")
    tokens_aproximados: int = Field(default=0, description="Estimativa de tokens (~chars/4).")
    pdf_hash: str = Field(..., description="SHA256 do PDF original.")
