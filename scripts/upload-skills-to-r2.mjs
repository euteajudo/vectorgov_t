#!/usr/bin/env node
/**
 * Faz upload das skills em `packages/skills/active/*.md` para o bucket
 * R2 `vectorgov-t-skills` via Wrangler CLI.
 *
 * Estratégia (sem aws-sdk):
 *   1. Lê os .md, valida o YAML front-matter via `SkillMetadata` (Zod).
 *   2. Para cada skill válida, executa `wrangler r2 object put` com o
 *      conteúdo via stdin (`--pipe`).
 *   3. Gera localmente o `_meta.md` e `_meta.json` (mesma rotina do
 *      Worker) e faz upload deles também.
 *
 * Modo dry-run (default sem flag): valida tudo, mostra o plano de
 * upload e o `_meta.md`/`_meta.json` gerado, MAS NÃO executa wrangler.
 *
 * Para upload real, passar `--apply`. Para usar bucket diferente,
 * `--bucket=outro-nome`.
 *
 * Pré-requisitos:
 *   - `pnpm install` rodado na raiz.
 *   - `wrangler login` feito (ou `CLOUDFLARE_API_TOKEN` no env).
 *   - `NODE_OPTIONS=--use-system-ca` quando atrás de proxy corporativo.
 *
 * Uso:
 *   node scripts/upload-skills-to-r2.mjs            # dry-run
 *   node scripts/upload-skills-to-r2.mjs --apply    # executa
 *   node scripts/upload-skills-to-r2.mjs --apply --bucket=meu-bucket
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

/**
 * Validação leve, sem Zod — apenas confere campos obrigatórios e tipos
 * básicos. A validação Zod completa roda nos testes do mcp-server
 * (`skills-fixtures-reais.test.ts`); o script aqui é apenas o uploader.
 */
