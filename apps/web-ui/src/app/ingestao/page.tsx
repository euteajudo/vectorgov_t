/**
 * /ingestao — placeholder histórico do Track H. Quando o Track I subiu a
 * tela funcional em /admin/ingestao, o item do menu lateral continuou
 * apontando aqui por descuido. Esta página agora redireciona para a tela
 * dedicada — mantida só para suportar bookmarks/links antigos.
 */
import { redirect } from "next/navigation";

export default function IngestaoRedirectPage() {
  redirect("/admin/ingestao");
}
