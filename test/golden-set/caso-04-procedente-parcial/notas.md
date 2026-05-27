# Caso 04 — Procedência parcial (erro de cálculo)

## O que este caso testa

A capacidade do sistema de **distinguir entre o pedido em si (procedente) e a forma de calcular (errada)**. O contratado:
- Tem direito ao reequilíbrio ✓ (fato superveniente real)
- Usa índice ERRADO (IPCA geral em vez de INCC ou setorial) ✗
- Faz uma incoerência no próprio cálculo (R$ 18k vira R$ 87k sem explicação) ✗

## Comportamento esperado

✅ Bom:
- Veredito `parcialmente_procedente`
- Reconhece o direito ao reequilíbrio
- Calculista recalcula com índice correto
- Recomenda valor MENOR que o pleiteado, com memória de cálculo nova
- Aponta a inconsistência aritmética do contratado

❌ Ruim:
- Aprova o valor pleiteado sem questionar metodologia
- Indefere por causa do erro de cálculo (estaria punindo o contratado pela má matemática quando ele tem direito ao mérito)

## Por que importa

Esse é o **caso mais difícil cognitivamente** porque exige separação clara entre 2 dimensões:
1. Cabe reequilíbrio? → SIM
2. O valor pedido está certo? → NÃO

O sistema precisa fazer essa decomposição e propor um valor próprio, baseado em cálculo correto.
