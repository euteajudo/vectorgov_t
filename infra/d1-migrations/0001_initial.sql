-- Migration 0001: Schema inicial Vectorgov_t

CREATE TABLE normas (
    id TEXT PRIMARY KEY,
    tipo TEXT NOT NULL,
    numero TEXT NOT NULL,
    ano INTEGER NOT NULL,
    data_publicacao TEXT NOT NULL,
    ementa TEXT,
    status TEXT DEFAULT 'vigente',
    r2_path TEXT NOT NULL,
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE dispositivos (
    id TEXT PRIMARY KEY,
    norma_id TEXT NOT NULL REFERENCES normas(id),
    artigo INTEGER,
    paragrafo TEXT,
    inciso TEXT,
    alinea TEXT,
    hierarquia_path TEXT,
    tipo_dispositivo TEXT DEFAULT 'artigo'
);

CREATE TABLE versoes_dispositivos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dispositivo_id TEXT NOT NULL REFERENCES dispositivos(id),
    data_inicio TEXT NOT NULL,
    data_fim TEXT,
    texto TEXT NOT NULL,
    norma_que_alterou TEXT,
    r2_path_versao TEXT
);

CREATE TABLE relacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    origem_id TEXT NOT NULL,
    tipo TEXT NOT NULL,
    destino_id TEXT NOT NULL,
    data_evento TEXT
);

CREATE INDEX idx_versoes_vigente ON versoes_dispositivos(dispositivo_id, data_inicio, data_fim);
CREATE INDEX idx_relacoes_origem ON relacoes(origem_id, tipo);
CREATE INDEX idx_relacoes_destino ON relacoes(destino_id, tipo);

-- FTS5 para busca lexical com BM25
CREATE VIRTUAL TABLE dispositivos_fts USING fts5(
    dispositivo_id UNINDEXED,
    norma_id UNINDEXED,
    artigo UNINDEXED,
    paragrafo UNINDEXED,
    hierarquia UNINDEXED,
    texto,
    tokenize = 'unicode61 remove_diacritics 2'
);
