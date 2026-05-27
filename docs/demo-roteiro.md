# Roteiro de Demo — Vectorgov_t

## Para gestor público (não-técnico)

Duração: 25–30 min · Plataforma: navegador + UI local

---

## Tabela de tempos

| Bloco | Min | Tela |
|---|---|---|
| 0. Setup (antes) | -5→0 | — |
| 1. Problema | 0–3 | Slide / conversa |
| 2. Visão geral do produto | 3–6 | UI home |
| 3. Cenário A — petição PROCEDENTE | 6–14 | `/peticoes/nova` |
| 4. Cenário B — petição AMBÍGUA | 14–22 | `/peticoes/nova` |
| 5. Diferenciais técnicos | 22–26 | `/peticoes/[id]` |
| 6. Próximos passos | 26–30 | Slide / conversa |

---

## Bloco 0 — Setup (5 min antes do cliente chegar)

### Checklist

- [ ] UI rodando em `http://localhost:3000`
  - Comando: `pnpm -F @vectorgov-t/web-ui dev`
  - Verificar que a home carrega sem erro no console do navegador.
- [ ] Worker remoto respondendo:
  - `curl https://vectorgov-t-mcp.souzat19.workers.dev/health`
  - Espera: HTTP 200 com JSON de status.
- [ ] EC 132 visível em `/admin/ingestao`:
  - Abrir a aba e confirmar que "EC 132/2024" aparece na tabela com status "done".
- [ ] Petições de teste preparadas:
  - **Cenário A:** `apps/mcp-server/test/agents/caso-01-reequilibrio-ibs-cbs/` (petição de construtora pedindo reequilíbrio por impacto da CBS sobre insumos — veredito esperado: PROCEDENTE, score ≥ 0,85).
  - **Cenário B:** `apps/mcp-server/test/agents/caso-05-ambiguo/` (veredito esperado: INCONCLUSIVA, score 0,40–0,70).
  - Se os arquivos dos casos ainda não existirem no golden-set, usar os JSONs de saída dos testes unitários da pasta `apps/mcp-server/test/agents/` como script narrativo.
- [ ] Abas abertas no navegador:
  - Aba 1: `http://localhost:3000/peticoes/nova`
  - Aba 2: `http://localhost:3000/admin/ingestao`
  - Aba 3: `http://localhost:3000/historico` (backup)
- [ ] Backup se a UI cair:
  - JSONs de gabarito abertos em editor de texto — narrar os campos em voz alta.
  - Logs do Worker via `https://dash.cloudflare.com` → Workers → Vectorgov-t → Logs.

---

## Bloco 1 — Problema (3 min)

### O que dizer (texto pronto para ler em voz alta)

> "Vou falar de algo que provavelmente já está na sua mesa. A Reforma Tributária substituiu cinco tributos — ICMS, ISS, PIS, COFINS e parte do IPI — por dois novos: IBS e CBS. O Imposto Seletivo entra em 2027. A transição vai durar oito anos, até 2033. Oito anos de dois regimes convivendo ao mesmo tempo.
>
> Para qualquer contrato que seu órgão assinou antes de 2026 e que ainda está em execução, isso cria uma zona cinzenta. Se a carga tributária sobre o fornecedor mudou de forma imprevisível e relevante, a lei prevê que ele pode pedir reequilíbrio econômico-financeiro — é o Art. 124, inciso II, alínea 'd', da Lei 14.133/2021. É um direito legítimo. O problema é o volume.
>
> Hoje, quando esse pedido chega, um analista precisa ler uma petição de 30 a 50 páginas, conferir quatro ou cinco normas, montar a memória de cálculo e redigir o parecer. Isso leva de quatro a seis horas por petição. Com a Reforma, esse volume vai multiplicar nos próximos dois anos. A pergunta é: como seu órgão vai absorver isso sem errar e sem atrasar?"

### Pontos-chave (para retomar se houver perguntas)

