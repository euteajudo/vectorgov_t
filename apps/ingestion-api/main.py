"""
Vectorgov-t Ingestion API.

FastAPI app que expoe o LegisPipeline via HTTP:
- GET  /health   -> healthcheck
- GET  /version  -> metadata da API
- POST /parse    -> parseia um PDF de norma legal

Autenticacao: header X-Ingestion-Secret (compartilhado com o Worker).
"""

import hashlib
import logging
import os

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
