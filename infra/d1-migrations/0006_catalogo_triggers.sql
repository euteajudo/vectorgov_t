-- Migration 0006: triggers de sincronização do catálogo.
--
-- As FTS5 (catalogo_fts, catalogo_trgm) são tabelas standalone — não sincronizam
-- sozinhas com catalogo_itens. Estes triggers espelham INSERT/UPDATE/DELETE da
-- tabela-fonte nos dois índices, para que inserções incrementais (um CATMAT novo
-- avulso) mantenham tudo consistente sem precisar inserir nas três tabelas.
--
-- ATENÇÃO: aplicar SOMENTE no banco dedicado catmat-catser-db (que tem
-- catalogo_trgm). Não aplicar no vectorgov-t-db (não tem catalogo_trgm).
--
-- A carga em lote do ETL continua válida: ela faz DROP/recria as FTS e repopula,
-- então os triggers convivem com a recarga completa.

DROP TRIGGER IF EXISTS catalogo_itens_ai;
DROP TRIGGER IF EXISTS catalogo_itens_ad;
DROP TRIGGER IF EXISTS catalogo_itens_au;

-- INSERT → espelha nas duas FTS.
CREATE TRIGGER catalogo_itens_ai AFTER INSERT ON catalogo_itens BEGIN
  INSERT INTO catalogo_fts (catalogo_id, codigo, tipo, grupo, classe, descricao)
    VALUES (new.id, new.codigo, new.tipo, new.grupo, new.classe, new.descricao);
  INSERT INTO catalogo_trgm (catalogo_id, codigo, tipo, descricao)
    VALUES (new.id, new.codigo, new.tipo, new.descricao);
END;

-- DELETE → remove das duas FTS (por catalogo_id).
CREATE TRIGGER catalogo_itens_ad AFTER DELETE ON catalogo_itens BEGIN
  DELETE FROM catalogo_fts WHERE catalogo_id = old.id;
  DELETE FROM catalogo_trgm WHERE catalogo_id = old.id;
END;

-- UPDATE → remove o antigo + insere o novo nas duas FTS.
CREATE TRIGGER catalogo_itens_au AFTER UPDATE ON catalogo_itens BEGIN
  DELETE FROM catalogo_fts WHERE catalogo_id = old.id;
  DELETE FROM catalogo_trgm WHERE catalogo_id = old.id;
  INSERT INTO catalogo_fts (catalogo_id, codigo, tipo, grupo, classe, descricao)
    VALUES (new.id, new.codigo, new.tipo, new.grupo, new.classe, new.descricao);
  INSERT INTO catalogo_trgm (catalogo_id, codigo, tipo, descricao)
    VALUES (new.id, new.codigo, new.tipo, new.descricao);
END;
