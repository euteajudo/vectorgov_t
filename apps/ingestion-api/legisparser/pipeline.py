"""
Pipeline simplificado do vectorgov-t.

Caminho: PyMuPDF -> Regex -> DispositivoChunk.

SEM:
- VLM (Qwen3-VL, GPU)
- Embeddings (Worker AI faz)
- Upload (Worker faz)
- Drift detection (over-engineering para MVP)
- Inspection storage
- Milvus / Redis / VPS forwarder

Output: ParseResult com dispositivos, canonical_text, hash, sumario, citations.
"""

from __future__ import annotations

import logging
from collections import OrderedDict
from typing import Any

from .chunking.canonical_offsets import (
    compute_canonical_hash,
    normalize_canonical_text,
)
from .chunking.citation_extractor import (
    CitationExtractor,
    extract_citations_from_chunk,
    normalize_document_id,
)
from .extraction.pymupdf_extractor import PyMuPDFExtractor
from .extraction.regex_classifier import classify_document
from .extraction.sequence_validator import validate_article_sequence
from .models.parse_result import DispositivoChunk, NormaMetadata, ParseResult

logger = logging.getLogger(__name__)


# Default inlinado (no parser original vinha de config.py)
PIPELINE_VERSION = "vectorgov-t-1.0.0"


