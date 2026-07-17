-- Migration 0007: catálogo v2 — NCM/vigência na base + PDM pesquisável na FTS.
--
-- Motivação (investigação 2026-07): a busca lexical só indexava descricao, e o
-- PDM é onde vive o nome genérico do item ("MICROCOMPUTADOR PESSOAL NOTEBOOK")
-- — sem ele, 89 notebooks afundavam sob 117 acessórios. A fonte nova (CSV
-- dadosabertos) traz NCM e data de atualização, que passam a colunas reais.
--
-- ATENÇÃO: como a 0006, os triggers pressupõem catalogo_trgm (0005) presente —
-- aplicar SOMENTE no banco dedicado catmat-catser-db.
--
-- Idempotência: DROP IF EXISTS antes de cada CREATE. Os ALTERs rodam uma única
-- vez pelo controle de migrations do wrangler (SQLite não tem ADD COLUMN IF
-- NOT EXISTS).

-- `ativo` NÃO é adicionado aqui: já existe desde a 0004
-- (INTEGER NOT NULL DEFAULT 1); a novidade é que o ETL passa a gravá-lo com o
-- status real da fonte em vez de 1 fixo.
ALTER TABLE catalogo_itens ADD COLUMN ncm TEXT;
ALTER TABLE catalogo_itens ADD COLUMN atualizado_em TEXT;

-- REBUILD da FTS: descricao E pdm pesquisáveis; o resto UNINDEXED (payload).
DROP TABLE IF EXISTS catalogo_fts;

CREATE VIRTUAL TABLE catalogo_fts USING fts5(
    catalogo_id UNINDEXED,
    codigo UNINDEXED,
    tipo UNINDEXED,
    grupo UNINDEXED,
    classe UNINDEXED,
    ncm UNINDEXED,
    descricao,
    pdm,
    tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO catalogo_fts (catalogo_id, codigo, tipo, grupo, classe, ncm, descricao, pdm)
SELECT id, codigo, tipo, grupo, classe, ncm, descricao, pdm FROM catalogo_itens;

-- Triggers da 0006 recriados para o novo layout da FTS (o espelho na
-- catalogo_trgm segue inalterado — ela só indexa descricao).
DROP TRIGGER IF EXISTS catalogo_itens_ai;
DROP TRIGGER IF EXISTS catalogo_itens_ad;
DROP TRIGGER IF EXISTS catalogo_itens_au;

CREATE TRIGGER catalogo_itens_ai AFTER INSERT ON catalogo_itens BEGIN
  INSERT INTO catalogo_fts (catalogo_id, codigo, tipo, grupo, classe, ncm, descricao, pdm)
    VALUES (new.id, new.codigo, new.tipo, new.grupo, new.classe, new.ncm, new.descricao, new.pdm);
  INSERT INTO catalogo_trgm (catalogo_id, codigo, tipo, descricao)
    VALUES (new.id, new.codigo, new.tipo, new.descricao);
END;

CREATE TRIGGER catalogo_itens_ad AFTER DELETE ON catalogo_itens BEGIN
  DELETE FROM catalogo_fts WHERE catalogo_id = old.id;
  DELETE FROM catalogo_trgm WHERE catalogo_id = old.id;
END;

CREATE TRIGGER catalogo_itens_au AFTER UPDATE ON catalogo_itens BEGIN
  DELETE FROM catalogo_fts WHERE catalogo_id = old.id;
  DELETE FROM catalogo_trgm WHERE catalogo_id = old.id;
  INSERT INTO catalogo_fts (catalogo_id, codigo, tipo, grupo, classe, ncm, descricao, pdm)
    VALUES (new.id, new.codigo, new.tipo, new.grupo, new.classe, new.ncm, new.descricao, new.pdm);
  INSERT INTO catalogo_trgm (catalogo_id, codigo, tipo, descricao)
    VALUES (new.id, new.codigo, new.tipo, new.descricao);
END;
