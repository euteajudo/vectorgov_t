-- 0008 — índices do inspetor de catálogo + estado do ETL
-- (SPEC-LOOP-MONITOR-CATALOGO §4). Idempotente; só cria índices/tabela.
-- Aplicar POR ARQUIVO (`wrangler d1 execute catmat-catser-db --remote --file ...`),
-- nunca `migrations apply` — o wrangler.toml do catálogo não tem migrations_dir
-- de propósito (mesma regra da 0007).

CREATE INDEX IF NOT EXISTS idx_itens_tipo_ativo ON catalogo_itens(tipo, ativo);
CREATE INDEX IF NOT EXISTS idx_itens_grupo      ON catalogo_itens(grupo);
CREATE INDEX IF NOT EXISTS idx_itens_classe     ON catalogo_itens(classe);
CREATE INDEX IF NOT EXISTS idx_itens_pdm        ON catalogo_itens(pdm);
CREATE INDEX IF NOT EXISTS idx_itens_ncm        ON catalogo_itens(ncm);
CREATE INDEX IF NOT EXISTS idx_itens_atualizado ON catalogo_itens(atualizado_em, codigo);

-- Estado do ETL: escrito pelo catalogo-etl.yml em TODO desfecho
-- (`if: always()`); lido pelo inspetor (banner de frescor + sonda de órfãos).
CREATE TABLE IF NOT EXISTS catalogo_etl_state (
  run_id        TEXT PRIMARY KEY,
  executado_em  TEXT NOT NULL,
  tipo          TEXT NOT NULL,
  inseridos     INTEGER NOT NULL DEFAULT 0,
  atualizados   INTEGER NOT NULL DEFAULT 0,
  excluidos     INTEGER NOT NULL DEFAULT 0,
  modo          TEXT NOT NULL DEFAULT 'apply',   -- dry-run | apply
  status        TEXT NOT NULL DEFAULT 'ok',      -- ok | falhou | gates_reprovados
  amostra_exclusoes TEXT   -- JSON: até 50 ids excluídos (fonte da sonda de órfãos)
);
