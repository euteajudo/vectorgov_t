/**
 * Sidebar de navegação principal — fixo à esquerda em desktop, colapsável
 * em mobile (off-canvas com overlay).
 *
 * Links principais:
 *   - Home (dashboard)
 *   - Petições (nova + histórico)
 *   - Skills
 *   - Histórico
 *   - Ingestão de normas
 *
 * Estado mobile: controlado por `useState` com classe `translate-x` aplicada
 * via Tailwind. Em telas >= md, é sempre visível.
 */
"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FileText,
  FilePlus,
  History,
  Home,
  Library,
  Menu,
  MessageSquare,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  description?: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Início",
    icon: <Home className="h-4 w-4" />,
    description: "Painel principal",
  },
  {
    href: "/peticoes/nova",
    label: "Nova petição",
    icon: <FilePlus className="h-4 w-4" />,
    description: "Submeter para análise",
  },
  {
    href: "/notebooks",
    label: "Conversas",
    icon: <MessageSquare className="h-4 w-4" />,
    description: "Chat com documento (NotebookLM)",
  },
  {
    href: "/historico",
    label: "Histórico",
    icon: <History className="h-4 w-4" />,
    description: "Petições já analisadas",
  },
  {
    href: "/skills",
    label: "Skills",
    icon: <Sparkles className="h-4 w-4" />,
    description: "Instruções dos agentes",
  },
  {
    href: "/admin/ingestao",
    label: "Ingestão de normas",
    icon: <UploadCloud className="h-4 w-4" />,
    description: "Indexar lei/decreto",
  },
];

function NavLink({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        "flex flex-col gap-0.5 rounded-md px-3 py-2 text-sm transition-colors",
        active
          ? "bg-[color:var(--color-primary)] text-[color:var(--color-primary-foreground)]"
          : "hover:bg-[color:var(--color-accent)]",
      )}
    >
      <span className="flex items-center gap-2 font-medium">
        {item.icon}
        {item.label}
      </span>
      {item.description ? (
        <span
          className={cn(
            "ml-6 text-xs",
            active
              ? "text-[color:var(--color-primary-foreground)]/80"
              : "text-[color:var(--color-muted-foreground)]",
          )}
        >
          {item.description}
        </span>
      ) : null}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = React.useState(false);

  // Define se o link está "ativo": match exato em "/" para evitar matchar tudo,
  // e prefix-match nas demais rotas (ex.: /peticoes/abc bate em /peticoes/nova?
  // Não — usamos startsWith mas só se o href != "/").
  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <>
      {/* Trigger mobile */}
      <div className="md:hidden fixed top-3 left-3 z-40">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setOpen(true)}
          aria-label="Abrir menu de navegação"
        >
          <Menu className="h-4 w-4" />
        </Button>
      </div>

      {/* Overlay mobile */}
      {open ? (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed top-0 left-0 z-50 flex h-screen w-72 flex-col border-r border-[color:var(--color-border)] bg-[color:var(--color-card)] transition-transform md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--color-border)]">
          <Link
            href="/"
            className="flex items-center gap-2 font-semibold text-base"
            onClick={() => setOpen(false)}
          >
            <Library className="h-5 w-5 text-[color:var(--color-primary)]" />
            <span>
              Vectorgov<span className="text-[color:var(--color-primary)]">_t</span>
            </span>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={isActive(item.href)}
              onClick={() => setOpen(false)}
            />
          ))}
        </nav>

        <div className="px-5 py-4 border-t border-[color:var(--color-border)] text-xs text-[color:var(--color-muted-foreground)]">
          <div className="flex items-center gap-1.5">
            <FileText className="h-3 w-3" />
            <span>Versão 0.1.0 · Fase 3</span>
          </div>
        </div>
      </aside>
    </>
  );
}
