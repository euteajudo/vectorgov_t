-- Migration 0003: garante `dispositivos.paragrafo` como TEXT em D1 existente.
--
-- A 0001 foi corrigida para novas bases, mas bancos ja provisionados tinham
-- `paragrafo INTEGER`. SQLite nao altera tipo de coluna in-place; por isso
-- recriamos a tabela, copiamos os dados com CAST para TEXT e reconstruimos a
-- FTS que depende dos metadados de `dispositivos`.

PRAGMA foreign_keys = off;

DROP TABLE IF EXISTS dispositivos_fts;

ALTER TABLE dispositivos RENAME TO dispositivos_old;

CREATE TABLE dispositivos (
    id TEXT PRIMARY KEY,
    norma_id TEXT NOT NULL REFERENCES normas(id),
    artigo INTEGER,
    paragrafo TEXT,
    inciso TEXT,
    alinea TEXT,
    hierarquia_path TEXT,
    tipo_dispositivo TEXT DEFAULT 'artigo'
);

INSERT INTO dispositivos (
    id,
    norma_id,
    artigo,
    paragrafo,
    inciso,
    alinea,
    hierarquia_path,
    tipo_dispositivo
)
SELECT
    id,
    norma_id,
    artigo,
    CASE
        WHEN paragrafo IS NULL THEN NULL
        ELSE CAST(paragrafo AS TEXT)
    END AS paragrafo,
    inciso,
    alinea,
    hierarquia_path,
    tipo_dispositivo
FROM dispositivos_old;

DROP TABLE dispositivos_old;

CREATE VIRTUAL TABLE dispositivos_fts USING fts5(
    dispositivo_id UNINDEXED,
    norma_id UNINDEXED,
    artigo UNINDEXED,
    paragrafo UNINDEXED,
    hierarquia UNINDEXED,
    texto,
    tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO dispositivos_fts (
    dispositivo_id,
    norma_id,
    artigo,
    paragrafo,
    hierarquia,
    texto
)
SELECT
    d.id,
    d.norma_id,
    d.artigo,
    d.paragrafo,
    d.hierarquia_path,
    v.texto
FROM dispositivos d
JOIN versoes_dispositivos v ON v.dispositivo_id = d.id
WHERE v.data_fim IS NULL;

PRAGMA foreign_keys = on;
