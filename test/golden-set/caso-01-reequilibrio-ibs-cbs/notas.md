# Caso 01 — Reequilíbrio puro por IBS/CBS

## O que este caso testa

**O caso de uso âncora do MVP.** Demonstra a capacidade do sistema de:
1. Reconhecer a Reforma Tributária (EC 132/2023 + LC 214/2025) como fato superveniente apto a justificar reequilíbrio
2. Identificar corretamente a base legal (art. 124, II, "d" da Lei 14.133)
3. Aplicar a tese consolidada de "fato do príncipe" tributário
4. Limitar o reequilíbrio ao saldo contratual futuro

## Sinais de qualidade na análise gerada

✅ Bom:
- Cita LC 214/2025 explicitamente
- Menciona o cronograma de transição da EC 132/2023
- Calcula o delta tributário (de 13,65% para 18,1% = +4,45 pp)
- Recomenda termo aditivo para o saldo NÃO EXECUTADO

❌ Ruim (alerta):
- Cita Lei 8.666/93 (revogada) em vez de Lei 14.133
- Aplica reequilíbrio sobre parcelas já pagas
- Confunde "reequilíbrio" com "reajuste por índice"
- Ignora a EC 132/2023 (cita só LC 214 sem fundamento constitucional)

## Por que importa

Petições de reequilíbrio por mudança tributária pós-reforma serão a **maior demanda** dos órgãos públicos a partir de 2026. Se o sistema falhar AQUI, falha no caso mais importante.
