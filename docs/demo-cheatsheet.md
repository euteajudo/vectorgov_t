# Cheat sheet — Vectorgov_t Demo

Uso interno. Manter aberto em segundo monitor ou impresso.

---

## Perguntas previsíveis + respostas curtas

### "Como vocês garantem que a IA não inventa coisas?"

A verificação de citações não passa pelo modelo de linguagem. O Auditor compara cada citação byte a byte contra o texto oficial armazenado no filesystem usando SHA-256 — se o texto não bater exatamente, a citação é rejeitada antes de qualquer síntese. O modelo de linguagem só entra para calcular o score de confiança e redigir observações; ele não pode aprovar uma citação que a verificação determinística rejeitou. Isso está codificado como regra de negócio, não como instrução de prompt.

### "Quanto custa por petição?"

O custo operacional estimado é de R$ 2,50 a R$ 5,00 por petição completa, dependendo da complexidade e do número de agentes acionados. O modelo comercial é por volume — sem licença por usuário, sem custo fixo por unidade gestora. A proposta detalhada vai pela equipe comercial depois desta reunião; não fechamos preço em demo.

### "E se o órgão tiver regras próprias de formato e precedente?"

As regras do órgão ficam em arquivos chamados skills — é onde você define o padrão de parecer, os precedentes que o órgão segue, a numeração interna, os tribunais de referência. Para atualizar uma regra, não precisa de deploy nem de desenvolvedor: edita o arquivo de texto e a mudança entra na próxima análise. O onboarding dessas configurações leva de dois a cinco dias úteis.

### "E a LGPD?"

Os dados processados ficam na infraestrutura Cloudflare com segregação por conta de cliente — nenhum órgão tem acesso aos dados de outro. Os documentos podem ser configurados para não sair do território brasileiro (Cloudflare tem presença no Brasil). Ao final de um piloto ou contrato, os dados são destruídos com comprovação. O contrato padrão de processamento de dados segue o Art. 7º, V e VI, da LGPD. Para exigências específicas do seu órgão, a área jurídica entra em contato diretamente.

### "E se o sistema sair do ar?"

O Worker roda em infraestrutura edge com redundância global — não há ponto único de falha. O histórico de análises já concluídas fica salvo no banco e pode ser acessado mesmo que o pipeline de análise esteja temporariamente indisponível. Para SLA formal, o contrato define disponibilidade e janela de manutenção; a equipe comercial detalha.

### "Posso integrar com o nosso sistema — SEI, Comprasnet, sistema próprio?"

O produto expõe uma API MCP padrão — qualquer sistema que consiga fazer chamadas HTTP consegue integrar. A conversa de integração com sistemas específicos (SEI, Comprasnet, ERPs próprios) é a segunda etapa depois do piloto — estamos avaliando o esforço caso a caso. Não prometemos integração pronta hoje, mas a arquitetura foi desenhada para isso.

### "Por que não usar o ChatGPT diretamente?"

Modelos genéricos não têm a base legal indexada, não fazem verificação determinística de citações e não seguem o padrão de parecer do seu órgão. O risco de alucinação em parecer jurídico é alto e o custo de uma contestação administrativa é muito maior do que o custo da ferramenta. O Vectorgov_t foi desenhado especificamente para o contexto de reequilíbrio sob a Lei 14.133/2021.

---

## Frases-âncora (usar no momento certo, não forçar)

- "A Reforma Tributária é um tsunami de petições. O que hoje leva 4 a 6 horas vai levar 4 a 6 minutos."
- "Um agente que sabe quando não decidir é mais valioso do que um que sempre decide."
- "Cada citação tem hash. Se a fonte mudar amanhã, o sistema avisa — a análise de hoje continua rastreável."
- "O analista continua assinando. O sistema acelera o trabalho dele, não o substitui."

---

## O que NÃO dizer

- Não prometer 100% de precisão em qualquer cenário — o score de confiança existe justamente porque existem incertezas.
- Não mencionar nomes de concorrentes, nem para comparar favoravelmente.
- Não inventar features que não existem: integração com SEI ou Comprasnet é "estamos avaliando" — não "temos".
- Não fechar preço ou desconto sem envolver a equipe comercial.
- Não minimizar o caso da LC 214: se perguntarem, dizer "a EC 132 já está indexada com todos os dispositivos; a LC 214 está em processo de ingestão e entra em breve — é a norma mais extensa do pacote".
- Não afirmar que o sistema substitui o parecer do procurador ou do advogado público — ele apoia a análise técnica, mas a decisão jurídica final é do servidor responsável.

---

## Backup se a UI quebrar completamente

1. Abrir `apps/mcp-server/test/agents/caso-01-reequilibrio-ibs-cbs/gabarito-analise.json` no editor de texto e narrar: veredito, score, citações, memória de cálculo.
2. Mostrar o repositório (código + README + arquitetura) como evidência de que o produto existe e está em produção.
3. Acessar os logs do Worker em `https://dash.cloudflare.com` → Workers → Vectorgov-t → Logs para mostrar chamadas reais.
4. Se necessário, reagendar a demo com acesso remoto à máquina em ambiente controlado.

---

## Referências rápidas (não mencionar em voz alta, consulta interna)

| Item | Detalhe |
|---|---|
| Worker URL | `https://vectorgov-t-mcp.souzat19.workers.dev` |
| UI local | `http://localhost:3000` |
| EC 132/2024 | 376 dispositivos indexados |
| LC 214 | Ingestão pendente (4.336 dispositivos, rate limit em R2) |
| Modelo Auditor | Gemini 3 Pro |
| Modelo demais agentes | Gemini 3.5 Flash |
| Custo estimado | Abaixo de US$ 0,50 por petição (valores operacionais de infra) |
| Skills ativas | 10 arquivos em `packages/skills/active/` |

---

*Documento gerado em 2026-05-27 para uso interno na demo F5.2.*