function validarMetadataLeve(meta) {
  const obrigatorios = [
    "nome",
    "descricao",
    "trigger",
    "agentes_aplicaveis",
    "modelo_recomendado",
    "versao",
    "data_atualizacao",
    "autor",
    "tokens_aproximados",
    "categoria",
  ];
  for (const k of obrigatorios) {
    if (meta[k] === undefined || meta[k] === null) {
      return `campo obrigatório ausente: ${k}`;
    }
  }
  if (!/^[a-z0-9-]+$/.test(meta.nome)) return "nome deve ser kebab-case";
  if (!/^\d+\.\d+\.\d+$/.test(meta.versao)) return "versao deve ser SemVer";
  if (!Array.isArray(meta.agentes_aplicaveis) || meta.agentes_aplicaveis.length === 0) {
    return "agentes_aplicaveis precisa ter pelo menos 1 item";
  }
  return null;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const ACTIVE_DIR = join(REPO_ROOT, "packages", "skills", "active");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const BUCKET =
  args.find((a) => a.startsWith("--bucket="))?.split("=")[1] ??
  "vectorgov-t-skills";

const ROTULOS_CATEGORIA = {
  "analise-peticao": "Análise de petição",
  "geracao-parecer": "Geração de parecer",
  "calculo-tributario": "Cálculo tributário",
  "pesquisa-legislacao": "Pesquisa em legislação",
  utilidades: "Utilidades",
};

const ORDEM_CATEGORIAS = [
  "analise-peticao",
  "geracao-parecer",
  "calculo-tributario",
  "pesquisa-legislacao",
  "utilidades",
];

/**
 * Parser inline de YAML front-matter — mesma lógica do Worker
 * (yaml-frontmatter.ts), simplificada para um único arquivo de script.
 *
 * Manter sincronizado com a versão Worker quando o formato evoluir.
 */
function parseFrontmatter(source) {
  const normalized = source.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0] !== "---") throw new Error("missing --- start");
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---" || lines[i] === "...") {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) throw new Error("missing --- end");
  const fmLines = lines.slice(1, endIdx);
  const body = lines.slice(endIdx + 1).join("\n");

  const data = {};
  const stack = [{ obj: data, indent: -1 }];
  let listTarget = null;
  let listIndent = -1;

  const coerce = (raw) => {
    const t = raw.trim();
    if (t === "true") return true;
    if (t === "false") return false;
    if (/^-?\d+$/.test(t)) return parseInt(t, 10);
    if (t.length >= 2) {
      const first = t[0];
      const last = t[t.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        return t.slice(1, -1);
      }
    }
    return t;
  };

  const parseInline = (v) => {
    const inner = v.trim().slice(1, -1).trim();
    if (!inner) return [];
    const items = [];
    let depth = 0;
    let quote = null;
    let cur = "";
    for (const ch of inner) {
      if (quote) {
        cur += ch;
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        cur += ch;
        continue;
      }
      if (ch === "[") depth++;
      if (ch === "]") depth--;
      if (ch === "," && depth === 0) {
        items.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
    if (cur.trim()) items.push(cur);
    return items.map(coerce);
  };

  for (let i = 0; i < fmLines.length; i++) {
    const raw = fmLines[i];
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue;
    let indent = 0;
    while (indent < raw.length && raw[indent] === " ") indent++;
    const content = raw.slice(indent);

    if (content.startsWith("- ")) {
      if (!listTarget || indent !== listIndent) {
        throw new Error(`list item w/o key: ${raw}`);
      }
      listTarget.push(coerce(content.slice(2)));
      continue;
    }
    listTarget = null;
    listIndent = -1;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const colon = content.indexOf(":");
    if (colon === -1) throw new Error(`missing colon: ${raw}`);
    const key = content.slice(0, colon).trim();
    const rest = content.slice(colon + 1).trim();
    const target = stack[stack.length - 1].obj;
    if (rest === "") {
      const next = fmLines[i + 1] ?? "";
      if (next.trim().startsWith("- ")) {
        const arr = [];
        target[key] = arr;
        listTarget = arr;
        listIndent = next.search(/\S/);
      } else {
        const child = {};
        target[key] = child;
        stack.push({ obj: child, indent });
      }
      continue;
    }
    if (rest.startsWith("[")) {
      target[key] = parseInline(rest);
      continue;
    }
    target[key] = coerce(rest);
  }
  return { data, body };
}

/**
 * Lê todas as skills, valida e devolve lista de objetos válidos +
 * erros encontrados.
 */
function carregarSkills() {
  const arquivos = readdirSync(ACTIVE_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();
  const validas = [];
  const erros = [];
  for (const f of arquivos) {
    const path = join(ACTIVE_DIR, f);
    const raw = readFileSync(path, "utf-8");
    try {
      const { data } = parseFrontmatter(raw);
      const erro = validarMetadataLeve(data);
      if (erro) {
        erros.push({ arquivo: f, motivo: erro });
        continue;
      }
      const basename = f.replace(/\.md$/, "");
      if (data.nome !== basename) {
        erros.push({
          arquivo: f,
          motivo: `nome do arquivo (${basename}) != front-matter (${data.nome})`,
        });
        continue;
      }
      validas.push({ arquivo: f, conteudo: raw, metadata: data });
    } catch (err) {
      erros.push({ arquivo: f, motivo: err.message });
    }
  }
  return { validas, erros };
}

/**
 * Constrói o markdown legível do índice agregado.
 * Mantido sincronizado com `apps/mcp-server/src/lib/skills-meta-generator.ts`.
 */
function gerarMetaMd(metas) {
  const grupos = {};
  for (const m of metas) {
    if (!grupos[m.categoria]) grupos[m.categoria] = [];
    grupos[m.categoria].push(m);
  }
  for (const cat of Object.keys(grupos)) {
    grupos[cat].sort((a, b) => a.nome.localeCompare(b.nome));
  }
  const partes = [
    "# Skills disponíveis",
    "",
    "Use `skill_carregar(nome)` para baixar o conteúdo completo de uma skill.",
    "",
    `Total: ${metas.length} skills ativas.`,
    "",
  ];
  for (const cat of ORDEM_CATEGORIAS) {
    const lista = grupos[cat];
    if (!lista || lista.length === 0) continue;
    partes.push(`## ${ROTULOS_CATEGORIA[cat]}`);
    partes.push("");
    partes.push("| Nome | Descrição | Tokens |");
    partes.push("|---|---|---|");
    for (const m of lista) {
      const desc =
        m.descricao.length > 120 ? `${m.descricao.slice(0, 117)}...` : m.descricao;
      partes.push(`| \`${m.nome}\` | ${desc} | ${m.tokens_aproximados} |`);
    }
    partes.push("");
  }
  return partes.join("\n");
}

// Estados do FSM conversacional (sincronizar com EstadoConversaSchema no
// pacote @vectorgov-t/schemas). Skills GLOBAIS (fases_aplicaveis vazio)
// entram em todas as fases.
const FASES_FSM = [
  "AGUARDANDO_DOCUMENTO",
  "DOCUMENTO_RECEBIDO",
  "PETICAO_EXTRAIDA",
  "ANALISE_PRONTA",
  "PARECER_GERADO",
];

function gerarMetaJson(metas) {
  const grupos = {};
  for (const m of metas) {
    if (!grupos[m.categoria]) grupos[m.categoria] = [];
    grupos[m.categoria].push(m.nome);
  }
  for (const cat of Object.keys(grupos)) grupos[cat].sort();

  // Agrupamento por fase — mesma lógica do skills-meta-generator.ts.
  const porFase = {};
  for (const f of FASES_FSM) porFase[f] = [];
  for (const m of metas) {
    const fases =
      Array.isArray(m.fases_aplicaveis) && m.fases_aplicaveis.length > 0
        ? m.fases_aplicaveis
        : FASES_FSM; // vazio = global
    for (const f of fases) (porFase[f] ??= []).push(m.nome);
  }
  for (const f of Object.keys(porFase)) porFase[f].sort();

  return {
    versao_formato: "1.0.0",
    gerado_em: new Date().toISOString(),
    total_skills: metas.length,
    skills: metas
      .slice()
      .sort((a, b) => a.nome.localeCompare(b.nome))
      .map((m) => ({
        nome: m.nome,
        descricao: m.descricao,
        categoria: m.categoria,
        versao: m.versao,
        tokens_aproximados: m.tokens_aproximados,
        agentes_aplicaveis: m.agentes_aplicaveis,
        fases_aplicaveis: Array.isArray(m.fases_aplicaveis)
          ? m.fases_aplicaveis
          : [],
      })),
    por_categoria: grupos,
    por_fase: porFase,
  };
}

/**
 * Executa `wrangler r2 object put <key> --file=- --pipe` com stdin.
 *
 * Usamos `--pipe` para não criar arquivo temporário; wrangler aceita
 * lendo de stdin nesta forma.
 */
function wranglerPutFromStdin(key, content, contentType) {
  return new Promise((resolveP, rejectP) => {
    const args = [
      "r2",
      "object",
      "put",
      `${BUCKET}/${key}`,
      "--pipe",
      `--content-type=${contentType}`,
      "--remote",
    ];
    const child = spawn("wrangler", args, {
      stdio: ["pipe", "inherit", "inherit"],
      shell: process.platform === "win32",
    });
    child.on("error", rejectP);
    child.on("exit", (code) => {
      if (code === 0) resolveP();
      else rejectP(new Error(`wrangler exit ${code} para ${key}`));
    });
    child.stdin.write(content);
    child.stdin.end();
  });
}

async function main() {
  console.log(`[skills-upload] modo: ${APPLY ? "APPLY (real)" : "DRY-RUN"}`);
  console.log(`[skills-upload] bucket: ${BUCKET}`);
  console.log(`[skills-upload] dir   : ${ACTIVE_DIR}`);

  const { validas, erros } = carregarSkills();

  console.log(`\n[skills-upload] skills válidas: ${validas.length}`);
  for (const s of validas) {
    console.log(
      `  - ${s.arquivo}  v${s.metadata.versao}  cat=${s.metadata.categoria}  tok=${s.metadata.tokens_aproximados}`,
    );
  }
  if (erros.length > 0) {
    console.error(`\n[skills-upload] ERROS: ${erros.length}`);
    for (const e of erros) {
      console.error(`  - ${e.arquivo}: ${e.motivo}`);
    }
    process.exit(2);
  }

  const metas = validas.map((v) => v.metadata);
  const metaMd = gerarMetaMd(metas);
  const metaJson = gerarMetaJson(metas);

  console.log(
    `\n[skills-upload] _meta.md   = ${Buffer.byteLength(metaMd, "utf-8")} bytes (~${Math.round(Buffer.byteLength(metaMd, "utf-8") / 4)} tokens)`,
  );
  console.log(
    `[skills-upload] _meta.json = ${Buffer.byteLength(JSON.stringify(metaJson, null, 2), "utf-8")} bytes`,
  );

  if (!APPLY) {
    console.log("\n[skills-upload] DRY-RUN — preview do _meta.md:\n");
    console.log("─".repeat(60));
    console.log(metaMd);
    console.log("─".repeat(60));
    console.log(
      `\n[skills-upload] DRY-RUN concluído. ${validas.length} skills + _meta.* prontos para upload.`,
    );
    console.log("[skills-upload] Para enviar de verdade, rode com --apply.");
    return;
  }

  console.log("\n[skills-upload] iniciando upload via wrangler r2 object put...");
  // Upload das skills.
  for (const s of validas) {
    const key = `active/${s.metadata.nome}.md`;
    process.stdout.write(`  → ${key} ...`);
    await wranglerPutFromStdin(key, s.conteudo, "text/markdown; charset=utf-8");
    process.stdout.write(" ok\n");
  }
  // Upload do _meta.
  process.stdout.write("  → _meta.md ...");
  await wranglerPutFromStdin("_meta.md", metaMd, "text/markdown; charset=utf-8");
  process.stdout.write(" ok\n");
  process.stdout.write("  → _meta.json ...");
  await wranglerPutFromStdin(
    "_meta.json",
    JSON.stringify(metaJson, null, 2),
    "application/json; charset=utf-8",
  );
  process.stdout.write(" ok\n");

  console.log(
    `\n[skills-upload] OK — ${validas.length} skills + _meta.md + _meta.json publicados em ${BUCKET}.`,
  );
}

main().catch((err) => {
  console.error("[skills-upload] FATAL:", err);
  process.exit(1);
});
