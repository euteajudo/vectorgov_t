"""
Extrator de Citacoes Normativas para documentos legais brasileiros.

Adaptado do parser original (rag-gpu-server). Mudancas:
- normalize_document_id() inlinado (antes vinha de src.utils.normalization).
- classify_rel_type() simplificado para sempre retornar ("CITA", 0.5).
  TODO: portar rel_type_classifier completo se necessario.
- Remove dependencia de src.chunking.rel_type_classifier.

Este modulo extrai referencias a normas/documentos de texto legal:
- Leis, Decretos, Instrucoes Normativas, Portarias, Resolucoes
- Referencias internas (art. 9o, inciso III, alinea a)
"""

import re
import json
import logging
from dataclasses import dataclass
from typing import Optional, Callable
from enum import Enum

logger = logging.getLogger(__name__)


# =============================================================================
# Normalizacao de document_id (inlinado de utils/normalization.py)
# =============================================================================

def normalize_document_id(raw_id: str) -> str:
    """
    Normaliza document_id para formato canonico.

    Exemplos:
        normalize_document_id("LEI 14133/2021") -> "LEI-14.133-2021"
        normalize_document_id("IN-58-2022") -> "IN-58-2022"
        normalize_document_id("DECRETO-10947-2022") -> "DECRETO-10.947-2022"
    """
    if not raw_id:
        return ""

    normalized = raw_id.upper().strip()
    normalized = re.sub(r'\bN[oOº°]?\.?\s*', '', normalized, flags=re.IGNORECASE)
    normalized = re.sub(r'[\s/_]+', '-', normalized)
    normalized = re.sub(r'-+', '-', normalized)

    parts = normalized.split('-')
    if len(parts) >= 2:
        new_parts = []
        for i, part in enumerate(parts):
            is_year = (i == len(parts) - 1) and part.isdigit() and len(part) == 4
            has_dot = '.' in part

            if part.isdigit() and not is_year and not has_dot:
                num = int(part)
                if num >= 1000:
                    part = f"{num:,}".replace(",", ".")
            new_parts.append(part)
        normalized = '-'.join(new_parts)

    normalized = normalized.strip('-')
    return normalized


# =============================================================================
# Placeholder rel_type classifier (simplificado para vectorgov-t)
# =============================================================================

def classify_rel_type(text: str, start: int, end: int) -> tuple[str, float]:
    """
    Versao simplificada: sempre retorna CITA.

    TODO: portar rel_type_classifier completo se vectorgov-t precisar
    distinguir REVOGA_EXPRESSAMENTE / ALTERA_EXPRESSAMENTE / etc.
    Para MVP de leis tributarias, CITA basta.
    """
    return ("CITA", 0.5)


# =============================================================================
# Catalogo de documentos conhecidos (foco tributario)
# =============================================================================

KNOWN_DOCUMENTS = {
    # Tributarias
    "constituicao federal": "CF-1988",
    "cf": "CF-1988",
    "carta magna": "CF-1988",
    "ctn": "LEI-5.172-1966",  # Codigo Tributario Nacional
    "codigo tributario nacional": "LEI-5.172-1966",
    "lei kandir": "LC-87-1996",
    # Lei de Licitacoes (referenciada em alguns dispositivos tributarios)
    "lei 14133": "LEI-14.133-2021",
    "lei 8666": "LEI-8.666-1993",
}

# Tabela canonica de normas tributarias: (tipo, numero) -> ano correto
CANONICAL_NORMS = {
    # Leis Complementares tributarias
    ("LC", "214"): 2025,  # Lei Complementar do IBS/CBS (reforma tributaria)
    ("LC", "87"): 1996,   # Lei Kandir (ICMS)
    ("LC", "116"): 2003,  # ISS
    ("LC", "123"): 2006,  # Simples Nacional
    ("LC", "101"): 2000,  # LRF
    # Emendas constitucionais relevantes
    ("EC", "132"): 2023,  # Reforma tributaria
    ("EC", "87"): 2015,   # ICMS interestadual
    ("EC", "42"): 2003,   # Reforma tributaria de 2003
    # Leis ordinarias tributarias
    ("LEI", "5172"): 1966,  # CTN
    ("LEI", "8137"): 1990,  # Crimes contra ordem tributaria
    ("LEI", "9430"): 1996,  # IRPJ
    ("LEI", "9532"): 1997,
    ("LEI", "10637"): 2002,  # PIS nao cumulativo
    ("LEI", "10833"): 2003,  # COFINS nao cumulativa
    # Decretos
    ("DECRETO", "12955"): 2026,
    ("DECRETO", "9580"): 2018,  # RIR/2018
}

