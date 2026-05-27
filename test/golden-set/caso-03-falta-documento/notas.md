# Caso 03 — Inconclusivo por falta de documentação

## O que este caso testa

A capacidade do sistema de **não tomar decisão de mérito** quando faltam elementos essenciais. O contratado:
- Cita base legal correta ✓
- Alega fato superveniente plausível (variação cambial) ✓
- Mas NÃO apresenta memória de cálculo ✗
- Pede valor R$ 0 ✗ (sinal claro)
- Promete documentos "após confirmação do interesse" — invertendo o ônus

## Comportamento esperado

✅ Bom:
- Veredito `inconclusiva`
- `score_confianca` baixo (≤ 0,50)
- `pontos_a_complementar` lista 3+ itens documentais
- Conclusão recomenda **devolver ao contratado** para suprir documentação
- NÃO sugere indeferimento por mérito (o mérito não foi avaliado)

❌ Ruim:
- Veredito `improcedente` (estaria julgando o mérito de algo não apresentado)
- Veredito `procedente` (deferindo valor R$ 0?)
- Cálculo "estimado" pelo sistema baseado em premissas inventadas

## Por que importa

O sistema precisa **respeitar o princípio do contraditório**. Devolver para o contratado completar a documentação é mais protetivo do que julgar improcedente. Esse caso testa a humildade epistêmica do agente.
