-- Migration 0004: repositório de catálogo CATMAT/CATSER.
--
-- Tabela base + FTS5 (grep/BM25) para a busca de itens que resolve
-- "descrição do objeto -> código de catálogo" (pré-requisito da pesquisa de
-- preço de vantajosidade). O índice semântico vive no Vectorize (índice
-- separado `catmat-catser`), populado pelo ETL offline em scripts/catalogo-etl.
--
-- A carga das linhas é feita pelo ETL (wrangler d1 import). A FTS é populada a
-- partir da tabela base ao final do import (mesmo padrão das leis, migration 0002).

CREATE TABLE IF NOT EXISTS catalogo_itens (
    id TEXT PRIMARY KEY,          -- cat-<tipo>-<codigo>
    codigo INTEGER NOT NULL,
    tipo TEXT NOT NULL,           -- 'material' (CATMAT) | 'servico' (CATSER)
    descricao TEXT NOT NULL,
    grupo TEXT,
    classe TEXT,
    pdm TEXT,
    ativo INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_catalogo_codigo ON catalogo_itens (codigo);
CREATE INDEX IF NOT EXISTS idx_catalogo_tipo ON catalogo_itens (tipo);

DROP TABLE IF EXISTS catalogo_fts;

CREATE VIRTUAL TABLE catalogo_fts USING fts5(
    catalogo_id UNINDEXED,
    codigo UNINDEXED,
    tipo UNINDEXED,
    grupo UNINDEXED,
    classe UNINDEXED,
    descricao,
    tokenize = 'unicode61 remove_diacritics 2'
);