- IBS e CBS substituem ICMS, ISS, PIS, COFINS e IPI parcial — EC 132/2023 e LC 214/2025.
- Transição: 2026 a 2033 — oito anos de regime paralelo.
- Contratos plurianuais firmados antes da vigência plena estão em risco.
- Toda alteração relevante e imprevisível na carga tributária pode gerar pedido de reequilíbrio com fundamento no Art. 124, II, "d", da Lei 14.133/2021.
- Custo humano atual: 4–6 h por petição, análise manual.

---

## Bloco 2 — Visão geral do produto (3 min)

### Telas a abrir

1. `http://localhost:3000` — home do produto.
2. `http://localhost:3000/admin/ingestao` — catálogo de normas indexadas.

### Narrativa

> "O que você está vendo é o Vectorgov_t. Antes de mais nada, vou mostrar a matéria-prima do sistema: as normas que ele conhece."
>
> [Abrir `/admin/ingestao`]
>
> "Aqui estão as normas que já foram ingeridas na base. A EC 132/2024 está aqui — são 376 dispositivos indexados, cada um armazenado com sua versão original, pronto para ser citado byte a byte. A LC 214 está em processo de ingestão — é a norma mais extensa, com mais de 4 mil dispositivos."
>
> "Quando um analista recebe uma petição de reequilíbrio, o fluxo é simples: faz o upload do documento, informa os dados do contrato e das partes, e o sistema faz o resto. O resultado chega em minutos, não em horas. E o analista revisa — o produto nunca decide por ele."

---

## Bloco 3 — Cenário A: petição PROCEDENTE (8 min)

### Petição: caso-01 — Reequilíbrio por impacto IBS/CBS

Arquivo de referência: `apps/mcp-server/test/agents/caso-01-reequilibrio-ibs-cbs/`

Cenário narrativo: Construtora com contrato de obras firmado em 2025 pede reequilíbrio alegando que a CBS, ao entrar em vigor em 2026, aumentou em 4,7 pontos percentuais a carga sobre seus insumos — variação que extrapola qualquer álea ordinária do setor.

### Passo a passo

**Passo 1 — Abrir `/peticoes/nova`**

Mostrar o formulário. Apontar os três cartões: arquivo, dados das partes, fato superveniente.

> "O formulário pediu o mínimo necessário para identificar o contrato e as partes. O fato superveniente é descrito pelo próprio analista em linguagem natural — o sistema extrai a estrutura internamente."

**Passo 2 — Upload do arquivo**

Fazer o drag-and-drop do arquivo de petição (PDF ou DOCX) na dropzone.

> "Aceita PDF e DOCX, até 50 MB. Aqui estamos usando um caso real anonimizado de uma construtora que atua em obras urbanas."

Preencher os campos:
- Número do contrato: `047/2025`
- Contratante: `Prefeitura Municipal de Exemplo/SP`
- Contratado: `Construtora Alfa Ltda`
- Requerente: `Dr. Exemplo da Silva — OAB/SP 12.345`
- Data do protocolo: data de hoje
- Fato alegado: `Vigência da CBS a partir de 01/01/2026 elevou a carga tributária sobre insumos de construção em 4,7 pontos percentuais, gerando desequilíbrio superveniente imprevisível no contrato firmado em 2025.`

Clicar em "Analisar petição".

**Passo 3 — Pipeline em execução (barra de progresso)**

Enquanto o progresso avança, narrar cada fase conforme aparece na tela:

