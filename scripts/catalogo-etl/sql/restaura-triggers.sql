-- Restaura os 3 triggers do catálogo — HANDLER DE FALHA do apply delta.
--
-- O delta-d1.sql derruba os triggers no início e os recria no fim, tudo num
-- único `d1 execute --file`. Se esse arquivo falhar no meio E o D1 não tiver
-- feito rollback completo (arquivos muito grandes podem ser fatiados em mais
-- de uma transação pelo wrangler), o banco pode ficar SEM triggers — escrita
-- incremental (curadoria) deixaria de espelhar na FTS/trgm silenciosamente.
--
-- Este script é idempotente e SÓ recria os triggers (cópia exata da 0007 /
-- rebuild-pos-carga.sql); ele NÃO reconcilia FTS/trgm. A reconciliação é o
-- próprio re-run do workflow (o delta diffa contra o estado real do D1 e
-- converge) ou, em último caso, o rebuild-pos-carga.sql completo.
--
-- Uso:
--   wrangler d1 execute catmat-catser-db --remote --file scripts/catalogo-etl/sql/restaura-triggers.sql

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
