// Regras do e-mail de relatório agendado (sem rede; testáveis com node --test): números do topo com a comparação
// com o período anterior e um link para a plataforma, no modelo único dos e-mails do sistema (SQL 42). Nada de
// anexo nem de dado de cliente.
import { botao, esc, pagina, type Rodape } from "../_compartilhado/email.ts";

export interface Metrica { funcao: string; nome: string; rotulo?: string; sentido?: "maior_melhor" | "menor_melhor" }
export interface Linha { rotulo: string; valor: string; variacao: string | null; bom: boolean | null }

export function validarEnvio(corpo: unknown): { envio?: number; erro?: string } {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return { erro: "pedido inválido" };
  const c = corpo as Record<string, unknown>;
  if (c.acao !== "enviar_resumo") return { erro: "ação desconhecida" };
  if (!Number.isSafeInteger(c.envio) || (c.envio as number) <= 0) return { erro: "envio inválido" };
  return { envio: c.envio as number };
}

const fmt = (v: number, casas: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

/** 148320 → "148.320"; taxa 93.9 → "93,9%"; razão 4.87 → "4,87" (com R$ quando o rótulo fala em R$). */
export function numero(m: Metrica, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (m.funcao === "taxa") return `${fmt(n, 1)}%`;
  const reais = /R\$/.test(m.rotulo ?? "");
  if (m.funcao === "razao" || m.funcao === "media" || reais) return `${reais ? "R$ " : ""}${fmt(n, 2)}`;
  return fmt(n, Number.isInteger(n) ? 0 : 2);
}

/** Taxa: diferença em pontos ("+1,6 ponto"); o resto: variação em % ("+12%"). bom segue o sentido da métrica. */
export function variacao(m: Metrica, atual: unknown, anterior: unknown): { texto: string | null; bom: boolean | null } {
  const a = Number(atual), b = Number(anterior);
  if (anterior === null || anterior === undefined || !Number.isFinite(a) || !Number.isFinite(b)) return { texto: null, bom: null };
  let d: number, texto: string;
  if (m.funcao === "taxa") {
    d = Math.round((a - b) * 10) / 10;
    const p = Math.abs(d);
    texto = `${d > 0 ? "+" : d < 0 ? "−" : ""}${fmt(p, 1)} ponto${p === 1 ? "" : "s"}`;
  } else {
    if (b === 0) return { texto: null, bom: null };
    d = Math.round(((a - b) / Math.abs(b)) * 100);
    texto = `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d)}%`;
  }
  const bom = d === 0 || !m.sentido ? null : (d > 0) === (m.sentido === "maior_melhor");
  return { texto, bom };
}

export function linhas(metricas: Metrica[], atual: Record<string, unknown>, anterior: Record<string, unknown> | null): Linha[] {
  return metricas.slice(0, 6).map((m) => {
    const v = variacao(m, atual[m.nome], anterior ? anterior[m.nome] : null);
    return { rotulo: m.rotulo || m.nome, valor: numero(m, atual[m.nome]), variacao: v.texto, bom: v.bom };
  });
}

const br = (d: string) => d.slice(0, 10).split("-").reverse().join("/");
export const periodoTexto = (de: string, ate: string) => de === ate ? br(de) : `${br(de).slice(0, 5)} a ${br(ate)}`;

export function emailResumo(r: { nome: string; empresa: string; periodo: string; comparado: string; linhas: Linha[]; link: string;
                             sair?: string | null; rodape?: Rodape | null }) {
  const cor = (b: boolean | null) => (b === null ? "#6E6E73" : b ? "#1E7A36" : "#B3261E");
  const tr = r.linhas.map((l) => `<tr><td style="padding:6px 0;border-bottom:1px solid #EDEDF0">${esc(l.rotulo)}</td><td style="padding:6px 0;border-bottom:1px solid #EDEDF0;text-align:right;font-weight:700;white-space:nowrap">${esc(l.valor)}</td><td style="padding:6px 0 6px 12px;border-bottom:1px solid #EDEDF0;text-align:right;white-space:nowrap;color:${cor(l.bom)}">${l.variacao ? esc(l.variacao) : ""}</td></tr>`).join("");
  const assunto = `${r.nome} · ${r.periodo}`.slice(0, 150);
  const corpo = `<p style="margin:0 0 12px">Olá, equipe da ${esc(r.empresa)}. Relatório <b>${esc(r.nome)}</b> · ${esc(r.periodo)}. A comparação é com ${esc(r.comparado)}.</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">${tr}</table>
<p style="margin:12px 0 0">${botao(r.link, "Abrir o relatório na plataforma")}</p>`;
  const html = pagina({ frente: "Relatórios", titulo: r.nome, corpo, rodape: r.rodape ?? null,
    motivo: r.sair ? "Você recebe porque está na lista deste relatório." : "Você recebe porque está na lista deste relatório. Para sair, peça a quem o criou ou ao Admin da empresa.",
    sair: r.sair ?? null, sairTexto: "Sair desta lista" });
  return { assunto, html };
}
