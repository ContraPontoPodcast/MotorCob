// Regras da cobrança (sem rede, testáveis com node --test): o que vai para o Stripe e para o Focus NFe e como
// ler o que volta. A função index.ts só faz as chamadas e grava no banco.

export const STRIPE = "https://api.stripe.com/v1";
export const FOCUS = { producao: "https://api.focusnfe.com.br/v2", homologacao: "https://homologacao.focusnfe.com.br/v2" };
export const FORMAS = ["boleto", "pix", "cartao"] as const;
export type Forma = (typeof FORMAS)[number];

export interface Pedido {
  acao: "pagar" | "enviar_fatura" | "demonstrativo" | "emitir_nf" | "recargas_automaticas" | "lembrar_fatura";
  fatura?: number;
  tipo?: "d1" | "d5" | "d7";
  recarga?: number;
  forma?: Forma;
}

export function validarPedido(corpo: unknown): { pedido?: Pedido; erro?: string } {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return { erro: "pedido inválido" };
  const c = corpo as Record<string, unknown>;
  const acoes = ["pagar", "enviar_fatura", "demonstrativo", "emitir_nf", "recargas_automaticas", "lembrar_fatura"];
  if (!acoes.includes(c.acao as string)) return { erro: "ação desconhecida" };
  const p: Pedido = { acao: c.acao as Pedido["acao"] };
  for (const k of ["fatura", "recarga"] as const) {
    if (c[k] !== undefined && c[k] !== null) {
      if (!Number.isSafeInteger(c[k]) || (c[k] as number) <= 0) return { erro: `${k} inválida` };
      p[k] = c[k] as number;
    }
  }
  if (p.acao === "recargas_automaticas") return { pedido: p };
  if (p.acao === "lembrar_fatura") {
    if (!p.fatura || p.recarga) return { erro: "informe a fatura" };
    if (!["d1", "d5", "d7"].includes(c.tipo as string)) return { erro: "lembrete inválido: d1, d5 ou d7" };
    p.tipo = c.tipo as Pedido["tipo"];
    return { pedido: p };
  }
  if ((p.acao === "enviar_fatura" || p.acao === "demonstrativo") && (!p.fatura || p.recarga)) return { erro: "informe a fatura" };
  if (!p.fatura === !p.recarga) return { erro: "informe a fatura ou a recarga" };
  if (p.acao === "pagar") {
    if (!FORMAS.includes(c.forma as Forma)) return { erro: "forma de pagamento inválida: boleto, pix ou cartao" };
    p.forma = c.forma as Forma;
  }
  return { pedido: p };
}

// ---------------------------------------------------------------- Stripe
/** Corpo application/x-www-form-urlencoded do Stripe: {a: {b: 1}, c: [x]} → a[b]=1&c[0]=x */
export function formStripe(obj: Record<string, unknown>, prefixo = ""): string {
  const partes: string[] = [];
  const add = (chave: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((x, i) => add(`${chave}[${i}]`, x));
    else if (typeof v === "object") for (const [k, x] of Object.entries(v as object)) add(`${chave}[${k}]`, x);
    else partes.push(`${encodeURIComponent(chave)}=${encodeURIComponent(String(v))}`);
  };
  for (const [k, v] of Object.entries(obj)) add(prefixo ? `${prefixo}[${k}]` : k, v);
  return partes.join("&");
}

export const centavos = (valor: number) => Math.round(Number(valor) * 100);
const digitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");
// boleto e Pix pedem nome e endereço com letras do ASCII básico
export const ascii = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

export interface Empresa {
  id: number;
  nome: string;
  razao_social?: string | null;
  cnpj?: string | null;
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  uf?: string | null;
  codigo_ibge?: number | null;
}

/** Dados de cobrança da empresa (CNPJ, endereço e e-mail do financeiro) ou o que falta no cadastro. */
export function dadosCobranca(e: Empresa, email: string | null | undefined):
  { dados?: { nome: string; email: string; cnpj: string; endereco: Record<string, string> }; erro?: string } {
  const falta: string[] = [];
  const cnpj = digitos(e.cnpj);
  if (cnpj.length !== 14) falta.push("CNPJ");
  if (!e.logradouro || !e.municipio || !/^[A-Z]{2}$/.test(e.uf ?? "") || digitos(e.cep).length !== 8) falta.push("endereço com CEP");
  if (!email || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) falta.push("e-mail do contato financeiro");
  if (falta.length) return { erro: `Complete o cadastro da empresa para gerar a cobrança: ${falta.join(", ")} (Empresa › Cadastro e Contatos).` };
  const cep = digitos(e.cep);
  return {
    dados: {
      nome: ascii(e.razao_social || e.nome).slice(0, 120),
      email: email!.trim().toLowerCase(),
      cnpj,
      endereco: {
        line1: ascii(`${e.logradouro}${e.numero ? ", " + e.numero : ""}`).slice(0, 200),
        ...(e.complemento ? { line2: ascii(e.complemento).slice(0, 200) } : {}),
        city: ascii(e.municipio).slice(0, 100),
        state: e.uf!,
        postal_code: `${cep.slice(0, 5)}-${cep.slice(5)}`,
        country: "BR",
      },
    },
  };
}

