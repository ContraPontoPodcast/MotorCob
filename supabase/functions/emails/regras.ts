// Regras da função emails (sem rede): o e-mail de cada aviso no modelo único, o pedido de cada ação e os
// exemplos do "Enviar teste para mim" (dados fictícios).
import { botao, esc, pagina, type Remetente, type Rodape } from "../_compartilhado/email.ts";

/** Uma linha da fila (avisos_para_email). */
export interface LinhaFila {
  aviso_id: number; empresa_id: number | null; empresa_nome: string | null; assunto: string; assunto_nome: string;
  obrigatorio: boolean; remetente: Remetente; tipo: string; titulo: string; texto: string; link: string | null;
  destino: string; usuario_id: string | null; contato_id: number | null;
}

const FRENTE: Record<string, string> = {
  seguranca: "Acesso", faturas: "Faturas", financeiro_equipe: "Faturas", integracoes: "Integrações",
  integracoes_aviso: "Integrações", pausa: "Mensageria", exportacoes: "Relatórios", atendimento: "Atendimento",
  qualidade: "Qualidade", implantacao: "Implantação", equipe: "Equipe", suporte: "Suporte", comercial: "Comercial",
};
const INTERNOS = new Set(["suporte", "comercial", "financeiro_equipe"]);

export const frente = (assunto: string) => FRENTE[assunto] ?? "Avisos";
export const opcional = (l: Pick<LinhaFila, "obrigatorio" | "usuario_id">) => !l.obrigatorio && !!l.usuario_id;

/** Assunto do e-mail: o título do aviso; na equipe, com a empresa na frente quando o título não a traz. */
export function assuntoDoAviso(l: LinhaFila): string {
  const t = l.titulo.trim();
  if (INTERNOS.has(l.assunto) || l.assunto === "equipe") return t.slice(0, 150);
  return (l.empresa_nome && !t.includes(l.empresa_nome) && l.assunto === "faturas" ? `${t} · ${l.empresa_nome}` : t).slice(0, 150);
}

export function motivoDoAviso(l: LinhaFila): string {
  if (INTERNOS.has(l.assunto)) return `E-mail da equipe MotorCX: ${l.assunto_nome}.`;
  if (l.obrigatorio) {
    const quem = l.assunto === "faturas" ? "os Admins e os contatos que recebem faturas"
      : l.assunto === "pausa" ? "os Admins e Planejamento" : l.assunto === "integracoes" ? "quem criou o token e os Admins" : "você";
    return `Aviso obrigatório (${l.assunto_nome}): vai para ${quem}${l.empresa_nome ? ` da ${l.empresa_nome}` : ""}.`;
  }
  return `Você recebe porque ligou "${l.assunto_nome}" por e-mail em Minha conta › Notificações.`;
}

