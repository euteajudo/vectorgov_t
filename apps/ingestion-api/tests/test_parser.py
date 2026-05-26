"""
Testes do LegisPipeline e do endpoint POST /parse.

Cobertura:
- Parse de EC 132/2023 (PDF de referencia, ~600 KB)
- Validacao do schema ParseResult
- Determinismo: mesmo PDF -> mesmo canonical_hash
- Endpoint /health e /version
- Autenticacao do /parse via header
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from legisparser.models.parse_result import ParseResult
from legisparser.pipeline import LegisPipeline
from main import app


EC_132_PDF = Path(r"D:\2026\lindineide\leis\Emenda Constitucional nº 132_2023.pdf")


def _ec132_bytes() -> bytes:
    if not EC_132_PDF.exists():
        pytest.skip(f"PDF de referencia nao encontrado: {EC_132_PDF}")
    return EC_132_PDF.read_bytes()


def _ec132_metadata() -> dict:
    return {
        "id": "ec-132-2023",
        "tipo": "emenda_constitucional",
        "numero": "132",
        "ano": 2023,
        "data_publicacao": "2023-12-20",
        "ementa": "Altera o Sistema Tributario Nacional",
    }


# =============================================================================
# Pipeline (sem HTTP)
# =============================================================================

class TestLegisPipeline:
    def test_parse_ec132_retorna_parse_result_valido(self):
        """Parse de EC 132/2023 deve retornar ParseResult schema-valido."""
        pdf_bytes = _ec132_bytes()
        pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()

        pipeline = LegisPipeline()
        result = pipeline.parse(
            pdf_bytes=pdf_bytes,
            norma_metadata=_ec132_metadata(),
            pdf_hash=pdf_hash,
        )

        # Schema valido
        assert isinstance(result, ParseResult)

        # Metadados preservados
        assert result.norma.id == "ec-132-2023"
        assert result.norma.tipo == "emenda_constitucional"
        assert result.norma.numero == "132"
        assert result.norma.ano == 2023

        # Hash do PDF
        assert result.pdf_hash == pdf_hash
        assert len(result.pdf_hash) == 64

        # Canonical text nao vazio + hash determinista
        assert len(result.canonical_text) > 0
        assert len(result.canonical_hash) == 64
        assert (
            result.canonical_hash
            == hashlib.sha256(result.canonical_text.encode("utf-8")).hexdigest()
        )

        # Tokens aproximados = chars // 4
        assert result.tokens_aproximados == len(result.canonical_text) // 4

    def test_parse_ec132_extrai_pelo_menos_20_dispositivos(self):
        """EC 132/2023 deve produzir pelo menos 20 dispositivos."""
        pdf_bytes = _ec132_bytes()
        pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()

        pipeline = LegisPipeline()
        result = pipeline.parse(
            pdf_bytes=pdf_bytes,
            norma_metadata=_ec132_metadata(),
            pdf_hash=pdf_hash,
        )

        assert result.total_dispositivos >= 20, (
            f"Esperado >= 20 dispositivos, obtido {result.total_dispositivos}"
        )
        assert len(result.dispositivos) == result.total_dispositivos

    def test_dispositivos_tem_offsets_canonical_validos(self):
        """Cada dispositivo deve ter canonical_start/end dentro do canonical_text."""
        pdf_bytes = _ec132_bytes()
        pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()

        pipeline = LegisPipeline()
        result = pipeline.parse(
            pdf_bytes=pdf_bytes,
            norma_metadata=_ec132_metadata(),
            pdf_hash=pdf_hash,
        )

        canonical_len = len(result.canonical_text)
        for disp in result.dispositivos:
            assert 0 <= disp.canonical_start < disp.canonical_end <= canonical_len, (
                f"Offsets invalidos para {disp.id}: "
                f"[{disp.canonical_start}, {disp.canonical_end}], canonical_len={canonical_len}"
            )
            assert disp.id.startswith("ec-132-2023-")
            assert disp.norma_id == "ec-132-2023"
            assert disp.tipo_dispositivo in {
                "artigo", "paragrafo", "inciso", "alinea", "anexo",
            }

    def test_sumario_contem_artigos(self):
        """O sumario deve conter ao menos a chave 'artigos' nao vazia."""
        pdf_bytes = _ec132_bytes()
        pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()

        pipeline = LegisPipeline()
        result = pipeline.parse(
            pdf_bytes=pdf_bytes,
            norma_metadata=_ec132_metadata(),
            pdf_hash=pdf_hash,
        )

        assert "artigos" in result.sumario
        assert len(result.sumario["artigos"]) > 0

    def test_parse_e_deterministico(self):
        """Mesmo PDF -> mesmo canonical_hash e mesmo numero de dispositivos."""
        pdf_bytes = _ec132_bytes()
        pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()

        pipeline = LegisPipeline()
        r1 = pipeline.parse(
            pdf_bytes=pdf_bytes,
            norma_metadata=_ec132_metadata(),
            pdf_hash=pdf_hash,
        )
        r2 = pipeline.parse(
            pdf_bytes=pdf_bytes,
            norma_metadata=_ec132_metadata(),
            pdf_hash=pdf_hash,
        )

        assert r1.canonical_hash == r2.canonical_hash
        assert r1.total_dispositivos == r2.total_dispositivos


# =============================================================================
# Endpoints HTTP
# =============================================================================

class TestHTTP:
    @pytest.fixture
    def client(self):
        return TestClient(app)

    def test_health(self, client):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "version" in data

    def test_version(self, client):
        response = client.get("/version")
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "vectorgov-t-ingestion"
        assert "pipeline_version" in data

    def test_parse_requires_secret(self, client):
        """POST /parse sem header deve retornar 401."""
        pdf_bytes = _ec132_bytes()
        response = client.post(
            "/parse",
            files={"pdf": ("test.pdf", pdf_bytes, "application/pdf")},
            data={
                "lei_id": "ec-132-2023",
                "lei_tipo": "emenda_constitucional",
                "numero": "132",
                "ano": 2023,
                "data_publicacao": "2023-12-20",
            },
        )
        assert response.status_code == 401

    def test_parse_with_valid_secret(self, client):
        """POST /parse com secret correto deve retornar ParseResult."""
        pdf_bytes = _ec132_bytes()
        secret = os.environ.get("INGESTION_API_SECRET", "dev-secret-change-me")

        response = client.post(
            "/parse",
            headers={"X-Ingestion-Secret": secret},
            files={"pdf": ("test.pdf", pdf_bytes, "application/pdf")},
            data={
                "lei_id": "ec-132-2023",
                "lei_tipo": "emenda_constitucional",
                "numero": "132",
                "ano": 2023,
                "data_publicacao": "2023-12-20",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["norma"]["id"] == "ec-132-2023"
        assert data["total_dispositivos"] >= 20
        assert len(data["canonical_hash"]) == 64