NORM_YEAR_BOUNDS = {
    "LEI": (1824, 2030),
    "LC": (1967, 2030),
    "DECRETO": (1889, 2030),
    "DL": (1937, 1988),
    "IN": (1990, 2030),
    "PORTARIA": (1950, 2030),
    "RESOLUCAO": (1950, 2030),
    "MP": (1988, 2030),
    "EC": (1992, 2030),
}


class NormativeType(str, Enum):
    """Tipos de normas reconhecidas."""
    LEI = "LEI"
    LEI_COMPLEMENTAR = "LC"
    DECRETO = "DECRETO"
    DECRETO_LEI = "DL"
    INSTRUCAO_NORMATIVA = "IN"
    PORTARIA = "PORTARIA"
    RESOLUCAO = "RESOLUCAO"
    MEDIDA_PROVISORIA = "MP"
    EMENDA_CONSTITUCIONAL = "EC"
    CONSTITUICAO = "CF"
    INTERNO = "INTERNO"


@dataclass
class NormativeReference:
    """Uma referencia normativa extraida do texto."""

    raw: str
    type: str
    doc_id: Optional[str] = None
    span_ref: Optional[str] = None
    target_node_id: Optional[str] = None
    method: str = "regex"
    confidence: float = 1.0
    is_ambiguous: bool = False
    rel_type: str = "CITA"
    rel_type_confidence: float = 0.0

    def to_dict(self) -> dict:
        return {
            "raw": self.raw,
            "type": self.type,
            "doc_id": self.doc_id,
            "span_ref": self.span_ref,
            "target_node_id": self.target_node_id,
            "method": self.method,
            "confidence": self.confidence,
            "rel_type": self.rel_type,
            "rel_type_confidence": self.rel_type_confidence,
        }


