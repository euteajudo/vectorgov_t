-- Rebuild PÓS-carga do catálogo — rodar DEPOIS de aplicar catalogo-d1.sql e
-- catser-d1.sql (que carregam SÓ catalogo_itens; ver reset-pre-carga.sql).
--
-- Reconstrói a FTS e a trigram UMA vez, em fatias por (codigo % 4) para cada
-- INSERT..SELECT ficar em ~86k linhas e caber com folga no limite de 30s por
-- query do D1 (o INSERT único de ~346k linhas em tabela FTS5 é arriscado).
-- Os DELETEs iniciais tornam o script idempotente e cobrem também o caso de
-- alguém ter carregado com os triggers ainda ativos (sem eles as tabelas já
-- estariam vazias; com eles, evita duplicação).
--
-- Ao final, recria os 3 triggers — cópia exata da 0007_catalogo_v2.sql, para
-- que escrita incremental (curadoria, cargas pequenas) volte a espelhar.
--
-- Uso:
--   wrangler d1 execute catmat-catser-db --remote --file scripts/catalogo-etl/sql/rebuild-pos-carga.sql
--
-- Validação (as três contagens devem coincidir):
--   SELECT (SELECT COUNT(*) FROM catalogo_itens) AS itens,
--          (SELECT COUNT(*) FROM catalogo_fts)   AS fts,
--          (SELECT COUNT(*) FROM catalogo_trgm)  AS trgm;

DELETE FROM catalogo_fts;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 4) = 0;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 4) = 1;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 4) = 2;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 4) = 3;

DELETE FROM catalogo_trgm;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 4) = 0;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 4) = 1;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 4) = 2;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 4) = 3;

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