export function clienteStripe(empresaId: number, d: NonNullable<ReturnType<typeof dadosCobranca>["dados"]>) {
  return {
    name: d.nome, email: d.email, address: d.endereco, preferred_locales: ["pt-BR"],
    tax_id_data: [{ type: "br_cnpj", value: d.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") }],
    metadata: { empresa_id: String(empresaId) },
  };
}

/** Dias até o vencimento do boleto (Stripe aceita de 0 a 60). */
export function diasBoleto(vencimento: string | null | undefined, hoje: string): number {
  if (!vencimento) return 3;
  const d = Math.round((Date.parse(vencimento + "T12:00:00Z") - Date.parse(hoje + "T12:00:00Z")) / 86400000);
  return Math.min(60, Math.max(1, d));
}

export interface Alvo {
  tipo: "fatura" | "recarga";
  id: number;
  empresa_id: number;
  valor: number;
  descricao: string;
  vencimento?: string | null;
}

/** PaymentIntent já confirmado (boleto ou Pix) com os dados do cliente. */
export function paymentIntent(forma: "boleto" | "pix", alvo: Alvo, cliente: string, cobranca: number,
  d: NonNullable<ReturnType<typeof dadosCobranca>["dados"]>, hoje: string) {
  const meta = { cobranca_id: String(cobranca), [`${alvo.tipo}_id`]: String(alvo.id), empresa_id: String(alvo.empresa_id) };
  const base = {
    amount: centavos(alvo.valor), currency: "brl", customer: cliente, confirm: true, description: alvo.descricao.slice(0, 200),
    payment_method_types: [forma], metadata: meta,
  };
  if (forma === "boleto") {
    return {
      ...base,
      payment_method_data: { type: "boleto", boleto: { tax_id: d.cnpj }, billing_details: { name: d.nome, email: d.email, address: d.endereco } },
      payment_method_options: { boleto: { expires_after_days: diasBoleto(alvo.vencimento, hoje) } },
    };
  }
  return {
    ...base,
    payment_method_data: { type: "pix", billing_details: { name: d.nome, email: d.email, tax_id: d.cnpj } },
    payment_method_options: { pix: { expires_after_seconds: 86400 } },          // QR Code vale 24 h
  };
}

/** Página do cartão (Checkout). Na recarga com recarga automática, o cartão fica guardado para as próximas. */
export function checkoutCartao(alvo: Alvo, cliente: string, cobranca: number, voltar: string, guardar: boolean) {
  const meta = { cobranca_id: String(cobranca), [`${alvo.tipo}_id`]: String(alvo.id), empresa_id: String(alvo.empresa_id) };
  return {
    mode: "payment", customer: cliente, payment_method_types: ["card"], locale: "pt-BR",
    line_items: [{ quantity: 1, price_data: { currency: "brl", unit_amount: centavos(alvo.valor), product_data: { name: alvo.descricao.slice(0, 200) } } }],
    success_url: `${voltar}?pagamento=ok`, cancel_url: `${voltar}?pagamento=cancelado`, metadata: meta,
    payment_intent_data: { metadata: meta, ...(guardar ? { setup_future_usage: "off_session" } : {}) },
    ...(guardar ? { saved_payment_method_options: { payment_method_save: "enabled" } } : {}),
  };
}

/** Recarga automática no cartão guardado, sem a pessoa na tela. */
export function cobrancaAutomatica(alvo: Alvo, cliente: string, cartao: string, cobranca: number) {
  return {
    amount: centavos(alvo.valor), currency: "brl", customer: cliente, payment_method: cartao, payment_method_types: ["card"],
    off_session: true, confirm: true, description: alvo.descricao.slice(0, 200),
    metadata: { cobranca_id: String(cobranca), recarga_id: String(alvo.id), empresa_id: String(alvo.empresa_id) },
  };
}

export interface Gerada { id_externo: string; link: string | null; pix_copia_cola: string | null; boleto_codigo: string | null; expira_em: string | null }

/** PDF do boleto que o Stripe gera (vai separado do demonstrativo). */
export const pdfDoBoleto = (obj: Record<string, any>): string | null => {
  const u = obj?.next_action?.boleto_display_details?.pdf;
  return typeof u === "string" && u.startsWith("https://") ? u : null;
};

/** O que mostrar ao cliente, a partir do PaymentIntent ou da sessão do Checkout. */
export function lerGerada(obj: Record<string, any>): Gerada {
  const iso = (t: unknown) => (typeof t === "number" ? new Date(t * 1000).toISOString() : null);
  const https = (u: unknown) => (typeof u === "string" && u.startsWith("https://") ? u : null);
  if (obj.object === "checkout.session") {
    return { id_externo: obj.id, link: https(obj.url), pix_copia_cola: null, boleto_codigo: null, expira_em: iso(obj.expires_at) };
  }
  const b = obj.next_action?.boleto_display_details;
  if (b) return { id_externo: obj.id, link: https(b.hosted_voucher_url), pix_copia_cola: null, boleto_codigo: b.number ?? null, expira_em: iso(b.expires_at) };
  const p = obj.next_action?.pix_display_qr_code;
  if (p) return { id_externo: obj.id, link: https(p.hosted_instructions_url), pix_copia_cola: p.data ?? null, boleto_codigo: null, expira_em: iso(p.expires_at) };
  return { id_externo: obj.id, link: null, pix_copia_cola: null, boleto_codigo: null, expira_em: null };
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Confere o cabeçalho Stripe-Signature (t=…,v1=…): HMAC-SHA256 de "t.corpo" com o segredo do webhook. */
export async function assinaturaStripeValida(corpo: string, cabecalho: string | null, segredo: string,
  agoraSeg = Math.floor(Date.now() / 1000), tolerancia = 300): Promise<boolean> {
  if (!cabecalho || !segredo) return false;
  const partes = cabecalho.split(",").map((p) => p.trim().split("="));
  const t = Number(partes.find(([k]) => k === "t")?.[1]);
  const v1 = partes.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || !v1.length || Math.abs(agoraSeg - t) > tolerancia) return false;
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const esperado = hex(await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(`${t}.${corpo}`)));
  return v1.some((v) => iguais(v, esperado));
}

/** Comparação em tempo constante. */
export function iguais(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Evento do Stripe → o que fazer no banco. */
export function acaoDoEvento(ev: { type: string; data: { object: Record<string, any> } }):
  { baixar?: string; falhou?: { id: string; motivo: string; situacao: "falhou" | "expirada" }; guardarCartao?: string } {
  const o = ev.data?.object ?? {};
  switch (ev.type) {
    case "payment_intent.succeeded":
      return { baixar: o.id };
    case "checkout.session.completed":
      if (o.payment_status !== "paid") return {};
      return { baixar: o.id, ...(o.payment_intent ? { guardarCartao: o.payment_intent } : {}) };
    case "checkout.session.expired":
      return { falhou: { id: o.id, motivo: "página do cartão expirou sem pagamento", situacao: "expirada" } };
    case "payment_intent.payment_failed": {
      const tipo = o.last_payment_error?.payment_method?.type ?? o.payment_method_types?.[0];
      const expirou = tipo === "boleto" || tipo === "pix";
      const motivo = expirou ? `${tipo === "pix" ? "Pix" : "boleto"} venceu sem pagamento`
        : `cartão recusado: ${o.last_payment_error?.message ?? "sem detalhe"}`;
      return { falhou: { id: o.id, motivo: motivo.slice(0, 300), situacao: expirou ? "expirada" : "falhou" } };
    }
  }
  return {};
}

// ---------------------------------------------------------------- NFS-e nacional (Focus NFe)
export interface NfConfig {
  ativo: boolean;
  ambiente: "homologacao" | "producao";
  emitir_quando: "pagamento" | "emissao";
  cnpj_prestador: string | null;
  inscricao_municipal_prestador: string | null;
  codigo_municipio_emissora: number | null;
  codigo_municipio_prestacao: number | null;
  codigo_tributacao_nacional_iss: string | null;
  codigo_tributacao_municipal_iss: string | null;
  codigo_nbs: string | null;
  codigo_opcao_simples_nacional: number;
  regime_tributario_simples_nacional: number | null;
  regime_especial_tributacao: number;
  tributacao_iss: number;
  tipo_retencao_iss: number;
  percentual_aliquota_iss: number | null;
  descricao_fatura: string;
  descricao_recarga: string;
}

export function faltaNaConfig(c: NfConfig): string[] {
  const f: string[] = [];
  if (!c.cnpj_prestador) f.push("CNPJ do prestador");
  if (!c.codigo_municipio_emissora) f.push("município emissor (código IBGE)");
  if (!c.codigo_municipio_prestacao) f.push("município da prestação (código IBGE)");
  if (!c.codigo_tributacao_nacional_iss) f.push("código de tributação nacional do ISS");
  if (c.codigo_opcao_simples_nacional === 3 && !c.regime_tributario_simples_nacional) f.push("regime de apuração do Simples");
  return f;
}

/** Corpo do POST /nfsen?ref=… */
export function notaFocus(c: NfConfig, e: Empresa, email: string, valor: number, descricao: string, agora: Date) {
  const sp = new Date(agora.getTime() - 3 * 3600000).toISOString();          // horário de Brasília
  return {
    data_emissao: sp.slice(0, 19) + "-03:00",
    data_competencia: sp.slice(0, 10),
    codigo_municipio_emissora: c.codigo_municipio_emissora,
    cnpj_prestador: digitos(c.cnpj_prestador),
    ...(c.inscricao_municipal_prestador ? { inscricao_municipal_prestador: c.inscricao_municipal_prestador } : {}),
    codigo_opcao_simples_nacional: c.codigo_opcao_simples_nacional,
    ...(c.regime_tributario_simples_nacional ? { regime_tributario_simples_nacional: c.regime_tributario_simples_nacional } : {}),
    regime_especial_tributacao: c.regime_especial_tributacao,
    cnpj_tomador: digitos(e.cnpj),
    razao_social_tomador: (e.razao_social || e.nome).slice(0, 150),
    email_tomador: email,
    ...(e.codigo_ibge ? {
      codigo_municipio_tomador: e.codigo_ibge, cep_tomador: digitos(e.cep),
      logradouro_tomador: (e.logradouro ?? "").slice(0, 255), numero_tomador: (e.numero || "S/N").slice(0, 60),
      ...(e.complemento ? { complemento_tomador: e.complemento.slice(0, 156) } : {}),
      ...(e.bairro ? { bairro_tomador: e.bairro.slice(0, 60) } : {}),
    } : {}),
    codigo_municipio_prestacao: c.codigo_municipio_prestacao,
    codigo_tributacao_nacional_iss: c.codigo_tributacao_nacional_iss,
    ...(c.codigo_tributacao_municipal_iss ? { codigo_tributacao_municipal_iss: c.codigo_tributacao_municipal_iss } : {}),
    ...(c.codigo_nbs ? { codigo_nbs: c.codigo_nbs } : {}),
    descricao_servico: descricao.slice(0, 2000),
    valor_servico: Number(Number(valor).toFixed(2)),
    tributacao_iss: c.tributacao_iss,
    tipo_retencao_iss: c.tipo_retencao_iss,
    ...(c.percentual_aliquota_iss != null ? { percentual_aliquota_relativa_municipio: Number(c.percentual_aliquota_iss) } : {}),
  };
}

/** Texto da nota: {ciclo} vira "21/09/2026 a 20/10/2026". */
export function descricaoNota(modelo: string, ciclo?: { inicio: string; fim: string } | null) {
  const br = (d: string) => d.slice(0, 10).split("-").reverse().join("/");
  return modelo.replace("{ciclo}", ciclo ? `${br(ciclo.inicio)} a ${br(ciclo.fim)}` : "").trim();
}

/** Resposta do GET /nfsen/{ref} → linha de notas_fiscais. */
export function lerNota(r: Record<string, any>, base: string) {
  const situacao = ({ autorizado: "autorizada", cancelado: "cancelada", erro_autorizacao: "erro", negado: "negada" } as Record<string, string>)[r.status]
    ?? "processando";
  const abs = (u: unknown) => (typeof u === "string" && u ? (u.startsWith("https://") ? u : u.startsWith("/") ? new URL(base).origin + u : null) : null);
  const erros = Array.isArray(r.erros) ? r.erros.map((e: any) => [e.mensagem, e.correcao].filter(Boolean).join(" — ")).join(" · ") : null;
  return {
    situacao,
    numero: r.numero ? String(r.numero).slice(0, 30) : null,
    link_pdf: abs(r.url_danfse) ?? abs(r.url),
    link_xml: abs(r.caminho_xml_nota_fiscal),
    mensagem: (erros || r.mensagem || null)?.slice(0, 1000) ?? null,
  };
}

export const referenciaNota = (tipo: "fatura" | "recarga", id: number, tentativa: number) =>
  `${tipo}-${id}${tentativa > 1 ? `-${tentativa}` : ""}`;

export type Contato = { email: string; papel_contrato: string; recebe_faturas?: boolean | null };

/** Quem recebe a fatura: os contatos marcados "Recebe faturas"; sem nenhum marcado, os de papel Financeiro;
 *  sem nenhum dos dois, todos os contatos com e-mail. No máximo 10, sem repetir. */
export function destinatariosFatura(lista: Contato[]): string[] {
  const norm = (xs: Contato[]) => xs.map((x) => x.email.trim().toLowerCase()).filter(Boolean);
  const marcados = norm(lista.filter((x) => x.recebe_faturas));
  const fin = norm(lista.filter((x) => x.papel_contrato === "financeiro"));
  return [...new Set(marcados.length ? marcados : fin.length ? fin : norm(lista))].slice(0, 10);
}
