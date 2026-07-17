-- 0009 — tabela materializada de facetas de topo (Fase A do design
-- docs/design/catalogo-kv-facetas.md). Mata a agregação de 1,6-1,9s sobre
-- 346k linhas (GROUP BY grupo/classe/pdm/ncm) servindo o resultado pronto,
-- recomputado no MESMO ciclo do ETL (consistência forte com o catálogo).
-- Aplicar POR ARQUIVO (wrangler d1 execute --file), como as demais.

CREATE TABLE IF NOT EXISTS catalogo_facetas (
  dim    TEXT NOT NULL,       -- grupo | classe | pdm | ncm
  escopo TEXT NOT NULL,       -- active (só ativos) | all (tudo)
  valor  TEXT NOT NULL,
  n      INTEGER NOT NULL,    -- itens nesse valor, no escopo
  PRIMARY KEY (dim, escopo, valor)
);

-- Índice de leitura: ORDER BY n DESC dentro de (dim, escopo).
CREATE INDEX IF NOT EXISTS idx_facetas_ordem
  ON catalogo_facetas(dim, escopo, n DESC);

-- Popula já, a partir do catálogo atual (mesma agregação do fast-path).
DELETE FROM catalogo_facetas;

INSERT INTO catalogo_facetas (dim, escopo, valor, n)
  SELECT 'grupo', 'active', grupo, COUNT(*) FROM catalogo_itens
  WHERE ativo = 1 AND grupo IS NOT NULL GROUP BY grupo;
INSERT INTO catalogo_facetas (dim, escopo, valor, n)
  SELECT 'grupo', 'all', grupo, COUNT(*) FROM catalogo_itens
  WHERE grupo IS NOT NULL GROUP BY grupo;

INSERT INTO catalogo_facetas (dim, escopo, valor, n)
  SELECT 'classe', 'active', classe, COUNT(*) FROM catalogo_itens
  WHERE ativo = 1 AND classe IS NOT NULL GROUP BY classe;
INSERT INTO catalogo_facetas (dim, escopo, valor, n)
  SELECT 'classe', 'all', classe, COUNT(*) FROM catalogo_itens
  WHERE classe IS NOT NULL GROUP BY classe;

INSERT INTO catalogo_facetas (dim, escopo, valor, n)
  SELECT 'pdm', 'active', pdm, COUNT(*) FROM catalogo_itens
  WHERE ativo = 1 AND pdm IS NOT NULL GROUP BY pdm;
INSERT INTO catalogo_facetas (dim, escopo, valor, n)
  SELECT 'pdm', 'all', pdm, COUNT(*) FROM catalogo_itens
  WHERE pdm IS NOT NULL GROUP BY pdm;

INSERT INTO catalogo_facetas (dim, escopo, valor, n)
  SELECT 'ncm', 'active', ncm, COUNT(*) FROM catalogo_itens
  WHERE ativo = 1 AND ncm IS NOT NULL GROUP BY ncm;
INSERT INTO catalogo_facetas (dim, escopo, valor, n)
  SELECT 'ncm', 'all', ncm, COUNT(*) FROM catalogo_itens
  WHERE ncm IS NOT NULL GROUP BY ncm;