/** O e-mail de um aviso do sino: título, texto, botão para a plataforma e o motivo. */
export function emailAviso(l: LinhaFila, site: string, rodape: Rodape | null, sair: string | null) {
  const href = l.link ? `${site.replace(/\/$/, "")}${l.link}` : site;
  const cor = l.tipo === "erro" ? "#FDECEA" : l.tipo === "atencao" ? "#FFF4D6" : null;
  const texto = l.texto?.trim()
    ? (cor ? `<p style="margin:0 0 12px;background:${cor};border-radius:10px;padding:10px 12px;font-size:14px">${esc(l.texto)}</p>`
           : `<p style="margin:0 0 12px">${esc(l.texto)}</p>`)
    : "";
  const corpo = `${texto}<p style="margin:0">${botao(href, INTERNOS.has(l.assunto) || l.assunto === "equipe" ? "Abrir no Console" : "Abrir na plataforma")}</p>`;
  return {
    assunto: assuntoDoAviso(l),
    html: pagina({ frente: frente(l.assunto), titulo: l.titulo, corpo, motivo: motivoDoAviso(l), sair, rodape }),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ASSUNTO = /^([a-z_]{3,30}|relatorio:[0-9]{1,15})$/;
export const TESTES = ["aviso_obrigatorio", "aviso_opcional", "relatorio", "fatura"] as const;
type Teste = (typeof TESTES)[number];

export interface Pedido { acao?: "avisos" | "sair" | "teste"; u?: string; a?: string; t?: string; tipo?: Teste; erro?: string }

export function validarSair(u: unknown, a: unknown, t: unknown): Pedido {
  if (typeof u !== "string" || !UUID.test(u) || typeof a !== "string" || !ASSUNTO.test(a) ||
      typeof t !== "string" || !/^[A-Za-z0-9_-]{20,64}$/.test(t)) return { erro: "link inválido" };
  return { acao: "sair", u, a, t };
}

export function validarPedido(corpo: unknown): Pedido {
  if (!corpo || typeof corpo !== "object") return { erro: "pedido inválido" };
  const c = corpo as Record<string, unknown>;
  if (c.acao === "avisos") return { acao: "avisos" };
  if (c.acao === "sair") return validarSair(c.u, c.a, c.t);
  if (c.acao === "teste") {
    return TESTES.includes(c.tipo as Teste) ? { acao: "teste", tipo: c.tipo as Teste } : { erro: `tipo de teste: ${TESTES.join(", ")}` };
  }
  return { erro: "ação desconhecida" };
}

/** Exemplos para o "Enviar teste para mim" do Console, com dados fictícios. */
export function exemplo(tipo: Teste, site: string, rodape: Rodape | null) {
  const base: LinhaFila = { aviso_id: 0, empresa_id: 0, empresa_nome: "Alfa Recuperação (exemplo)", assunto: "pausa",
    assunto_nome: "Envios pausados", obrigatorio: true, remetente: "avisos", tipo: "atencao",
    titulo: "Envios pausados: orçamento do mês atingido", texto: "A carteira Banco Alfa chegou a 100% do orçamento de SMS de outubro.",
    link: "/mensageria", destino: "", usuario_id: null, contato_id: null };
  if (tipo === "aviso_obrigatorio") return { de: "avisos" as Remetente, ...emailAviso(base, site, rodape, null) };
  if (tipo === "aviso_opcional") {
    const l = { ...base, assunto: "exportacoes", assunto_nome: "Exportações e listas prontas", obrigatorio: false, tipo: "pronto",
                titulo: "Arquivo pronto: Funil da semana", texto: "12.480 linhas · Excel · baixar até 23/10", link: "/relatorios",
                usuario_id: "00000000-0000-0000-0000-000000000000" };
    return { de: "avisos" as Remetente, ...emailAviso(l, site, rodape, `${site}/email/sair?exemplo=1`) };
  }
  if (tipo === "relatorio") {
    const corpo = `<p style="margin:0 0 12px">Relatório <b>Funil da semana</b> · 06/10 a 12/10/2026. A comparação é com a semana anterior.</p>
<table style="width:100%;border-collapse:collapse;font-size:14px"><tr><td style="padding:6px 0">Entregues</td><td style="text-align:right;font-weight:700">182.400</td><td style="text-align:right;color:#1E7A36;padding-left:12px">+4%</td></tr></table>
<p style="margin:12px 0 0">${botao(`${site}/relatorios`, "Abrir o relatório")}</p>`;
    return { de: "relatorios" as Remetente, assunto: "Funil da semana · 06/10 a 12/10/2026 (exemplo)",
             html: pagina({ frente: "Relatórios", titulo: "Funil da semana", corpo, rodape,
                            motivo: "Você está na lista deste relatório.", sair: `${site}/email/sair?exemplo=1`, sairTexto: "Sair desta lista" }) };
  }
  const corpo = `<p style="margin:0 0 12px">Olá, equipe da Alfa Recuperação (exemplo).</p><p style="margin:0 0 12px;font-size:28px;font-weight:700">R$ 4.380,00</p>
<p style="margin:0 0 12px"><b>Vencimento:</b> 05/11/2026 · boleto, Pix ou cartão.</p><p style="margin:0">${botao(`${site}/empresa/faturamento`, "Pagar agora")}</p>`;
  return { de: "financeiro" as Remetente, assunto: "Fatura MotorCX nº 1042 · ciclo 10/2026 · vence 05/11 (exemplo)",
           html: pagina({ frente: "Faturas", titulo: "Fatura nº 1042", corpo, rodape,
                          motivo: "Você recebe porque é contato de faturas da Alfa Recuperação no MotorCX." }) };
}
