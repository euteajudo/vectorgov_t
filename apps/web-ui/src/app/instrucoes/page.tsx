/**
 * `/instrucoes` — Guia de uso para o usuário final (linguagem não técnica).
 *
 * Server component estático: explica o que o sistema faz, como usar e o que
 * ele entrega — sem detalhes de implementação.
 */
import type { JSX } from "react";
import {
  FileUp,
  ScanText,
  CheckCheck,
  FileText,
  MessagesSquare,
  Scale,
  Calculator,
  BookOpen,
} from "lucide-react";

const PASSOS = [
  {
    n: 1,
    icon: <FileUp className="h-5 w-5" />,
    titulo: "Anexar o pedido",
    texto:
      "Crie uma conversa e anexe o PDF do pedido de reequilíbrio econômico-financeiro feito pela empresa contratada.",
  },
  {
    n: 2,
    icon: <ScanText className="h-5 w-5" />,
    titulo: "O sistema extrai os dados",
    texto:
      "O assistente lê o documento e organiza os dados do pedido: contrato, partes, fato alegado, valor e fundamentos.",
  },
  {
    n: 3,
    icon: <CheckCheck className="h-5 w-5" />,
    titulo: "Conferir e analisar",
    texto:
      "Você confere (e corrige, se preciso) os dados extraídos e pede a análise. O assistente avalia o caso.",
  },
  {
    n: 4,
    icon: <FileText className="h-5 w-5" />,
    titulo: "Gerar o parecer",
    texto:
      "Com a análise pronta, você pede o parecer formal — um documento completo, pronto para uso no processo.",
  },
];

const RECURSOS = [
  {
    icon: <Scale className="h-5 w-5" />,
    titulo: "Consulta à legislação",
    texto: "Localiza e cita os artigos de lei aplicáveis ao caso.",
  },
  {
    icon: <BookOpen className="h-5 w-5" />,
    titulo: "Jurisprudência do TCU",
    texto:
      "Busca precedentes (acórdãos) do Tribunal de Contas da União sobre reequilíbrio.",
  },
  {
    icon: <Calculator className="h-5 w-5" />,
    titulo: "Cálculo do reequilíbrio",
    texto: "Estima o valor do reequilíbrio com base nos dados do pedido.",
  },
];

const FAQ = [
  {
    q: "A análise saiu “inconclusiva”. E agora?",
    a: "Significa que falta documentação ou informação para uma conclusão segura. Complemente o que o assistente apontar e peça para reanalisar.",
  },
  {
    q: "Um dado foi extraído errado. Posso corrigir?",
    a: "Sim. É só dizer ao assistente o valor correto (ex.: “o valor do contrato é R$ ...”) antes de pedir a análise.",
  },
  {
    q: "Preciso saber direito qual é a próxima etapa?",
    a: "Não. Na tela de conversa, a barra à direita mostra em que fase você está, qual a próxima e o que pedir. O assistente também oferece botões com as próximas ações.",
  },
  {
    q: "Posso confiar nas citações de leis e acórdãos?",
    a: "O sistema fundamenta as citações em fontes reais (a base de leis e os acórdãos carregados) e evita inventar números. Ainda assim, a revisão humana final é recomendada.",
  },
];

export default function InstrucoesPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">Instruções de uso</h1>
        <p className="text-gray-600">
          Este assistente analisa <strong>pedidos de reequilíbrio
          econômico-financeiro</strong> de contratos públicos e gera um{" "}
          <strong>parecer técnico-jurídico fundamentado</strong>, pronto para o
          processo. Você conversa com ele em linguagem natural — ele conduz cada
          etapa.
        </p>
      </header>

      {/* Como funciona */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">
          Como funciona, em 4 passos
        </h2>
        <ol className="space-y-3">
          {PASSOS.map((p) => (
            <li
              key={p.n}
              className="flex gap-4 rounded-lg border border-gray-200 bg-white p-4"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                {p.icon}
              </div>
              <div>
                <div className="font-medium text-gray-900">
                  {p.n}. {p.titulo}
                </div>
                <p className="mt-0.5 text-sm text-gray-600">{p.texto}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Como conversar */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-xl font-semibold text-gray-900">
          <MessagesSquare className="h-5 w-5 text-blue-600" /> Como conversar com
          o assistente
        </h2>
        <p className="text-gray-600">
          A conversa é guiada. A cada passo o assistente sugere as próximas ações
          em <strong>botões</strong> — basta clicar. Você também pode pedir em
          linguagem natural (ex.: “analise o pedido”, “gere o parecer”). Quando
          uma etapa importante conclui, aparece um destaque na conversa:
        </p>
        <ul className="ml-4 list-disc space-y-1 text-sm text-gray-600">
          <li>
            <strong>“Análise concluída”</strong> — o caso foi avaliado; você pode
            ver o resultado ou gerar o parecer.
          </li>
          <li>
            <strong>“Parecer formal gerado”</strong> — o documento ficou pronto
            para abrir/baixar.
          </li>
        </ul>
        <p className="text-sm text-gray-500">
          Dica: a barra à direita da conversa mostra sempre em que fase você está
          e o que pedir em seguida.
        </p>
      </section>

      {/* O que você recebe */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">
          O que você recebe
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-green-200 bg-green-50 p-4">
            <div className="font-medium text-green-900">A Análise</div>
            <p className="mt-1 text-sm text-green-800">
              Uma avaliação do caso: se o pedido é admissível, se há ligação
              entre o fato alegado e o desequilíbrio, o <strong>valor</strong> do
              reequilíbrio, o mérito e os <strong>precedentes do TCU</strong> que
              se aplicam.
            </p>
          </div>
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
            <div className="font-medium text-indigo-900">O Parecer formal</div>
            <p className="mt-1 text-sm text-indigo-800">
              O documento final, no padrão de pareceres (relatório dos fatos,
              fundamentação jurídica e conclusão com recomendações) — pronto para
              anexar ao processo.
            </p>
          </div>
        </div>
      </section>

      {/* Recursos */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">
          O que o assistente consulta
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {RECURSOS.map((r) => (
            <div
              key={r.titulo}
              className="rounded-lg border border-gray-200 bg-white p-4"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-600">
                {r.icon}
              </div>
              <div className="mt-2 font-medium text-gray-900">{r.titulo}</div>
              <p className="mt-0.5 text-sm text-gray-600">{r.texto}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-gray-900">
          Perguntas frequentes
        </h2>
        <dl className="space-y-3">
          {FAQ.map((f) => (
            <div
              key={f.q}
              className="rounded-lg border border-gray-200 bg-white p-4"
            >
              <dt className="font-medium text-gray-900">{f.q}</dt>
              <dd className="mt-1 text-sm text-gray-600">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
