-- Migration 0002: corrige contrato entre dispositivos_fts e dispositivos.
--
-- A versão inicial gravava apenas norma_id/artigo/paragrafo/hierarquia/texto
-- na FTS e depois tentava juntar `dispositivos.id = dispositivos_fts.rowid`.
-- Como `rowid` é inteiro e `dispositivos.id` é textual, a busca lexical nunca
-- encontrava os metadados do dispositivo. Recriamos a FTS com dispositivo_id.

DROP TABLE IF EXISTS dispositivos_fts;

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
