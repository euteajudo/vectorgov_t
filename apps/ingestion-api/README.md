# Vectorgov-t Ingestion API

Parser de legislacao tributaria brasileira (Python + FastAPI).
Roda em Cloudflare Containers; o Worker invoca este servico via HTTP para
extrair dispositivos estruturados de um PDF de norma legal.

## Arquitetura

```
PDF -> PyMuPDFExtractor -> canonical_text + blocks
                              |
                              v
                       RegexClassifier
                              |
                              v
                  list[ClassifiedDevice]
                              |
                              v
              CitationExtractor (por dispositivo)
                              |
                              v
        ParseResult {dispositivos, canonical_text, sumario, ...}
```

Sem VLM, sem GPU, sem Milvus, sem Redis. O caminho e deterministico:
mesmo PDF + mesma versao do PyMuPDF = mesmo output.

## Layout

```
apps/ingestion-api/
  legisparser/
    models/
      legal_document.py        # Schemas Pydantic (LegalDocument, Chapter, ...)
      parse_result.py          # Schemas de saida (ParseResult, DispositivoChunk, ...)
    extraction/
      data_models.py           # BlockData, PageData (renomeado de vlm_models.py)
      pymupdf_extractor.py     # PyMuPDF -> blocos com offsets nativos
      regex_classifier.py      # Classifica blocos em artigos/paragrafos/incisos/alineas
      sequence_validator.py    # Detecta gaps de numeracao
    chunking/
      canonical_offsets.py     # Normalizacao + hash canonical
      citation_extractor.py    # Extrai citacoes de outras normas
    pipeline.py                # Orquestra o fluxo completo
  main.py                      # FastAPI app
  requirements.txt
  Dockerfile
  tests/
    test_parser.py
```

## Endpoints

### `GET /health`

Healthcheck.

```json
{"status": "ok", "version": "0.1.0"}
```

### `GET /version`

Retorna metadata da API e do pipeline.

```json
{
  "name": "vectorgov-t-ingestion",
  "version": "0.1.0",
  "pipeline_version": "vectorgov-t-1.0.0"
}
```

### `POST /parse`

Parseia um PDF e retorna `ParseResult` com dispositivos estruturados.

**Autenticacao:** header `X-Ingestion-Secret` (compartilhado com o Worker).

**Form data:**
| Campo | Tipo | Descricao |
|---|---|---|
| `pdf` | file | PDF da norma |
| `lei_id` | str | ID estavel da norma (ex: `lc-214-2025`) |
| `lei_tipo` | str | `lei_complementar`, `decreto`, `emenda_constitucional`, `lei`, `instrucao_normativa` |
| `numero` | str | Numero da norma (ex: `214`) |
| `ano` | int | Ano de publicacao |
| `data_publicacao` | str | Data ISO (`YYYY-MM-DD`) |
| `ementa` | str (opcional) | Ementa oficial |

**Exemplo:**

```bash
curl -X POST http://localhost:8080/parse \
  -H "X-Ingestion-Secret: dev-secret-change-me" \
  -F "pdf=@./EC-132-2023.pdf" \
  -F "lei_id=ec-132-2023" \
  -F "lei_tipo=emenda_constitucional" \
  -F "numero=132" \
  -F "ano=2023" \
  -F "data_publicacao=2023-12-20"
```

## Rodando localmente

### Sem Docker

```powershell
cd apps/ingestion-api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8080 --reload
```

### Com Docker

```bash
docker build -t vectorgov-t-ingestion .
docker run -p 8080:8080 -e INGESTION_API_SECRET=dev-secret vectorgov-t-ingestion
```

## Variaveis de ambiente

| Var | Default | Descricao |
|---|---|---|
| `INGESTION_API_SECRET` | `dev-secret-change-me` | Secret compartilhado com o Worker |
| `LOG_LEVEL` | `INFO` | Nivel de log Python |

## Testes

```powershell
cd apps/ingestion-api
pytest tests/ -v
```

Os testes cobrem:
- Parse de EC 132/2023 (PDF menor de teste)
- Validacao do schema `ParseResult`
- Determinismo (mesmo PDF -> mesmo canonical_hash)

## Status

- F1.B.1 - Adaptar LegisParser: feito
- F1.B.2 - Endpoint HTTP: feito
- F1.B.3 - Dockerfile: feito
- F1.B.4 - Deploy Cloudflare Container: pendente (Track A coordena)
