"""
Vectorgov-t Ingestion API.

FastAPI app que expoe o LegisPipeline via HTTP:
- GET  /health    -> healthcheck
- GET  /version   -> metadata da API
- POST /parse     -> parseia um PDF de norma legal (estruturado por dispositivo)
- POST /parse-doc -> parseia um PDF arbitrario (texto por pagina, sem semantica juridica)

Autenticacao: header X-Ingestion-Secret (compartilhado com o Worker).
"""

import hashlib
import logging
import os

import fitz  # PyMuPDF
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile

from legisparser import PIPELINE_VERSION, __version__
from legisparser.models.parse_result import ParseResult
from legisparser.pipeline import LegisPipeline

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("vectorgov-t.ingestion-api")


app = FastAPI(
    title="Vectorgov-t Ingestion API",
    description="Parser de legislacao tributaria brasileira",
    version=__version__,
)


INGESTION_SECRET = os.environ.get("INGESTION_API_SECRET", "dev-secret-change-me")

# Instancia global do pipeline (reusada entre requests)
pipeline = LegisPipeline()


def verify_secret(x_ingestion_secret: str | None = Header(None)) -> None:
    """Verifica o header X-Ingestion-Secret. Levanta 401 se invalido."""
    if x_ingestion_secret != INGESTION_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/health")
def health() -> dict[str, str]:
    """Healthcheck simples."""
    return {"status": "ok", "version": __version__}


@app.get("/version")
def version() -> dict[str, str]:
    """Retorna metadata da API."""
    return {
        "name": "vectorgov-t-ingestion",
        "version": __version__,
        "pipeline_version": PIPELINE_VERSION,
    }


@app.post("/parse", response_model=ParseResult)
async def parse(
    pdf: UploadFile = File(..., description="PDF da norma legal"),
    lei_id: str = Form(..., description="ID da norma (ex: 'lc-214-2025')"),
    lei_tipo: str = Form(..., description="Tipo: lei_complementar, decreto, emenda_constitucional, etc."),
    numero: str = Form(..., description="Numero da norma (ex: '214')"),
    ano: int = Form(..., description="Ano de publicacao"),
    data_publicacao: str = Form(..., description="Data de publicacao (YYYY-MM-DD)"),
    ementa: str = Form("", description="Ementa oficial (opcional)"),
    x_ingestion_secret: str | None = Header(None),
) -> ParseResult:
    """
    Parseia um PDF de norma legal e retorna estrutura hierarquica.

    Output:
        ParseResult com dispositivos, canonical_text, hash e sumario.
    """
    verify_secret(x_ingestion_secret)

    pdf_bytes = await pdf.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="PDF vazio")

    pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()

    logger.info(
        f"POST /parse: lei_id={lei_id}, tipo={lei_tipo}, "
        f"size={len(pdf_bytes)} bytes, hash={pdf_hash[:16]}..."
    )

    try:
        result = pipeline.parse(
            pdf_bytes=pdf_bytes,
            norma_metadata={
                "id": lei_id,
                "tipo": lei_tipo,
                "numero": numero,
                "ano": ano,
                "data_publicacao": data_publicacao,
                "ementa": ementa,
            },
            pdf_hash=pdf_hash,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception(f"Erro ao parsear PDF: {exc}")
        raise HTTPException(
            status_code=500,
            detail=f"Erro ao parsear PDF: {exc}",
        ) from exc

    return result


async def _extrair_texto_por_pagina(
    pdf: UploadFile,
    x_ingestion_secret: str | None,
    rota: str,
) -> dict:
    """
    Extrai texto por pagina de um PDF arbitrario (sem semantica juridica).

    Logica compartilhada por POST /parse-doc e POST /extract. Diferente de
    /parse, NAO assume estrutura de norma legal — apenas texto bruto por pagina
    (PyMuPDF). A estruturacao especifica do documento (ex.: secoes de um acordao
    do TCU) e responsabilidade de quem consome, nao deste container.

    Output:
        {
            "pages": [{"n": 1, "text": "..."}, ...],
            "total_pages": int,
            "total_chars": int,
            "pdf_hash": str,
        }

    Erros:
        400 - PDF vazio ou texto extraido vazio (provavelmente escaneado sem OCR).
        500 - Erro abrindo o PDF (corrompido).
    """
    verify_secret(x_ingestion_secret)

    pdf_bytes = await pdf.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="PDF vazio")

    pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()

    logger.info(
        f"POST /{rota}: filename={pdf.filename}, "
        f"size={len(pdf_bytes)} bytes, hash={pdf_hash[:16]}..."
    )

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:  # noqa: BLE001
        logger.exception(f"Erro ao abrir PDF: {exc}")
        raise HTTPException(
            status_code=500,
            detail=f"Erro ao abrir PDF: {exc}",
        ) from exc

    pages = []
    total_chars = 0
    try:
        for i in range(doc.page_count):
            page = doc.load_page(i)
            text = page.get_text() or ""
            pages.append({"n": i + 1, "text": text})
            total_chars += len(text)
    finally:
        doc.close()

    if total_chars == 0:
        raise HTTPException(
            status_code=400,
            detail=(
                "PDF nao contem texto extraivel (provavelmente escaneado sem OCR). "
                "Use um PDF com texto selecionavel."
            ),
        )

    return {
        "pages": pages,
        "total_pages": len(pages),
        "total_chars": total_chars,
        "pdf_hash": pdf_hash,
    }


@app.post("/parse-doc")
async def parse_doc(
    pdf: UploadFile = File(..., description="PDF arbitrario (peticao, contrato, parecer, etc.)"),
    x_ingestion_secret: str | None = Header(None),
) -> dict:
    """Texto por pagina de um PDF arbitrario (chat NotebookLM)."""
    return await _extrair_texto_por_pagina(pdf, x_ingestion_secret, "parse-doc")


@app.post("/extract")
async def extract(
    file: UploadFile = File(..., description="PDF arbitrario (ex.: acordao do TCU)"),
    x_ingestion_secret: str | None = Header(None),
) -> dict:
    """
    Alias de /parse-doc usado pelo worker de acordaos (vectorgov-a-mcp), que
    chama `env.INGESTION.fetch("/extract")` com o campo `file`. Mesmo output
    ({pages, pdf_hash}) — a estruturacao do acordao acontece no worker.
    """
    return await _extrair_texto_por_pagina(file, x_ingestion_secret, "extract")