class CitationExtractor:
    """
    Extrai citacoes normativas de texto legal.

    Uso:
        extractor = CitationExtractor(current_document_id="LC-214-2025")
        citations = extractor.extract("conforme art. 9o da Lei 14.133/2021")
    """

    NORM_PATTERNS = {
        NormativeType.LEI_COMPLEMENTAR: [
            r"Lei\s+Complementar\s+(?:n[ºo°]?\s*)?(\d+[\d\.]*)",
            r"LC\s+(?:n[ºo°]?\s*)?(\d+[\d\.]*)",
        ],
        NormativeType.LEI: [
            r"Lei\s+(?:Federal\s+)?(?:n[ºo°]?\s*)?(\d+[\d\.]*)",
            r"Lei\s+(\d+[\d\.]*)(?:/(\d{2,4}))?",
        ],
        NormativeType.DECRETO_LEI: [
            r"Decreto[-\s]Lei\s+(?:n[ºo°]?\s*)?(\d+[\d\.]*)",
            r"DL\s+(?:n[ºo°]?\s*)?(\d+[\d\.]*)",
        ],
        NormativeType.DECRETO: [
            r"Decreto\s+(?:Federal\s+)?(?:n[ºo°]?\s*)?(\d+[\d\.]*)",
        ],
        NormativeType.INSTRUCAO_NORMATIVA: [
            r"Instru[çc][aã]o\s+Normativa\s+(?:[\w\-/]+\s+)?(?:n[ºo°]?\s*)?(\d+)",
            r"IN\s+(?:[\w\-/]+\s+)?(?:n[ºo°]?\s*)?(\d+)",
        ],
        NormativeType.PORTARIA: [
            r"Portaria\s+(?:[\w\-/]+\s+)?(?:n[ºo°]?\s*)?(\d+)",
        ],
        NormativeType.RESOLUCAO: [
            r"Resolu[çc][aã]o\s+(?:[\w\-/]+\s+)?(?:n[ºo°]?\s*)?(\d+)",
        ],
        NormativeType.MEDIDA_PROVISORIA: [
            r"Medida\s+Provis[oó]ria\s+(?:n[ºo°]?\s*)?(\d+[\d\.]*)",
            r"MP\s+(?:n[ºo°]?\s*)?(\d+[\d\.]*)",
        ],
        NormativeType.EMENDA_CONSTITUCIONAL: [
            r"Emenda\s+Constitucional\s+(?:n[ºo°]?\s*)?(\d+)",
            r"EC\s+(?:n[ºo°]?\s*)?(\d+)",
        ],
        NormativeType.CONSTITUICAO: [
            r"Constitui[çc][aã]o\s+(?:Federal|da\s+Rep[úu]blica)?",
            r"\bCF(?:/\d{2,4})?\b",
        ],
    }

    DEVICE_PATTERNS = {
        "artigo": r"(?:arts?\.?|artigos?)\s*(\d+)[ºo°]?",
        "paragrafo": r"(?:§|par[aá]grafo)\s*(\d+|[úu]nico)[ºo°]?",
        "inciso": r"inciso\s+([IVXLCDM]+)",
        "alinea": r"al[ií]nea\s+['\"]?([a-z])['\"]?",
    }

    YEAR_PATTERN = r"[/\s](\d{2,4})"

    def __init__(
        self,
        current_document_id: Optional[str] = None,
        known_documents: Optional[dict[str, str]] = None,
        llm_resolver: Optional[Callable[[str, list[str]], Optional[str]]] = None,
        enable_llm_fallback: bool = False,
    ):
        self.current_document_id = current_document_id
        self.known_documents = {**KNOWN_DOCUMENTS, **(known_documents or {})}
        self.llm_resolver = llm_resolver
        self.enable_llm_fallback = enable_llm_fallback
        self._compile_patterns()

        self.stats = {
            "regex_extractions": 0,
            "llm_fallback_calls": 0,
            "llm_resolved": 0,
            "ambiguous_refs": 0,
        }

    def _compile_patterns(self):
        self._compiled_norms = {}
        for norm_type, patterns in self.NORM_PATTERNS.items():
            self._compiled_norms[norm_type] = [
                re.compile(p, re.IGNORECASE) for p in patterns
            ]

        self._compiled_devices = {
            k: re.compile(v, re.IGNORECASE)
            for k, v in self.DEVICE_PATTERNS.items()
        }

    def extract(self, text: str) -> list[NormativeReference]:
        if not text:
            return []

        references = []
        seen_raw = set()
        seen_doc_ids = set()

        for norm_type, patterns in self._compiled_norms.items():
            for pattern in patterns:
                for match in pattern.finditer(text):
                    raw = match.group(0)
                    if raw.lower() in seen_raw:
                        continue
                    seen_raw.add(raw.lower())

                    ref = self._parse_normative_match(match, norm_type, text)
                    if ref:
                        ref_key = f"{ref.doc_id}#{ref.span_ref or ''}"
                        if ref_key in seen_doc_ids:
                            continue
                        seen_doc_ids.add(ref_key)
                        references.append(ref)

        internal_refs = self._extract_internal_references(text, seen_raw)
        references.extend(internal_refs)

        return references

    def _parse_normative_match(
        self,
        match: re.Match,
        norm_type: NormativeType,
        full_text: str
    ) -> Optional[NormativeReference]:
        raw = match.group(0)

        number = match.group(1) if match.lastindex and match.lastindex >= 1 else None
        if number:
            number = number.replace(".", "")

        year = None
        remaining_text = full_text[match.end():match.end() + 20]
        year_match = re.search(self.YEAR_PATTERN, remaining_text)
        if year_match:
            year = year_match.group(1)
            if len(year) == 2:
                year = f"20{year}" if int(year) < 50 else f"19{year}"
            raw = full_text[match.start():match.end() + year_match.end()]

        if match.lastindex and match.lastindex >= 2:
            captured_year = match.group(2)
            if captured_year and captured_year.isdigit():
                year = captured_year
                if len(year) == 2:
                    year = f"20{year}" if int(year) < 50 else f"19{year}"

        doc_id = self._build_doc_id(norm_type, number, year)

        span_ref = self._extract_device_reference_before(full_text, match.start())
        if not span_ref:
            span_ref = self._extract_device_reference(full_text, match.end())

        target_node_id = None
        if doc_id:
            if span_ref:
                target_node_id = f"leis:{doc_id}#{span_ref}"
            else:
                target_node_id = f"leis:{doc_id}"

        confidence, is_ambiguous = self._calculate_confidence(
            number=number, year=year, doc_id=doc_id, norm_type=norm_type
        )

        rel_type, rel_type_confidence = classify_rel_type(
            text=full_text, start=match.start(), end=match.end(),
        )

        return NormativeReference(
            raw=raw.strip(),
            type=norm_type.value,
            doc_id=doc_id,
            span_ref=span_ref,
            target_node_id=target_node_id,
            method="regex",
            confidence=confidence,
            is_ambiguous=is_ambiguous,
            rel_type=rel_type,
            rel_type_confidence=rel_type_confidence,
        )

    def _calculate_confidence(
        self,
        number: Optional[str],
        year: Optional[str],
        doc_id: Optional[str],
        norm_type: NormativeType
    ) -> tuple[float, bool]:
        confidence = 1.0
        is_ambiguous = False

        if not number:
            confidence = 0.3
            is_ambiguous = True
        elif not year:
            confidence = 0.6
            is_ambiguous = True
        elif not doc_id:
            confidence = 0.5
            is_ambiguous = True
        elif norm_type == NormativeType.CONSTITUICAO:
            confidence = 0.95
            is_ambiguous = False
        else:
            confidence = 0.95

        return confidence, is_ambiguous

    def _extract_internal_references(
        self,
        text: str,
        seen_raw: set
    ) -> list[NormativeReference]:
        references = []

        art_pattern = re.compile(
            r"(?:arts?\.?|artigos?)\s*(\d+)[ºo°]?"
            r"(?:\s*,?\s*(?:§|par[aá]grafo)\s*(\d+|[úu]nico)[ºo°]?)?"
            r"(?:\s*,?\s*inciso\s+([IVXLCDM]+))?"
            r"(?:\s*,?\s*al[ií]nea\s+['\"]?([a-z])['\"]?)?",
            re.IGNORECASE
        )

        for match in art_pattern.finditer(text):
            raw = match.group(0)
            if raw.lower() in seen_raw or len(raw) < 4:
                continue
            seen_raw.add(raw.lower())

            art_num = match.group(1)
            par_num = match.group(2)
            inc_num = match.group(3)
            ali_num = match.group(4)

            after_match = text[match.end():match.end() + 100].lower()
            is_external = any(
                kw in after_match[:50]
                for kw in ["da lei", "do decreto", "da in", "da portaria", "desta"]
            )

            if is_external and "desta" not in after_match[:30]:
                norm_captured = self._is_captured_by_norm_patterns(text, match)
                if norm_captured:
                    continue
                confidence_override = 0.6
            else:
                confidence_override = None

            span_ref = self._build_span_ref(art_num, par_num, inc_num, ali_num)

            target_node_id = None
            doc_id = None
            if self.current_document_id:
                doc_id = self.current_document_id
                target_node_id = f"leis:{doc_id}#{span_ref}"

            if confidence_override is not None:
                confidence = confidence_override
            else:
                confidence = 0.9 if self.current_document_id else 0.5
            is_ambiguous = not self.current_document_id

            rel_type, rel_type_confidence = classify_rel_type(
                text=text, start=match.start(), end=match.end(),
            )

            references.append(NormativeReference(
                raw=raw.strip(),
                type=NormativeType.INTERNO.value,
                doc_id=doc_id,
                span_ref=span_ref,
                target_node_id=target_node_id,
                method="regex",
                confidence=confidence,
                is_ambiguous=is_ambiguous,
                rel_type=rel_type,
                rel_type_confidence=rel_type_confidence,
            ))

        return references

    def _is_captured_by_norm_patterns(self, text: str, art_match: re.Match) -> bool:
        art_start = art_match.start()
        art_end = art_match.end()

        for _norm_type, patterns in self._compiled_norms.items():
            for pattern in patterns:
                for norm_match in pattern.finditer(text):
                    if norm_match.start() >= art_start and norm_match.start() <= art_end + 60:
                        return True
                    if art_start >= norm_match.start() - 120 and art_end <= norm_match.start():
                        return True
        return False

    def _build_doc_id(
        self,
        norm_type: NormativeType,
        number: Optional[str],
        year: Optional[str]
    ) -> Optional[str]:
        if not number:
            return None

        type_prefix = norm_type.value
        number_stripped = number.replace(".", "").lstrip("0") or number

        canonical_key = (type_prefix, number_stripped)
        canonical_year = CANONICAL_NORMS.get(canonical_key)

        validated_year = self._validate_year(
            type_prefix=type_prefix,
            number=number_stripped,
            extracted_year=year,
            canonical_year=canonical_year
        )

        number_output = number_stripped.zfill(2) if number_stripped.isdigit() else number_stripped

        parts = [type_prefix, number_output]
        if validated_year:
            parts.append(str(validated_year))

        raw_doc_id = "-".join(parts)
        return normalize_document_id(raw_doc_id)

    def _validate_year(
        self,
        type_prefix: str,
        number: str,
        extracted_year: Optional[str],
        canonical_year: Optional[int]
    ) -> Optional[int]:
        if canonical_year:
            return canonical_year

        if extracted_year:
            try:
                year_int = int(extracted_year)
                bounds = NORM_YEAR_BOUNDS.get(type_prefix, (1900, 2030))
                min_year, max_year = bounds

                if year_int < min_year or year_int > max_year:
                    return None

                return year_int
            except ValueError:
                return None

        return None

    def _build_span_ref(
        self,
        art_num: str,
        par_num: Optional[str] = None,
        inc_num: Optional[str] = None,
        ali_num: Optional[str] = None
    ) -> str:
        art_padded = art_num.zfill(3)

        if ali_num:
            return f"ALI-{art_padded}-{inc_num}-{ali_num}"
        elif inc_num:
            return f"INC-{art_padded}-{inc_num}"
        elif par_num:
            par_str = "UNICO" if par_num.lower() in ("único", "unico") else par_num
            return f"PAR-{art_padded}-{par_str}"
        else:
            return f"ART-{art_padded}"

    def _extract_device_reference_before(
        self,
        text: str,
        end_pos: int
    ) -> Optional[str]:
        start = max(0, end_pos - 100)
        search_text = text[start:end_pos]

        art_pattern = re.compile(
            r"(?:arts?\.?|artigos?)\s*(\d+)[ºo°]?"
            r"(?:\s*(?:,\s*\d+[ºo°]?)*(?:\s+(?:e|a)\s+\d+[ºo°]?)?)?"
            r"(?:\s*,?\s*(?:§|par[aá]grafo)\s*(\d+|[úu]nico)[ºo°]?)?"
            r"(?:\s*,?\s*inciso\s+([IVXLCDM]+))?"
            r"(?:\s*,?\s*al[ií]nea\s+['\"]?([a-z])['\"]?)?"
            r"\s*(?:,\s*)?(?:d[aoe]s?|n[aoe]s?)\s*$",
            re.IGNORECASE
        )

        match = art_pattern.search(search_text)
        if not match:
            return None

        art_num = match.group(1)
        par_num = match.group(2)
        inc_num = match.group(3)
        ali_num = match.group(4)

        return self._build_span_ref(art_num, par_num, inc_num, ali_num)

    def _extract_device_reference(
        self,
        text: str,
        start_pos: int
    ) -> Optional[str]:
        search_text = text[start_pos:start_pos + 100]

        art_match = self._compiled_devices["artigo"].search(search_text)
        if not art_match:
            return None

        art_num = art_match.group(1)
        remaining = search_text[art_match.end():]

        par_num = None
        inc_num = None
        ali_num = None

        par_match = self._compiled_devices["paragrafo"].search(remaining[:50])
        if par_match:
            par_num = par_match.group(1)
            remaining = remaining[par_match.end():]

        inc_match = self._compiled_devices["inciso"].search(remaining[:50])
        if inc_match:
            inc_num = inc_match.group(1)
            remaining = remaining[inc_match.end():]

        ali_match = self._compiled_devices["alinea"].search(remaining[:30])
        if ali_match:
            ali_num = ali_match.group(1)

        return self._build_span_ref(art_num, par_num, inc_num, ali_num)

    def to_json(self, references: list[NormativeReference]) -> str:
        return json.dumps(
            [ref.to_dict() for ref in references],
            ensure_ascii=False,
            indent=None
        )

    def extract_and_serialize(self, text: str) -> str:
        refs = self.extract(text)
        return self.to_json(refs)


def extract_citations_from_chunk(
    text: str,
    document_id: Optional[str] = None,
    known_documents: Optional[dict[str, str]] = None,
) -> list[str]:
    """
    Funcao utilitaria simplificada: extrai citacoes e retorna lista de strings
    no formato 'LEI-14.133-2021 art. 9o' para uso no DispositivoChunk.citations.
    """
    extractor = CitationExtractor(
        current_document_id=document_id,
        known_documents=known_documents,
    )

    refs = extractor.extract(text)

    citations = []
    seen = set()
    for ref in refs:
        if not ref.doc_id:
            continue
        if ref.span_ref:
            label = f"{ref.doc_id} {ref.span_ref}"
        else:
            label = ref.doc_id
        if label in seen:
            continue
        seen.add(label)
        citations.append(label)

    return citations