class LegisPipeline:
    """Pipeline determinista PyMuPDF + Regex para leis tributarias."""

    def __init__(self) -> None:
        self.extractor = PyMuPDFExtractor()

    # =========================================================================
    # ENTRY POINT
    # =========================================================================

    def parse(
        self,
        pdf_bytes: bytes,
        norma_metadata: dict[str, Any],
        pdf_hash: str,
    ) -> ParseResult:
        """
        Parseia um PDF de norma legal.

        Args:
            pdf_bytes: Conteudo binario do PDF
            norma_metadata: dict com id, tipo, numero, ano, data_publicacao
            pdf_hash: SHA256 do PDF original

        Returns:
            ParseResult com dispositivos, canonical_text, hash, sumario.
        """
        norma_id_raw = norma_metadata["id"]
        # ID interno em minusculo para chaves de dispositivos
        norma_id_lower = norma_id_raw.lower()
        # ID canonico em maiusculo para citacoes (LEI-14.133-2021)
        norma_id_canonical = normalize_document_id(norma_id_raw)

        logger.info(
            f"Iniciando parse: norma={norma_id_raw}, pdf_hash={pdf_hash[:16]}..."
        )

        # 1. Extracao PyMuPDF (paginas + canonical_text com offsets nativos)
        pages, canonical_text_raw = self.extractor.extract_pages(pdf_bytes)
        logger.info(
            f"Extracao PyMuPDF: {len(pages)} paginas, {len(canonical_text_raw)} chars"
        )

        # 2. Normaliza canonical_text (NFC + line endings + trailing newline)
        # O extractor ja produz normalizado, mas chamamos para garantir idempotencia
        canonical_text = normalize_canonical_text(canonical_text_raw)
        canonical_hash = compute_canonical_hash(canonical_text)

        # 3. Converte PageData em lista de dicts para o classifier
        pages_for_classifier = self._pages_to_classifier_format(pages)

        # 4. Classifica dispositivos via regex
        classified = classify_document(pages_for_classifier)
        devices = classified["devices"]
        stats = classified["stats"]
        logger.info(
            f"Classificacao: {stats['devices']} dispositivos "
            f"({stats['filtered']} filtrados, {stats['unclassified']} nao classificados)"
        )

        # 5. Valida sequencia de artigos (warning, nao erro)
        sequence_warnings = validate_article_sequence(devices, norma_id_raw)
        for warning in sequence_warnings:
            logger.warning(warning)

        # 6. Extrai citacoes por dispositivo
        dispositivos = self._build_dispositivos(
            devices=devices,
            norma_id_lower=norma_id_lower,
            norma_id_canonical=norma_id_canonical,
        )

        # 7. Monta sumario hierarquico
        sumario = self._build_sumario(dispositivos)

        # 8. Monta NormaMetadata
        norma = NormaMetadata(
            id=norma_id_lower,
            tipo=norma_metadata["tipo"],
            numero=str(norma_metadata["numero"]),
            ano=int(norma_metadata["ano"]),
            data_publicacao=norma_metadata["data_publicacao"],
            ementa=norma_metadata.get("ementa", ""),
            orgao_emissor=norma_metadata.get("orgao_emissor"),
            status=norma_metadata.get("status", "vigente"),
        )

        # 9. Monta resultado final
        result = ParseResult(
            norma=norma,
            dispositivos=dispositivos,
            canonical_text=canonical_text,
            canonical_hash=canonical_hash,
            sumario=sumario,
            total_dispositivos=len(dispositivos),
            tokens_aproximados=len(canonical_text) // 4,
            pdf_hash=pdf_hash,
        )

        logger.info(
            f"Parse concluido: norma={norma_id_lower}, "
            f"{result.total_dispositivos} dispositivos, "
            f"{result.tokens_aproximados} tokens (aprox)"
        )

        return result

    # =========================================================================
    # HELPERS PRIVADOS
    # =========================================================================

    def _pages_to_classifier_format(self, pages: list) -> list[dict]:
        """
        Converte list[PageData] para o formato esperado pelo classify_document().

        O classifier espera: [{"page_number": int, "blocks": [{block_data}]}]
        e cada block precisa ter: block_index, text, char_start, char_end, bbox, lines.
        """
        pages_dict = []
        for page in pages:
            blocks_dict = []
            for block in page.blocks:
                blocks_dict.append({
                    "block_index": block.block_index,
                    "text": block.text,
                    "char_start": block.char_start,
                    "char_end": block.char_end,
                    "bbox": block.bbox_pdf,
                    "lines": block.lines,
                    "has_strikethrough": block.has_strikethrough,
                })
            pages_dict.append({
                "page_number": page.page_number,
                "blocks": blocks_dict,
            })
        return pages_dict

    def _build_dispositivos(
        self,
        devices: list[dict],
        norma_id_lower: str,
        norma_id_canonical: str,
    ) -> list[DispositivoChunk]:
        """Constroi DispositivoChunk para cada device classificado."""
        # Extractor de citacoes (usa o doc_id canonical para self-reference)
        citation_extractor_doc_id = norma_id_canonical

        # Mapa span_id -> identifier para construir hierarquia legivel
        span_id_to_identifier: dict[str, str] = {}
        for device in devices:
            span_id_to_identifier[device["span_id"]] = device.get("identifier") or ""

        dispositivos = []
        for device in devices:
            tipo = self._map_device_type(device["device_type"])
            span_id = device["span_id"]

            # IDs estaveis em minusculo: ex 'lc-214-2025-art-473', 'lc-214-2025-par-005-1'
            dispositivo_id = f"{norma_id_lower}-{span_id.lower()}"

            # Parse de artigo/paragrafo/inciso/alinea a partir do span_id
            artigo, paragrafo, inciso, alinea = self._parse_span_id(span_id)

            # Hierarquia path legivel (ex: "Art. 473 -> § 1o -> Inciso II")
            hierarquia_path = self._build_hierarquia_path(
                device=device,
                span_id_to_identifier=span_id_to_identifier,
            )

            # Citacoes (TODO: passa parent context para filtrar self-loops?)
            citations = extract_citations_from_chunk(
                text=device["full_text"],
                document_id=citation_extractor_doc_id,
            )

            dispositivos.append(DispositivoChunk(
                id=dispositivo_id,
                norma_id=norma_id_lower,
                tipo_dispositivo=tipo,
                artigo=artigo,
                paragrafo=paragrafo,
                inciso=inciso,
                alinea=alinea,
                hierarquia_path=hierarquia_path,
                texto=device["full_text"],
                canonical_start=device["char_start"],
                canonical_end=device["char_end"],
                page_number=device["page_number"],
                citations=citations,
            ))

        return dispositivos

    @staticmethod
    def _map_device_type(device_type: str) -> str:
        """Mapeia device_type do classifier (en) para tipo_dispositivo (pt)."""
        mapping = {
            "article": "artigo",
            "paragraph": "paragrafo",
            "inciso": "inciso",
            "alinea": "alinea",
            "anexo": "anexo",
        }
        return mapping.get(device_type, device_type)

    @staticmethod
    def _parse_span_id(span_id: str) -> tuple[int | None, str | None, str | None, str | None]:
        """
        Extrai (artigo, paragrafo, inciso, alinea) do span_id.

        Exemplos:
            'ART-005' -> (5, None, None, None)
            'PAR-005-1' -> (5, '1', None, None)
            'PAR-005-UNICO' -> (5, 'unico', None, None)
            'INC-005-II' -> (5, None, 'II', None)
            'INC-005-1-II' -> (5, '1', 'II', None)
            'ALI-005-II-a' -> (5, None, 'II', 'a')
            'ALI-005-1-II-a' -> (5, '1', 'II', 'a')
        """
        if not span_id:
            return None, None, None, None
        parts = span_id.split("-")
        prefix = parts[0]
        artigo = None
        paragrafo = None
        inciso = None
        alinea = None

        try:
            if prefix == "ART" and len(parts) >= 2:
                # ART-005 ou ART-005-A
                artigo = int(parts[1])
            elif prefix == "PAR" and len(parts) >= 3:
                # PAR-005-1 ou PAR-005-UNICO
                artigo = int(parts[1])
                par_val = parts[2]
                paragrafo = "unico" if par_val.upper() == "UNICO" else par_val
            elif prefix == "INC":
                artigo = int(parts[1])
                # INC-005-II (sem paragrafo) ou INC-005-1-II (sob paragrafo)
                if len(parts) == 3:
                    inciso = parts[2]
                elif len(parts) >= 4:
                    paragrafo = parts[2]
                    inciso = parts[3]
            elif prefix == "ALI":
                artigo = int(parts[1])
                # ALI-005-II-a, ALI-005-1-II-a, ALI-005-1-a (sob paragrafo sem inciso)
                # ALI-005-a (sob artigo direto - raro)
                if len(parts) == 3:
                    alinea = parts[2]
                elif len(parts) == 4:
                    # ALI-005-II-a OU ALI-005-1-a
                    middle = parts[2]
                    # Heuristica: numeral romano (uppercase) = inciso; senao paragrafo
                    if middle.isupper() and not middle.isdigit():
                        inciso = middle
                    else:
                        paragrafo = middle
                    alinea = parts[3]
                elif len(parts) >= 5:
                    paragrafo = parts[2]
                    inciso = parts[3]
                    alinea = parts[4]
        except (ValueError, IndexError):
            pass

        return artigo, paragrafo, inciso, alinea

    @staticmethod
    def _build_hierarquia_path(
        device: dict,
        span_id_to_identifier: dict[str, str],
    ) -> str:
        """
        Constroi caminho legivel ate o dispositivo.

        Ex: 'Art. 473o -> § 1o -> Inciso II -> Alinea a'

        TODO: incorporar Livro/Titulo/Capitulo do PDF. Por enquanto so
        usa a cadeia de parent_span_id (artigo -> paragrafo -> inciso -> alinea).
        """
        path_parts = []

        # Sobe a cadeia de parents ate o topo
        current_span = device["span_id"]
        current_identifier = device.get("identifier") or current_span
        path_parts.append(current_identifier)

        # Caminha pelos parents
        seen = {current_span}
        parent_id = device.get("parent_span_id")
        while parent_id and parent_id not in seen:
            seen.add(parent_id)
            parent_identifier = span_id_to_identifier.get(parent_id, parent_id)
            path_parts.append(parent_identifier)
            # Para subir, precisariamos do parent_span_id do parent - como nao
            # temos esse mapeamento aqui, paramos no primeiro nivel acima.
            # TODO: construir cadeia completa se necessario.
            break

        # Inverte: topo primeiro, folha por ultimo
        path_parts.reverse()
        return " -> ".join(path_parts)

    @staticmethod
    def _build_sumario(dispositivos: list[DispositivoChunk]) -> dict:
        """
        Constroi arvore hierarquica navegavel para fs_listar_estrutura.

        Formato:
            {
                "artigos": {
                    "473": {
                        "id": "lc-214-2025-art-473",
                        "tipo": "artigo",
                        "texto_preview": "...",
                        "filhos": {
                            "paragrafos": {"1": {...}, "2": {...}},
                            "incisos": {"I": {...}, "II": {...}}
                        }
                    }
                }
            }
        """
        sumario: dict = {"artigos": OrderedDict()}

        # Indexa dispositivos por artigo
        by_artigo: dict[int, list[DispositivoChunk]] = {}
        for disp in dispositivos:
            if disp.artigo is None:
                continue
            by_artigo.setdefault(disp.artigo, []).append(disp)

        for art_num in sorted(by_artigo.keys()):
            items = by_artigo[art_num]
            # Encontra o artigo "raiz" (sem paragrafo/inciso/alinea)
            art_root = next(
                (d for d in items if d.tipo_dispositivo == "artigo"),
                None,
            )
            if not art_root:
                continue

            art_entry = {
                "id": art_root.id,
                "tipo": "artigo",
                "texto_preview": art_root.texto[:120],
                "page_number": art_root.page_number,
                "filhos": {
                    "paragrafos": OrderedDict(),
                    "incisos": OrderedDict(),
                    "alineas": OrderedDict(),
                },
            }

            for disp in items:
                if disp.tipo_dispositivo == "paragrafo" and disp.paragrafo:
                    art_entry["filhos"]["paragrafos"][disp.paragrafo] = {
                        "id": disp.id,
                        "texto_preview": disp.texto[:120],
                    }
                elif disp.tipo_dispositivo == "inciso" and disp.inciso:
                    key = (
                        f"{disp.paragrafo}.{disp.inciso}"
                        if disp.paragrafo
                        else disp.inciso
                    )
                    art_entry["filhos"]["incisos"][key] = {
                        "id": disp.id,
                        "texto_preview": disp.texto[:120],
                    }
                elif disp.tipo_dispositivo == "alinea" and disp.alinea:
                    key_parts = [
                        disp.paragrafo,
                        disp.inciso,
                        disp.alinea,
                    ]
                    key = ".".join(p for p in key_parts if p)
                    art_entry["filhos"]["alineas"][key] = {
                        "id": disp.id,
                        "texto_preview": disp.texto[:120],
                    }

            sumario["artigos"][str(art_num)] = art_entry

        return sumario
