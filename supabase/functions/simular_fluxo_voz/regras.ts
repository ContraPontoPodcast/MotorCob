// Regras da Edge Function simular_fluxo_voz (sem rede; testáveis com node --test): pedido, quem pode, o pacote que vai
// para o simulador da VM (voz/simulador_http.py), a assinatura HMAC e a conferência dos casos de teste guardados.
// LGPD: o simulador usa um cliente de teste fictício e os exemplos dos conectores (valores trocados pela VM). Falas com
// cara de documento, telefone ou e-mail são recusadas, como no banco (falas_teste_voz_ok). Nada é gravado, a não ser o
// resultado dos casos de teste (só caminho e código).

export type Acao = "simular" | "rodar_casos" | "roleplay";
export interface PedidoSimular { acao: "simular"; versao: number; falas: string[]; falhar: number[] }
export interface PedidoCasos { acao: "rodar_casos"; versao: number }
/** SQL 59: lote de roleplay com personas (rodar_roleplay_voz) e o aviso assinado à VM para começar já. */
export interface PedidoRoleplay { acao: "roleplay"; versao: number; personas: number[]; n: number }
export type Pedido = PedidoSimular | PedidoCasos | PedidoRoleplay;
export interface Perfil { id: string; ativo: boolean; equipe: boolean; empresa_id: number | null }
export interface Versao { id: number; fluxo_id: number; empresa_id: number; credor_id: number | null; definicao: unknown }
export interface Caso {
  id: number; nome: string; falas: string[]; caminho_esperado: string[]; resultado_esperado: string | null;
  conectores_falham: number[]; ativo: boolean;
}

export const PERMISSAO = "editar_canais";
export const MAX_FALAS = 30;

/** Mesma regra de public.falas_teste_voz_ok: 1 a 300 caracteres, sem 9+ dígitos seguidos e sem @. */
export function falaOk(t: unknown): boolean {
  return typeof t === "string" && t.length >= 1 && t.length <= 300 && !/[0-9]{9,}/.test(t) && !t.includes("@");
}

export function validarPedido(corpo: unknown): { pedido?: Pedido; erro?: string } {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return { erro: "pedido inválido" };
  const c = corpo as Record<string, unknown>;
  const acao = c.acao ?? "simular";
  if (!Number.isSafeInteger(c.versao) || (c.versao as number) <= 0) return { erro: "versão inválida" };
  if (acao === "rodar_casos") {
    if (Object.keys(c).some((k) => k !== "acao" && k !== "versao")) return { erro: "pedido inválido" };
    return { pedido: { acao, versao: c.versao as number } };
  }
  if (acao === "roleplay") {
    if (Object.keys(c).some((k) => !["acao", "versao", "personas", "n"].includes(k))) return { erro: "pedido inválido" };
    const ps = c.personas;
    if (!Array.isArray(ps) || ps.length < 1 || ps.length > 10 || !ps.every((x) => Number.isSafeInteger(x) && (x as number) > 0)) {
      return { erro: "de 1 a 10 personas" };
    }
    if (!Number.isSafeInteger(c.n) || (c.n as number) < 1 || (c.n as number) > 20 || ps.length * (c.n as number) > 200) {
      return { erro: "de 1 a 20 conversas por persona (até 200 no lote)" };
    }
    return { pedido: { acao, versao: c.versao as number, personas: ps as number[], n: c.n as number } };
  }
  if (acao !== "simular") return { erro: "ação inválida: simular, rodar_casos ou roleplay" };
  if (Object.keys(c).some((k) => !["acao", "versao", "falas", "falhar"].includes(k))) return { erro: "pedido inválido" };
  const falas = c.falas ?? [];
  if (!Array.isArray(falas) || falas.length > MAX_FALAS) return { erro: `até ${MAX_FALAS} falas` };
  if (!falas.every(falaOk)) return { erro: "fala inválida: 1 a 300 caracteres, sem documento, telefone ou e-mail" };
  const falhar = c.falhar ?? [];
  if (!Array.isArray(falhar) || falhar.length > 10 || !falhar.every((x) => Number.isSafeInteger(x) && (x as number) > 0)) {
    return { erro: "conectores para falhar inválidos" };
  }
  return { pedido: { acao: "simular", versao: c.versao as number, falas: falas as string[], falhar: falhar as number[] } };
}

