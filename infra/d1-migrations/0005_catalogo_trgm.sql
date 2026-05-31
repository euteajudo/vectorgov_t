-- Migration 0005: índice trigram do catálogo (fuzzy / substring / tolerante a
-- digitação) — o equivalente do `pg_trgm` na nossa stack D1.
--
-- O tokenizer `trigram` do FTS5 (SQLite ≥ 3.34) indexa trigramas da descrição,
-- permitindo MATCH por substring (≥ 3 chars) e tolerância a erro de digitação,
-- complementando o `catalogo_fts` (unicode61, full-text ≈ tsvector) e o índice
-- semântico no Vectorize. Ver docs/design/camada-agentica-catmat.md.
--
-- Populado a partir de catalogo_itens (migration 0004); não re-embeda nada.

DROP TABLE IF EXISTS catalogo_trgm;

CREATE VIRTUAL TABLE catalogo_trgm USING fts5(
    catalogo_id UNINDEXED,
    codigo UNINDEXED,
    tipo UNINDEXED,
    descricao,
    tokenize = 'trigram'
);

INSERT INTO catalogo_trgm (catalogo_id, codigo, tipo, descricao)
SELECT id, codigo, tipo, descricao FROM catalogo_itens;
