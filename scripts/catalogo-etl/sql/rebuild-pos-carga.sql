-- Rebuild PÓS-carga do catálogo — rodar DEPOIS de aplicar catalogo-d1.sql e
-- catser-d1.sql (que carregam SÓ catalogo_itens; ver reset-pre-carga.sql).
--
-- Reconstrói a FTS e a trigram em fatias por (codigo % 32) — ~10,8k linhas por
-- INSERT..SELECT. A versão anterior usava % 4 (~86k linhas por fatia) e FALHOU
-- em produção (16/07/2026): "D1 DB exceeded its CPU time limit and was reset".
-- O custo dominante é a tokenização FTS5 do INSERT..SELECT; ~10k linhas por
-- statement cabe com folga no limite de 30s de CPU por query do D1.
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
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 0;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 1;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 2;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 3;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 4;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 5;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 6;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 7;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 8;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 9;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 10;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 11;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 12;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 13;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 14;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 15;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 16;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 17;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 18;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 19;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 20;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 21;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 22;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 23;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 24;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 25;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 26;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 27;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 28;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 29;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 30;
INSERT INTO catalogo_fts (catalogo_id,codigo,tipo,grupo,classe,ncm,descricao,pdm)
  SELECT id,codigo,tipo,grupo,classe,ncm,descricao,pdm FROM catalogo_itens WHERE (codigo % 32) = 31;

DELETE FROM catalogo_trgm;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 0;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 1;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 2;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 3;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 4;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 5;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 6;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 7;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 8;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 9;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 10;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 11;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 12;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 13;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 14;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 15;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 16;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 17;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 18;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 19;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 20;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 21;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 22;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 23;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 24;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 25;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 26;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 27;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 28;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 29;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 30;
INSERT INTO catalogo_trgm (catalogo_id,codigo,tipo,descricao)
  SELECT id,codigo,tipo,descricao FROM catalogo_itens WHERE (codigo % 32) = 31;

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