/**
 * Quem pode: pessoa ativa do cliente, da empresa da versão, com editar_canais (o mesmo de editar o fluxo).
 * "não encontrada" vira 404 para não revelar se a versão existe.
 */
export function autorizar(quem: Perfil | null, pode: boolean, v: Versao | null): string | null {
  if (!quem || !quem.ativo) return "acesso desativado";
  if (quem.equipe) return "a equipe MotorCX testa pelo Console";
  if (!v || quem.empresa_id == null || Number(v.empresa_id) !== Number(quem.empresa_id)) return "versão não encontrada";
  if (!pode) return "sem permissão";
  return null;
}

/** Cliente de teste fictício (nada da carteira de verdade). */
export function variaveisTeste(assessoria: string, credor: string | null): Record<string, string> {
  return {
    primeiro_nome: "Ana", assessoria, credor: credor ?? "Credor de teste", saldo: "1.380,00", dias_atraso: "45",
    vencimento: "05/11", link_pagamento: "https://pagar.exemplo/teste", valor_minimo: "100,00",
  };
}
// Só o que o simulador precisa de cada conector: nada de credencial (segredo_ref) nem cabeçalhos.
const CAMPOS_CONECTOR = ["id", "empresa_id", "nome", "finalidade", "metodo", "url", "autenticacao", "mapa_entrada",
  "mapa_saida", "timeout_ms", "tentativas", "idempotencia", "em_falha", "situacao", "versao", "exemplo_resposta"];

export function pacoteVM(args: {
  versao: Versao; conectores: Record<string, unknown>[]; alcada: Record<string, unknown> | null;
  base: { bloco_id: string; pergunta: string; resposta: string }[]; falas: string[]; falhar: number[];
  variaveis: Record<string, string>;
}) {
  const base: Record<string, [string, string][]> = {};
  for (const r of args.base) (base[r.bloco_id] ??= []).push([r.pergunta, r.resposta]);
  return {
    versao_id: args.versao.id, definicao: args.versao.definicao,
    conectores: args.conectores.map((c) => Object.fromEntries(CAMPOS_CONECTOR.map((k) => [k, c[k] ?? null]))),
    alcada: args.alcada && args.alcada.id ? args.alcada : null, base, falas: args.falas, falhar: args.falhar,
    variaveis: args.variaveis,
  };
}

// ---------------------------------------------------------------- assinatura (igual a voz/simulador_http.assinatura)
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");

export async function assinar(chave: string, carimbo: string, corpo: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(chave), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(`${carimbo}.${corpo}`)));
}

/** URL do aviso de roleplay na VM: mesmo serviço do simulador, caminho /roleplay. */
export function urlRoleplay(urlSimular: string): string {
  return urlSimular.replace(/\/simular\/?$/, "") + "/roleplay";
}

// ---------------------------------------------------------------- casos de teste guardados
export interface ResultadoVM { caminho: string[]; resultado: string | null; turnos: unknown[] }

/** O caso passa quando o caminho é exatamente o esperado e o resultado (se pedido) bate. Caminho esperado vazio
 *  (casos vindos do roleplay, SQL 59) = confere só o resultado. */
export function conferirCaso(caso: Caso, r: ResultadoVM): boolean {
  const mesmo = caso.caminho_esperado.length === 0
    || (r.caminho.length === caso.caminho_esperado.length && r.caminho.every((b, i) => b === caso.caminho_esperado[i]));
  return mesmo && (!caso.resultado_esperado || caso.resultado_esperado === r.resultado);
}

/** O que a tela recebe por turno: fala, bloco, caminho, intenção, travas e chamadas a conectores. */
export function respostaTela(r: Record<string, unknown>) {
  return {
    turnos: r.turnos, caminho: r.caminho, resultado: r.resultado ?? null, encerrada: r.encerrada ?? false,
    conectores: r.conectores ?? [],
  };
}