| Fase exibida na UI | O que dizer |
|---|---|
| Planejamento (PLAN) | "O Orquestrador está decompondo a petição em subtarefas — admissibilidade, fato superveniente, nexo causal, cálculo. Cada uma vai para um agente especializado." |
| Pesquisa (EXECUTE) | "Os agentes estão consultando a base em paralelo. Busca semântica no Vectorize mais busca textual no D1 — os dois juntos entregam mais precisão do que só um deles." |
| Análise (ANALYZE) | "Analista Jurídico e Especialista de Reequilíbrio estão integrando as descobertas e montando a memória de cálculo." |
| Verificação (VERIFY) | "Este é o passo mais importante. O Auditor está verificando cada citação byte a byte contra o texto oficial. Se a citação não bater exatamente, ela é rejeitada — o sistema não aprova nada que não consiga rastrear." |
| Síntese (SYNTHESIZE) | "O Redator está consolidando tudo em uma análise técnica coerente. Daqui a pouco você vê o resultado." |

Tempo estimado total do pipeline: 45–90 segundos (depende do Worker remoto).

**Passo 4 — Tela de análise `/peticoes/[id]`**

Quando redirecionar, apontar em sequência:

1. **Badge de veredito**: "PROCEDENTE — em verde, direto no cabeçalho."
2. **Score de confiança**: "87%. Acima de 80%, o Auditor considerou que as citações cobrem o caso de forma suficiente."
3. **Hash de auditoria**: "Este código identifica unicamente esta análise e o conjunto de citações que a fundamentam. Se alguém questionar depois, é possível reproduzir."
4. **Critérios de admissibilidade**: "Cinco verificações automáticas — fato superveniente identificado, nexo causal, base legal aprovada, cálculo apresentado, score adequado."
5. **Memória de cálculo**: "Aqui está o passo a passo — percentual de impacto, base de cálculo, valor a reequilibrar. Tudo rastreável."
6. **Citações verificadas**: Clicar em uma citação para expandir. Mostrar o texto literal, o hash SHA-256 e o caminho no R2.

> "Note que cada citação mostra o texto exato da norma, o hash criptográfico e o caminho no filesystem. Isso existe para que qualquer pessoa possa contestar: 'esse artigo diz isso mesmo?' — você clica, confirma, encerra a discussão."

**Passo 5 — Gerar parecer**

Clicar em "Gerar parecer formal".

> "A partir da análise, o sistema monta o parecer nas sete seções padrão: cabeçalho, ementa, relatório dos fatos, admissibilidade, fundamentação jurídica, conclusão e recomendações. Tudo editável antes de assinar."

**Pergunta esperada:** "E se eu não concordar com o resultado?"

**Resposta:** "O parecer abre em editor inline. O analista pode alterar qualquer parágrafo, adicionar ressalvas, mudar a conclusão. O sistema não assina — quem assina é o servidor responsável. O histórico de edições fica registrado."

### Plano B se algo travar

- Pipeline para em alguma fase: abrir `/historico` e mostrar uma petição anterior com análise completa já salva.
- Worker cai: abrir o arquivo `apps/mcp-server/test/agents/caso-01-reequilibrio-ibs-cbs/gabarito-analise.json` no editor de texto e narrar os campos principais (veredito, score, citações, memória de cálculo).

---

## Bloco 4 — Cenário B: petição AMBÍGUA (8 min)

### Petição: caso-05 — Pedido com doutrina dividida

Arquivo de referência: `apps/mcp-server/test/agents/caso-05-ambiguo/`

Cenário narrativo: Empresa de TI alega que o IBS, ao incidir sobre serviços de manutenção de software, criou impacto desequilibrador. O ponto controvertido é se o serviço se enquadra como atividade tributada de forma diferente antes e depois da Reforma — matéria sobre a qual os especialistas divergem e não há orientação consolidada da Receita Federal nem acórdão do TCU.

### Passo a passo

Repetir o upload com o arquivo do caso-05. Narrar as mesmas fases do pipeline.

Quando a análise aparecer:

1. **Badge de veredito**: "INCONCLUSIVA — em cinza. O sistema não tomou partido."
2. **Score de confiança**: "48%. Abaixo de 50% significa que as citações disponíveis não cobrem a questão de forma suficiente para uma conclusão segura."
3. **Fundamentação**: Ler um trecho em voz alta — o sistema apresenta os dois lados do argumento, sem forçar uma conclusão.
4. **Pontos a complementar**: Mostrar o card com severidade "alta" — recomenda consulta à Procuradoria antes de decidir.

