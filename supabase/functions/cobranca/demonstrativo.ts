// Demonstrativo da fatura: transforma o que vem de demonstrativo_fatura() em seções prontas para o PDF e para o
// e-mail (sem rede e sem biblioteca de PDF; testável com node --test). O desenho do PDF fica em demonstrativo_pdf.ts.

export interface Item {
  ordem: number; item: string; descricao: string; quantidade: number; preco: number; valor: number;
  grupo: "motor" | "mensageria"; modelo?: string | null; minimo?: number | null;
  faixas?: { ate: number | null; preco: number }[] | null;
}
export interface Dados {
  fatura: { id: number; situacao: string; competencia: string; ciclo_inicio: string; ciclo_fim: string;
            emitida_em: string | null; vencimento: string; valor_total: number };
  prestador: { razao_social: string; cnpj: string | null; endereco: string | null; email: string | null };
  cliente: { razao_social: string; cnpj: string | null; endereco: string | null };
  frentes: string[];
  itens: Item[];
  ajustes: { tipo: "desconto" | "credito" | "cobranca_extra"; valor: number; motivo: string }[];
  carteiras: { carteira: string; frente: string; contratos: number; clientes: number; dias: number }[];
  canais: { canal: string; disparadas: number; entregues: number; falhas: number; respostas: number }[];
  campanhas: { origem: string; canal: string; disparadas: number }[];
}

export const brl = (v: number) => {
  const s = Math.abs(Number(v)).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (Number(v) < 0 ? "- " : "") + "R$ " + s;
};
export const precoUn = (v: number) =>
  "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 5 });
export const inteiro = (v: number) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
export const data = (d: string | null | undefined) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "");
const curta = (d: string) => data(d).slice(0, 5);
export const cnpjFmt = (c: string | null | undefined) => {
  const d = String(c ?? "").replace(/\D/g, "");
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : (c ?? "");
};

const NOMES: Record<string, string> = {
  orquestracao: "Orquestração (MotorCob)", jornada: "Jornada (MotorCli)", sms: "SMS", email: "E-mail",
  rcs_basic: "RCS Basic", rcs_single: "RCS Single", rcs_conversacional: "RCS Conversacional",
  whatsapp_marketing: "WhatsApp Marketing", whatsapp_utilidade: "WhatsApp Utilidade", whatsapp_servico: "WhatsApp Serviço",
};
const UNIDADE: Record<string, [string, string]> = {
  orquestracao: ["contrato", "contratos"], jornada: ["cliente acionado", "clientes"], email: ["e-mail", "e-mails"],
};
const unidade = (item: string) => UNIDADE[item] ?? ["mensagem", "mensagens"];
const FRENTES: Record<string, string> = { motorcob: "MotorCob", motorcli: "MotorCli" };
const CANAIS: Record<string, string> = { sms: "SMS", rcs: "RCS", email: "E-mail", whatsapp: "WhatsApp" };
const AJUSTE: Record<string, string> = { desconto: "Desconto", credito: "Crédito", cobranca_extra: "Cobrança extra" };

export interface Linha { item: string; como: string; quantidade: string; preco: string; valor: string; detalhe?: string }

/** Detalhe das faixas: progressivo mostra a conta de cada faixa; por faixa mostra em qual faixa o volume caiu. */
export function detalheFaixas(modelo: string | null | undefined, faixas: Item["faixas"], qtd: number): string | undefined {
  if (!faixas?.length || (modelo !== "progressivo" && modelo !== "faixa")) return undefined;
  const ord = [...faixas].sort((a, b) => (a.ate ?? Infinity) - (b.ate ?? Infinity));
  if (modelo === "faixa") {
    let de = 1;
    for (const f of ord) {
      if (f.ate == null || qtd <= f.ate) {
        return f.ate == null ? `Volume na faixa acima de ${inteiro(de - 1)} (${precoUn(f.preco)})`
          : `Volume na faixa de ${inteiro(de)} a ${inteiro(f.ate)} (${precoUn(f.preco)})`;
      }
      de = f.ate + 1;
    }
    return undefined;
  }
  const partes: string[] = [];
  let resto = qtd, antes = 0;
  for (const f of ord) {
    if (resto <= 0) break;
    const cabe = f.ate == null ? resto : Math.min(resto, f.ate - antes);
    if (cabe > 0) {
      const rot = f.ate == null ? `acima de ${inteiro(antes)}` : antes === 0 ? `até ${inteiro(f.ate)}` : `de ${inteiro(antes + 1)} a ${inteiro(f.ate)}`;
      partes.push(`${rot}: ${inteiro(cabe)} × ${precoUn(f.preco)} = ${brl(Math.round(cabe * f.preco * 100) / 100)}`);
    }
    resto -= cabe;
    antes = f.ate ?? antes;
  }
  return partes.join(" · ");
}

