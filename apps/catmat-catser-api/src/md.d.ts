// Importação de .md como string (via wrangler Text rule).
declare module "*.md" {
  const content: string;
  export default content;
}
