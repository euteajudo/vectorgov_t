-- Rematerializa catalogo_facetas a partir de catalogo_itens (Fase A do design
-- docs/design/catalogo-kv-facetas.md). Idempotente: DELETE + reINSERT.
--
-- A agregação aqui é BYTE-A-BYTE a mesma do fast-path de leitura e do GROUP BY
-- ao vivo do consultarFacetas (WHERE ... IS NOT NULL, [ativo=1 no escopo
-- 'active']) — a paridade é por construção. A ordenação (n DESC, valor ASC) e o
-- LIMIT 200 NÃO entram aqui: materializamos TODOS os valores; a leitura ordena
-- e corta. Assim distintos_total = COUNT(*) da tabela para (dim, escopo).
--
-- Incluído no rebuild-pos-carga.sql (recarga full) e anexado ao delta-d1.sql
-- pelo delta.mjs (ciclo incremental, na MESMA transação do apply do delta →
-- consistência forte: itens e facetas mudam juntos).

DELETE FROM catalogo_facetas;

-- grupo
INSERT INTO catalogo_facetas (dim, escopo, valor, n)
  SELECT 'grupo', 'active', grupo, COUNT(*) FROM catalogo_itens
  WHERE ativo = 1 AND grupo IS NOT NULL GROUP BY grupo;
INSERT INTO catalogo_facetas (dim, escopo, valor, n)
  SELECT 'grupo', 'all', grupo, COUNT(*) FROM catalogo_itens
  WHERE grupo IS NOT NULL GROUP BY grupo;

-- classe
INSERT INTO catalogo_facetas (dim, escopo, valor, n)
  SELECT 'classe', 'active', classe, COUNT(*) FROM catalogo_itens
  WHERE ativo = 1 AND classe IS NOT NULL GROUP BY classe;
INSERT INTO catalogo_facetas (dim, escopo, valor, n)
  SELECT 'classe', 'all', classe, COUNT(*) FROM catalogo_itens
  WHERE classe IS NOT NULL GROUP BY classe;

-- pdm
INSERT INTO catalogo_facetas (dim, escopo, valor, n)
  SELECT 'pdm', 'active', pdm, COUNT(*) FROM catalogo_itens
  WHERE ativo = 1 AND pdm IS NOT NULL GROUP BY pdm;
INSERT INTO catalogo_facetas (dim, escopo, valor, n)
  SELECT 'pdm', 'all', pdm, COUNT(*) FROM catalogo_itens
  WHERE pdm IS NOT NULL GROUP BY pdm;

-- ncm
INSERT INTO catalogo_facetas (dim, escopo, valor, n)
  SELECT 'ncm', 'active', ncm, COUNT(*) FROM catalogo_itens
  WHERE ativo = 1 AND ncm IS NOT NULL GROUP BY ncm;
INSERT INTO catalogo_facetas (dim, escopo, valor, n)
  SELECT 'ncm', 'all', ncm, COUNT(*) FROM catalogo_itens
  WHERE ncm IS NOT NULL GROUP BY ncm;
