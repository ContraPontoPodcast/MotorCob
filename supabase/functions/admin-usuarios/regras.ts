// Regras da gestão de usuários (sem rede): validação do pedido e quem pode fazer o quê.
// O banco repete as mesmas travas (RLS, proteger_perfil); aqui elas valem para o que só a chave do servidor faz
// (convite, bloqueio de login, link de senha).

export const PAPEIS = ["admin", "planejamento", "operacao", "gestao"] as const;
export type Papel = (typeof PAPEIS)[number];
export const ACOES = ["listar", "convidar", "desativar", "reativar", "resetar_senha", "alterar_papel"] as const;
export type Acao = (typeof ACOES)[number];

export interface Perfil {
  id: string;
  papel: Papel;
  ativo: boolean;
  empresa_id: number | null;
  equipe: boolean;
}

export interface Pedido {
  acao: Acao;
  usuario_id?: string;
  email?: string;
  nome?: string;
  papel?: Papel;
  empresa_id?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[a-z]{2,}$/i;
const PRECISA_ALVO: Acao[] = ["desativar", "reativar", "resetar_senha", "alterar_papel"];

export function validarPedido(corpo: unknown): { pedido?: Pedido; erro?: string } {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return { erro: "pedido inválido" };
  const c = corpo as Record<string, unknown>;
  const acao = c.acao as Acao;
  if (!ACOES.includes(acao)) return { erro: "ação desconhecida" };
  const pedido: Pedido = { acao };
  if (c.empresa_id !== undefined && c.empresa_id !== null) {
    const e = Number(c.empresa_id);
    if (!Number.isSafeInteger(e) || e <= 0) return { erro: "empresa inválida" };
    pedido.empresa_id = e;
  }
  if (PRECISA_ALVO.includes(acao)) {
    if (typeof c.usuario_id !== "string" || !UUID.test(c.usuario_id)) return { erro: "usuário inválido" };
    pedido.usuario_id = c.usuario_id;
  }
  if (acao === "convidar") {
    const email = typeof c.email === "string" ? c.email.trim().toLowerCase() : "";
    if (!EMAIL.test(email) || email.length > 254) return { erro: "e-mail inválido" };
    pedido.email = email;
    if (c.nome !== undefined) {
      if (typeof c.nome !== "string" || c.nome.trim().length > 120) return { erro: "nome inválido" };
      pedido.nome = c.nome.trim() || undefined;
    }
  }
  if (acao === "convidar" || acao === "alterar_papel") {
    if (!PAPEIS.includes(c.papel as Papel)) return { erro: "perfil inválido" };
    pedido.papel = c.papel as Papel;
  }
  return { pedido };
}

const adminEquipe = (p: Perfil) => p.equipe && p.papel === "admin";

/** Empresa em que o convite/lista vale: a do pedido (só equipe MotorCob escolhe) ou a de quem pede. */
export function empresaAlvo(quem: Perfil, pedido: Pedido): number | null {
  return adminEquipe(quem) ? (pedido.empresa_id ?? quem.empresa_id) : quem.empresa_id;
}

/** Devolve o motivo da recusa, ou null se pode. */
export function autorizar(quem: Perfil | null, podeGerenciar: boolean, pedido: Pedido, alvo: Perfil | null): string | null {
  if (!quem || !quem.ativo) return "usuário inativo";
  if (!podeGerenciar) return "sem permissão para gerenciar usuários";
  const equipe = adminEquipe(quem);
  if (pedido.acao === "listar" || pedido.acao === "convidar") {
    if (!equipe && pedido.empresa_id !== undefined && pedido.empresa_id !== quem.empresa_id) {
      return "só a equipe MotorCob gerencia outra empresa";
    }
    if (empresaAlvo(quem, pedido) === null) return "informe a empresa";
    if (pedido.acao === "convidar" && pedido.papel === "admin" && quem.papel !== "admin") {
      return "só um Admin cria outro Admin";
    }
    return null;
  }
  if (!alvo) return "usuário não encontrado";
  if (alvo.id === quem.id && pedido.acao !== "resetar_senha") return "ninguém altera o próprio perfil ou status";
  if (!equipe) {
    if (alvo.equipe) return "usuário da equipe MotorCob";
    if (alvo.empresa_id === null || alvo.empresa_id !== quem.empresa_id) return "usuário de outra empresa";
  }
  if ((alvo.papel === "admin" || pedido.papel === "admin") && quem.papel !== "admin") {
    return "só um Admin cria ou altera outro Admin";
  }
  return null;
}