### Por que isso importa

> "Um sistema que sempre decide é PIOR do que um sistema que sabe quando não decidir. Se ele desse veredito nesse caso, estaria inventando uma certeza que não existe. E o analista assinaria um parecer baseado em fundamento frágil."
>
> "O que o sistema está dizendo é: a doutrina está dividida, não há acórdão do TCU sobre esse ponto específico, e a orientação da Receita Federal ainda não foi publicada. Mande para a Procuradoria. Esse é exatamente o trabalho que um analista experiente faria — e ele chegaria a mesma conclusão depois de horas. Aqui chegou em minutos."

### Frase de impacto (guardar para o momento certo)

> "Um agente que sabe quando não decidir é mais valioso do que um que sempre decide."

---

## Bloco 5 — Diferenciais técnicos (4 min)

Permanecer na tela de análise do Cenário A. Apontar cada elemento na UI enquanto fala.

### 1. Anti-alucinação por design

> "A verificação de citações não é feita pelo modelo de linguagem. É determinística — o Auditor compara o texto da citação com o texto oficial byte a byte usando SHA-256. Se não bater, a citação é rejeitada antes de chegar ao analista. O modelo só entra para calcular o score e escrever observações — não pode mudar o resultado da verificação."

### 2. Rastreabilidade total

> "Cada citação tem um hash e um caminho no storage. Isso significa que daqui a três anos, em uma auditoria, você consegue reproduzir exatamente qual era o texto da norma no momento em que a análise foi feita. Não depende de memória, não depende de quem estava no cargo."

### 3. Skills versionadas

> "As regras específicas do seu órgão — como ele formata um parecer, quais precedentes ele segue, qual é o padrão de numeração — ficam em arquivos de configuração chamados skills. Para atualizar uma regra, não precisa de deploy, não precisa de desenvolvedor. Você edita o arquivo, a mudança entra na próxima análise."

### 4. Custo previsível

> "O custo operacional estimado é de cerca de R$ 2,50 a R$ 5,00 por petição completa, dependendo da complexidade. Não tem licença por usuário, não tem custo fixo por sede."

### 5. Infraestrutura edge

> "O sistema roda na borda da rede — distribuído globalmente. O alvo de latência é 300 milissegundos para a resposta inicial. Não há servidor centralizado que possa cair sozinho."

---

## Bloco 6 — Próximos passos (4 min)

### O que dizer

> "Antes de fecharmos, quero propor algo concreto. Nós oferecemos um piloto sem custo com dez petições reais do seu órgão — anonimizadas se necessário. O objetivo é medir: quantas horas foram economizadas, qual foi a qualidade das análises comparadas ao padrão atual, quais regras internas precisam ser configuradas nas skills.
>
> O onboarding leva entre dois e cinco dias úteis — é basicamente mapear o padrão de parecer do seu órgão e configurar as skills correspondentes.
>
> Sobre LGPD: os dados do piloto ficam na infraestrutura Cloudflare, com segregação por conta, e podem ser destruídos ao final com comprovação. Não compartilhamos dados entre órgãos.
>
> O modelo comercial é por volume de petições — sem licença por usuário. Os detalhes vão pela nossa equipe comercial depois desta reunião."

### Itens do próximo passo (resumo visual)

| Item | Detalhe |
|---|---|
| Piloto | 10 petições reais, sem custo, 30 dias |
| Onboarding de skills | 2–5 dias úteis após kickoff |
| SLA e LGPD | Contrato padrão disponível |
| Modelo comercial | Por volume — equipe comercial envia proposta |
| LC 214 | Em processo de ingestão — disponível em breve |

---

*Documento gerado em 2026-05-27 para uso interno na demo F5.2.*