export function linhaDoItem(i: Item): Linha {
  const base = i.item.replace(/_minimo$/, "");
  const nome = NOMES[base] ?? i.descricao.split(/ · | \(/)[0];
  if (i.item.endsWith("_minimo")) {
    return { item: `Complemento do mínimo · ${nome}`, como: `Mínimo do ciclo ${i.minimo ? brl(i.minimo) : ""}`.trim(),
             quantidade: "", preco: "", valor: brl(i.valor),
             detalhe: "O uso do ciclo ficou abaixo do mínimo contratado: cobrada a diferença" };
  }
  const [um, varios] = unidade(base);
  const modelo = ({ flat: "flat", faixa: "escalonado por faixa", progressivo: "escalonado progressivo",
                    mensalidade: "mensalidade" } as Record<string, string>)[i.modelo ?? ""] ?? "";
  const como = i.modelo === "mensalidade" ? "Mensalidade do ciclo"
    : [`Por ${um}`, modelo, i.minimo ? `mínimo ${brl(i.minimo)}` : ""].filter(Boolean).join(" · ");
  const qtd = Number(i.quantidade);
  const respostas = /(\d+) respostas/.exec(i.descricao)?.[1];
  return {
    item: nome, como,
    quantidade: i.modelo === "mensalidade" ? "1" : `${inteiro(qtd)}${base === "orquestracao" || base === "jornada" ? " " + varios : ""}`,
    preco: i.modelo === "progressivo" ? "—" : precoUn(i.preco),
    valor: brl(i.valor),
    detalhe: [detalheFaixas(i.modelo, i.faixas, qtd), respostas ? `inclui ${inteiro(+respostas)} respostas de clientes` : ""]
      .filter(Boolean).join(" · ") || undefined,
  };
}

export interface Secoes {
  numero: number; emitida: string; ciclo: string; vencimento: string; total: string; frentes: string;
  prestador: string[]; cliente: string[];
  resumo: [string, string][];
  grupos: { titulo: string; linhas: Linha[] }[];
  ajustes: [string, string][];
  carteiras: string[][];
  canais: string[][];
  origens: { cabecalho: string[]; linhas: string[][] };
}

export function montar(d: Dados): Secoes {
  const motor = d.itens.filter((i) => i.grupo === "motor");
  const msg = d.itens.filter((i) => i.grupo !== "motor");
  const soma = (l: { valor: number }[]) => l.reduce((s, x) => s + Number(x.valor), 0);
  const sinal = (a: Dados["ajustes"][number]) => (a.tipo === "cobranca_extra" ? 1 : -1) * Number(a.valor);
  const resumo: [string, string][] = [];
  if (motor.length) resumo.push(["Motor de decisão · Orquestração e Jornada", brl(soma(motor))]);
  if (msg.length) {
    const canais = [...new Set(msg.map((i) => (i.item.startsWith("rcs") ? "RCS" : i.item.startsWith("whatsapp") ? "WhatsApp"
      : i.item.startsWith("email") ? "e-mail" : "SMS")))];
    resumo.push([`Mensageria · ${canais.join(", ").replace(/, ([^,]*)$/, " e $1")}`, brl(soma(msg))]);
  }
  if (d.ajustes.length) resumo.push(["Ajustes · descontos, créditos e cobranças extras", brl(d.ajustes.reduce((s, a) => s + sinal(a), 0))]);
  const canaisOrig = [...new Set(d.campanhas.map((c) => c.canal))].sort();
  const origens = [...new Set(d.campanhas.map((c) => c.origem))];
  return {
    numero: d.fatura.id,
    emitida: data(d.fatura.emitida_em),
    ciclo: `${curta(d.fatura.ciclo_inicio)} a ${data(d.fatura.ciclo_fim)}`,
    vencimento: data(d.fatura.vencimento),
    total: brl(d.fatura.valor_total),
    frentes: [...d.frentes].sort((a, b) => (a === "motorcob" ? -1 : b === "motorcob" ? 1 : a.localeCompare(b)))
      .map((f) => FRENTES[f] ?? f).join(" + ") || "—",
    prestador: [d.prestador.razao_social, d.prestador.cnpj ? `CNPJ ${cnpjFmt(d.prestador.cnpj)}` : "", d.prestador.endereco ?? ""].filter(Boolean),
    cliente: [d.cliente.razao_social, d.cliente.cnpj ? `CNPJ ${cnpjFmt(d.cliente.cnpj)}` : "", d.cliente.endereco ?? ""].filter(Boolean),
    resumo,
    grupos: [
      { titulo: "Motor de decisão", linhas: motor.map(linhaDoItem) },
      { titulo: "Mensageria", linhas: msg.map(linhaDoItem) },
    ].filter((g) => g.linhas.length),
    ajustes: d.ajustes.map((a) => [`${AJUSTE[a.tipo] ?? a.tipo} · ${a.motivo}`, brl(sinal(a))]),
    carteiras: d.carteiras.map((c) => [c.carteira, FRENTES[c.frente] ?? c.frente, c.contratos ? inteiro(c.contratos) : "—",
                                       c.clientes ? inteiro(c.clientes) : "—", inteiro(c.dias)]),
    canais: d.canais.map((c) => [CANAIS[c.canal] ?? c.canal, inteiro(c.disparadas), inteiro(c.entregues), inteiro(c.falhas),
                                 c.canal === "email" ? "—" : inteiro(c.respostas)]),
    origens: {
      cabecalho: ["Origem", ...canaisOrig.map((c) => CANAIS[c] ?? c)],
      linhas: origens.map((o) => [o, ...canaisOrig.map((c) => {
        const x = d.campanhas.find((y) => y.origem === o && y.canal === c);
        return x ? inteiro(x.disparadas) : "—";
      })]),
    },
  };
}

/** Assunto e corpo do e-mail (HTML com tudo escapado). */
export function emailFatura(s: Secoes, cliente: string, links: { demonstrativo: string; boleto?: string | null; pagar: string },
  linhaDigitavel?: string | null) {
  const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const linhas = s.resumo.map(([a, b]) => `<tr><td style="padding:6px 0;color:#1D1D1F">${esc(a)}</td><td style="padding:6px 0;text-align:right;white-space:nowrap">${esc(b)}</td></tr>`).join("");
  const botao = (href: string, texto: string, cheio: boolean) =>
    `<a href="${esc(href)}" style="display:inline-block;margin:4px 8px 4px 0;padding:10px 18px;border-radius:980px;text-decoration:none;font-weight:600;${cheio ? "background:#1D1D1F;color:#FFFFFF" : "background:#F2F2F5;color:#1D1D1F"}">${esc(texto)}</a>`;
  const assunto = `Fatura MotorCX nº ${s.numero} · ciclo ${s.ciclo} · vence ${s.vencimento.slice(0, 5)}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1D1D1F;max-width:560px">
<p>Olá, equipe da ${esc(cliente)}.</p>
<p>A fatura do ciclo de ${esc(s.ciclo)} está disponível.</p>
<p style="font-size:28px;font-weight:700;margin:8px 0">${esc(s.total)}</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">${linhas}</table>
<p><b>Vencimento:</b> ${esc(s.vencimento)} · boleto, Pix ou cartão.</p>
<p>${botao(links.pagar, "Pagar agora", true)}${botao(links.demonstrativo, "Demonstrativo (PDF)", false)}${links.boleto ? botao(links.boleto, "Boleto (PDF)", false) : ""}</p>
${linhaDigitavel ? `<p style="font-size:13px;color:#6E6E73">Linha digitável do boleto: ${esc(linhaDigitavel)}</p>` : ""}
<p style="font-size:13px;color:#6E6E73">O demonstrativo traz o que foi usado e cobrado no ciclo. A nota fiscal de serviço chega em outro e-mail quando o pagamento for confirmado. Dúvidas: Suporte na plataforma.</p>
</div>`;
  return { assunto, html };
}
