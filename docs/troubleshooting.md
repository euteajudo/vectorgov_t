# Troubleshooting — Vectorgov_t

## Erro TLS no Windows: `UNABLE_TO_VERIFY_LEAF_SIGNATURE`

**Sintoma:** Wrangler ou npm/pnpm falham com erro de certificado SSL.

**Causa:** Antivírus (Kaspersky, ESET, BitDefender, etc.) intercepta conexões TLS para inspeção, mas o Node 22+ não confia automaticamente no certificado raiz injetado pelo antivírus.

**Solução permanente:**
1. O `.npmrc` do projeto já contém `use-system-ca=true` (resolve pnpm/npm)
2. Para wrangler e scripts Node, use: `NODE_OPTIONS=--use-system-ca <comando>`
3. Adicione ao seu `~/.bashrc` ou `~/.zshrc`:
   ```bash
   export NODE_OPTIONS=--use-system-ca
   ```

**Validação:**
```bash
NODE_OPTIONS=--use-system-ca wrangler whoami
```
deve retornar email + account ID.
