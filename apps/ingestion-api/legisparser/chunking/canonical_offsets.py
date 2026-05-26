# -*- coding: utf-8 -*-
"""
Canonical Offsets - utilities para resolucao de offsets (PR13).

Adaptado do parser original (rag-gpu-server). Mudancas:
- Funcoes de normalize_canonical_text/compute_canonical_hash/validate_offsets_hash
  inlinadas (antes vinham de ..utils.canonical_utils).
- Resto do conteudo (resolve_child_offsets, resolve_offsets_recursive) intacto.

Principio PR13:
==============
    Quando canonical_hash == hash_atual E start/end >= 0:
        -> usa slicing puro: canonical_text[start:end]
    Caso contrario:
        -> fallback best-effort via find()
"""

import hashlib
import logging
import unicodedata
from typing import Tuple

logger = logging.getLogger(__name__)


# =============================================================================
# Normalizacao canonical (inlinado de utils/canonical_utils.py)
# =============================================================================

def normalize_canonical_text(text: str) -> str:
    """
    Normaliza texto canonico para garantir determinismo.

    Regras aplicadas (em ordem):
    1. Unicode NFC normalization
    2. Normaliza line endings para LF (\\n)
    3. Remove trailing whitespace de cada linha
    4. Garante exatamente um \\n no final

    Args:
        text: Texto a normalizar

    Returns:
        Texto normalizado (deterministico)
    """
    if not text:
        return ""

    text = unicodedata.normalize("NFC", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.rstrip() for line in text.split("\n")]
    text = "\n".join(lines)
    text = text.rstrip("\n")
    if text:
        text += "\n"

    return text


def compute_canonical_hash(canonical_text: str) -> str:
    """Computa hash SHA256 do texto canonico (ja normalizado)."""
    return hashlib.sha256(canonical_text.encode("utf-8")).hexdigest()


def validate_offsets_hash(stored_hash: str, current_canonical_text: str) -> bool:
    """Valida se o hash armazenado confere com o texto canonico atual."""
    if not stored_hash:
        return False

    normalized = normalize_canonical_text(current_canonical_text)
    current_hash = compute_canonical_hash(normalized)
    return stored_hash == current_hash


# =============================================================================
# Extracao de snippets por offsets (PR13)
# =============================================================================

def extract_snippet_by_offsets(
    canonical_text: str,
    start: int,
    end: int,
    stored_hash: str,
) -> Tuple[str, bool]:
    """
    Extrai snippet usando offsets (zero fallback find).

    Args:
        canonical_text: Texto canonico completo
        start: Offset inicio
        end: Offset fim
        stored_hash: Hash armazenado para validacao

    Returns:
        Tupla (snippet, used_offsets) onde:
        - snippet: Texto extraido
        - used_offsets: True se usou slicing puro, False se fallback
    """
    if start >= 0 and end > start and stored_hash:
        if validate_offsets_hash(stored_hash, canonical_text):
            snippet = canonical_text[start:end]
            return snippet, True
        else:
            logger.warning(
                f"Hash mismatch: offsets invalidos. "
                f"stored_hash={stored_hash[:16]}..."
            )

    return "", False


# =============================================================================
# PR13 STRICT: Resolucao deterministica de offsets para filhos
# =============================================================================

class OffsetResolutionError(Exception):
    """Erro na resolucao de offsets (nao encontrado ou ambiguo)."""

    def __init__(
        self,
        message: str,
        document_id: str = "",
        span_id: str = "",
        device_type: str = "",
        reason: str = "",
    ):
        self.document_id = document_id
        self.span_id = span_id
        self.device_type = device_type
        self.reason = reason
        super().__init__(message)

    def __str__(self):
        return (
            f"OffsetResolutionError: {self.args[0]} "
            f"[document_id={self.document_id}, span_id={self.span_id}, "
            f"device_type={self.device_type}, reason={self.reason}]"
        )


def resolve_child_offsets(
    canonical_text: str,
    parent_start: int,
    parent_end: int,
    chunk_text: str,
    document_id: str = "",
    span_id: str = "",
    device_type: str = "",
) -> tuple[int, int]:
    """
    Resolve offsets de um chunk filho dentro do range do pai.

    Busca deterministica: chunk_text DEVE aparecer exatamente UMA VEZ
    dentro do range [parent_start:parent_end] do canonical_text.
    """
    if not chunk_text or not chunk_text.strip():
        raise OffsetResolutionError(
            f"chunk_text vazio para {span_id}",
            document_id=document_id,
            span_id=span_id,
            device_type=device_type,
            reason="EMPTY_TEXT",
        )

    if parent_start < 0 or parent_end <= parent_start:
        raise OffsetResolutionError(
            f"Range do pai invalido: [{parent_start}:{parent_end}]",
            document_id=document_id,
            span_id=span_id,
            device_type=device_type,
            reason="INVALID_PARENT_RANGE",
        )

    parent_text = canonical_text[parent_start:parent_end]
    search_text = chunk_text.strip()

    occurrences = []
    search_start = 0
    while True:
        pos = parent_text.find(search_text, search_start)
        if pos == -1:
            break

        is_word_boundary = (
            pos == 0 or
            not parent_text[pos - 1].isalnum()
        )

        if is_word_boundary:
            occurrences.append(pos)

        search_start = pos + 1

    if len(occurrences) == 0:
        simplified_search = " ".join(search_text.split())
        simplified_parent = " ".join(parent_text.split())

        if simplified_search in simplified_parent:
            reason = "NOT_FOUND_WHITESPACE_MISMATCH"
            hint = "Texto existe mas com whitespace diferente"
        else:
            reason = "NOT_FOUND"
            hint = "Texto nao existe no range do pai"

        raise OffsetResolutionError(
            f"Chunk '{span_id}' nao encontrado no range do pai. {hint}.",
            document_id=document_id,
            span_id=span_id,
            device_type=device_type,
            reason=reason,
        )

    if len(occurrences) > 1:
        raise OffsetResolutionError(
            f"Chunk '{span_id}' e AMBIGUO: {len(occurrences)} ocorrencias no range do pai.",
            document_id=document_id,
            span_id=span_id,
            device_type=device_type,
            reason="AMBIGUOUS_MULTIPLE_MATCHES",
        )

    relative_start = occurrences[0]
    absolute_start = parent_start + relative_start
    absolute_end = absolute_start + len(search_text)

    return absolute_start, absolute_end
