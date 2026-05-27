-- Migration 0003: garante `dispositivos.paragrafo` como TEXT em D1 existente.
--
-- A 0001 foi corrigida para novas bases, mas bancos ja provisionados tinham
-- `paragrafo INTEGER`. SQLite nao altera tipo de coluna in-place; por isso
-- recriamos a tabela, copiamos os dados com CAST para TEXT e reconstruimos a
-- FTS que depende dos metadados de `dispositivos`.
--
-- Por que recriamos `versoes_dispositivos` tambem:
-- A FK `versoes_dispositivos.dispositivo_id REFERENCES dispositivos(id)`
-- aponta para o objeto-tabela `dispositivos`. Quando renomeamos `dispositivos`
-- para `dispositivos_old`, o SQLite atualiza a FK para apontar para
-- `dispositivos_old`. Para que a FK volte a referenciar a nova `dispositivos`,
-- precisamos recriar `versoes_dispositivos` tambem.
--
-- Por que `defer_foreign_keys = 1` em vez de `foreign_keys = off`:
-- O D1 executa toda migration dentro de uma transacao. `PRAGMA foreign_keys`
-- so tem efeito FORA de transacoes (SQLite ignora silenciosamente quando ja
-- ha uma transacao aberta). `defer_foreign_keys = 1` adia checagem ate o
-- COMMIT, momento em que tudo ja esta consistente.

PRAGMA defer_foreign_keys = 1;

DROP TABLE IF EXISTS dispositivos_fts;

ALTER TABLE versoes_dispositivos RENAME TO versoes_dispositivos_old;
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

CREATE TABLE versoes_dispositivos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dispositivo_id TEXT NOT NULL REFERENCES dispositivos(id),
    data_inicio TEXT NOT NULL,
    data_fim TEXT,
    texto TEXT NOT NULL,
    norma_que_alterou TEXT,
    r2_path_versao TEXT
);

INSERT INTO versoes_dispositivos (
    id,
    dispositivo_id,
    data_inicio,
    data_fim,
    texto,
    norma_que_alterou,
    r2_path_versao
)
SELECT
    id,
    dispositivo_id,
    data_inicio,
    data_fim,
    texto,
    norma_que_alterou,
    r2_path_versao
FROM versoes_dispositivos_old;

DROP TABLE versoes_dispositivos_old;
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
