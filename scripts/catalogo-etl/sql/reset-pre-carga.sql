-- Reset PRÉ-carga do catálogo — rodar ANTES de aplicar catalogo-d1.sql /
-- catser-d1.sql numa recarga completa.
--
-- Por que dropar os triggers primeiro: o trigger AFTER DELETE da 0007 apaga
-- da catalogo_fts/catalogo_trgm por `catalogo_id`, coluna UNINDEXED — cada
-- linha deletada em catalogo_itens dispara um SCAN da FTS inteira. Com ~346k
-- itens a limpeza vira O(n²) e estoura o limite de 30s por query do D1.
-- Sem triggers, os três DELETEs abaixo são lineares.
--
-- Depois da carga, aplicar sql/rebuild-pos-carga.sql (reconstrói FTS + trigram
-- e recria os triggers). NÃO deixar o banco neste estado: sem triggers e sem
-- rebuild, as buscas lexicais respondem vazio.
--
-- Uso:
--   wrangler d1 execute catmat-catser-db --remote --file scripts/catalogo-etl/sql/reset-pre-carga.sql

DROP TRIGGER IF EXISTS catalogo_itens_ai;
DROP TRIGGER IF EXISTS catalogo_itens_ad;
DROP TRIGGER IF EXISTS catalogo_itens_au;

DELETE FROM catalogo_fts;
DELETE FROM catalogo_trgm;
DELETE FROM catalogo_itens;
