"""Validador de sequencia de artigos pos-classificacao.

Detecta artigos faltando no meio de uma sequencia numerica continua, o que
indica falha silenciosa do extrator (ex: PyMuPDF nao extraiu uma pagina, VLM
pulou um dispositivo, parser nao reconheceu padrao).

Caso real motivador: IN-01-2026 ingerida em 17/05/2026 produziu devices com
Art. 34 e Art. 36 mas Art. 35 ausente. O canonical.md continha mencao ao
Art. 35 no sumario, mas o body nunca foi extraido. Sem este validador, a
falha passou silenciosamente para producao e so foi detectada por auditoria
manual semanas depois.

Uso pelo pipeline:
    from .sequence_validator import validate_article_sequence

    gaps = validate_article_sequence(devices, document_id)
    for gap in gaps:
        logger.warning(gap)
        result.quality_issues.append(gap)
"""
from __future__ import annotations

import re
from typing import Iterable


_ARTICLE_NUM_RE = re.compile(r"^ART-(\d+)(?:-([A-Za-z]+))?$")


def _extract_article_number(span_id: str) -> tuple[int, str] | None:
    """Extrai (numero, sufixo) do span_id de artigo.

    >>> _extract_article_number("ART-035")
    (35, "")
    >>> _extract_article_number("ART-006-A")
    (6, "A")
    >>> _extract_article_number("PAR-005-1")  # nao eh artigo
    None
    """
    m = _ARTICLE_NUM_RE.match(span_id or "")
    if not m:
        return None
    return int(m.group(1)), (m.group(2) or "")


def validate_article_sequence(
    devices: Iterable,
    document_id: str,
) -> list[str]:
    """Detecta gaps na sequencia numerica de artigos.

    Args:
        devices: iteravel de ClassifiedDevice (ou dict com span_id/device_type).
        document_id: ID do documento para inclusao na mensagem.

    Returns:
        Lista de warnings (vazia = sem gaps). Cada warning eh string descritiva
        no formato compativel com result.quality_issues.

    Estrategia:
        - Coleta numeros de artigos (sem sufixo) presentes em devices.
        - Se sequencia tem gap interno (existe Art. N e Art. N+k com k>1 sem
          Art. N+1, N+2, ..., N+k-1), emite warning por numero faltante.
        - Nao emite warning para sufixos faltando (ex: Art. 6-B ausente entre
          Art. 6 e Art. 6-A) — sufixos sao adicoes pontuais, nao sequencia.
        - Ignora artigos no comeco/fim da sequencia (so detecta gap "no meio").

    Falsos positivos esperados:
        - Lei que legitimamente pula numeros (raro para INs novas).
        - Operator deve revisar warning antes de remediar.

    Falsos negativos:
        - Se Art. N eh o ultimo da norma e foi perdido (Art. N-1 existe, Art. N
          faltando), nao detecta — nao ha ancora para o fim.
        - Se varios artigos consecutivos no inicio foram perdidos (Art. 1, 2, 3
          ausentes mas Art. 4 presente), nao detecta — nao ha ancora para o
          comeco.
    """
    article_numbers: set[int] = set()
    for d in devices:
        device_type = getattr(d, "device_type", None) or (d.get("device_type") if isinstance(d, dict) else None)
        if device_type != "article":
            continue
        span_id = getattr(d, "span_id", None) or (d.get("span_id") if isinstance(d, dict) else None)
        parts = _extract_article_number(span_id or "")
        if parts is None:
            continue
        article_numbers.add(parts[0])

    if not article_numbers:
        return []

    sorted_nums = sorted(article_numbers)
    min_n, max_n = sorted_nums[0], sorted_nums[-1]
    expected = set(range(min_n, max_n + 1))
    missing = expected - article_numbers

    if not missing:
        return []

    warnings: list[str] = []
    for n in sorted(missing):
        # Acha vizinhos imediatos para contextualizar a mensagem.
        prev_n = max((x for x in sorted_nums if x < n), default=None)
        next_n = min((x for x in sorted_nums if x > n), default=None)
        warnings.append(
            f"Sequence gap: artigo ART-{n:03d} ausente entre ART-{prev_n:03d} "
            f"e ART-{next_n:03d} em {document_id} — pagina pode nao ter sido "
            f"extraida; conferir PDF e logs de PyMuPDF/VLM"
        )
    return warnings
