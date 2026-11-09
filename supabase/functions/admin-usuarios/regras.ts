// Regras da gestão de usuários (sem rede): validação do pedido e quem pode fazer o quê.
// O banco repete as mesmas travas (RLS, proteger_perfil); aqui elas valem para o que só a chave do servidor faz
// (convite, bloqueio de login, link de senha).

export const PAPEIS = ["admin", "planejamento", "operacao", "gestao", "qualidade"] as const;   // qualidade: só o Speech (SQL 89)
export type Papel = (typeof PAPEIS)[number];
export const ACOES = ["listar", "convidar", "desativar", "reativar", "resetar_senha", "alterar_papel", "resetar_2fa", "convidar_equipe"] as const;
export type Acao = (typeof ACOES)[number];

// catálogo de permissões (igual à view permissoes_catalogo); ADMINISTRACAO só um Admin libera
export const PERMISSOES = ["baixar_listas", "baixar_relatorios", "baixar_comite", "enviar_arquivos", "reenquadrar",
  "editar_orquestracao", "editar_credores", "editar_canais", "ver_acessos", "ver_auditoria", "gerenciar_usuarios",
  "gerenciar_permissoes", "ver_faturamento", "enviar_mensagens", "gerenciar_api"] as const;
export const ADMINISTRACAO = ["ver_acessos", "ver_auditoria", "gerenciar_usuarios", "gerenciar_permissoes", "ver_faturamento",
  "gerenciar_api"];

export interface Perfil {
  id: string;
  nome?: string | null;
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
  /** exceções ao perfil, só no convite: {permissao: true|false} */
  acessos?: Record<string, boolean>;
  /** só em convidar_equipe: master (Admin da equipe), atendimento ou comercial */
  funcao?: "master" | "atendimento" | "comercial";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[a-z]{2,}$/i;
const PRECISA_ALVO: Acao[] = ["desativar", "reativar", "resetar_senha", "alterar_papel", "resetar_2fa"];

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
  if (acao === "convidar_equipe") {
    const email = typeof c.email === "string" ? c.email.trim().toLowerCase() : "";
    if (!EMAIL.test(email) || email.length > 254) return { erro: "e-mail inválido" };
    if (c.funcao !== "master" && c.funcao !== "atendimento" && c.funcao !== "comercial") {
      return { erro: "função inválida: use master, atendimento ou comercial" };
    }
    pedido.email = email;
    pedido.funcao = c.funcao;
    if (c.nome !== undefined) {
      if (typeof c.nome !== "string" || c.nome.trim().length > 120) return { erro: "nome inválido" };
      pedido.nome = c.nome.trim() || undefined;
    }
    return { pedido };
  }
  if (acao === "convidar") {
    const email = typeof c.email === "string" ? c.email.trim().toLowerCase() : "";
    if (!EMAIL.test(email) || email.length > 254) return { erro: "e-mail inválido" };
    pedido.email = email;
    if (c.acessos !== undefined && c.acessos !== null) {
      if (typeof c.acessos !== "object" || Array.isArray(c.acessos)) return { erro: "acessos inválidos" };
      const acessos: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(c.acessos as Record<string, unknown>)) {
        if (!(PERMISSOES as readonly string[]).includes(k) || typeof v !== "boolean") return { erro: "acessos inválidos" };
        acessos[k] = v;
      }
      if (Object.keys(acessos).length) pedido.acessos = acessos;
    }
    if (c.nome !== undefined) {
      if (typeof c.nome !== "string" || c.nome.trim().length > 120) return { erro: "nome inválido" };
      pedido.nome = c.nome.trim() || undefined;
    }
  }
  if (acao === "convidar" || acao === "alterar_papel") {
    if (!PAPEIS.includes(c.papel as Papel)) return { erro: "perfil inválido" };
    pedido.papel = c.papel as Papel;
    // a Qualidade só tem acessos do Speech Analytics (o banco recusa os outros: validar_permissao_usuario, SQL 89)
    if (pedido.papel === "qualidade" && Object.values(pedido.acessos ?? {}).some((v) => v)) {
      return { erro: "o perfil Qualidade só tem acessos do Speech Analytics" };
    }
  }
  return { pedido };
}

const adminEquipe = (p: Perfil) => p.equipe && p.papel === "admin";

/** O que o banco diz sobre quem pede, quando é da equipe e não é Master (pode_equipe / equipe_pode). */
export interface PodeEquipe {
  /** convidar o Admin e listar usuários da empresa do pedido (na carteira de quem pede) */
  convidarAdmin: boolean;
  /** convidar e mudar pessoas da equipe (nunca um Master) */
  gerenciarEquipe: boolean;
}

/** Nível de verificação da sessão ("aal1" ou "aal2"), lido do token já validado pelo Supabase. */
export function aalDoToken(token: string): string | null {
  try {
    const parte = token.split(".")[1];
    const json = atob(parte.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(parte.length / 4) * 4, "="));
    const aal = JSON.parse(json).aal;
    return typeof aal === "string" ? aal : null;
  } catch {
    return null;
  }
}

/** Empresa em que o convite/lista vale: a do pedido (só equipe MotorCob escolhe) ou a de quem pede. */
export function empresaAlvo(quem: Perfil, pedido: Pedido): number | null {
  return quem.equipe ? (pedido.empresa_id ?? quem.empresa_id) : quem.empresa_id;
}

/** Devolve o motivo da recusa, ou null se pode. */
export function autorizar(quem: Perfil | null, podeGerenciar: boolean, pedido: Pedido, alvo: Perfil | null,
                          aal: string | null = null,
                          podeEquipe: PodeEquipe = { convidarAdmin: false, gerenciarEquipe: false }): string | null {
  if (!quem || !quem.ativo) return "usuário inativo";
  // equipe que não é Master: só o que a permissão dela libera, na empresa da carteira
  if (quem.equipe && !adminEquipe(quem)) {
    if (pedido.acao === "convidar_equipe") {
      if (!podeEquipe.gerenciarEquipe) return "sem permissão para gerenciar a equipe";
      if (pedido.funcao === "master") return "só um Master convida outro Master";
      if (aal !== "aal2") return "entre com o seu código de duas etapas para mudar a equipe";
      return null;
    }
    if (pedido.acao === "listar" || pedido.acao === "convidar") {
      if (pedido.empresa_id === undefined) return "informe a empresa";
      if (!podeEquipe.convidarAdmin) return "sem permissão para convidar usuários desta empresa";
      return null;
    }
    return "só um Master altera usuários de clientes";
  }
  if (!podeGerenciar) return "sem permissão para gerenciar usuários";
  // resetar a verificação de outra pessoa exige que quem pede tenha entrado com o código (aal2)
  if (pedido.acao === "resetar_2fa" && aal !== "aal2") return "entre com o seu código de duas etapas para resetar o de outra pessoa";
  if (pedido.acao === "convidar_equipe") {
    if (!adminEquipe(quem)) return "só um Master da equipe MotorCob convida para a equipe";
    if (aal !== "aal2") return "entre com o seu código de duas etapas para mudar a equipe";
    return null;
  }
  const equipe = adminEquipe(quem);
  if (pedido.acao === "listar" || pedido.acao === "convidar") {
    if (!equipe && pedido.empresa_id !== undefined && pedido.empresa_id !== quem.empresa_id) {
      return "só a equipe MotorCob gerencia outra empresa";
    }
    if (empresaAlvo(quem, pedido) === null) return "informe a empresa";
    if (pedido.acao === "convidar" && pedido.papel === "admin" && quem.papel !== "admin") {
      return "só um Admin cria outro Admin";
    }
    const acessos = pedido.acessos ?? {};
    if (quem.papel !== "admin" && ADMINISTRACAO.some((p) => acessos[p] === true)) {
      return "só um Admin libera acessos de administração";
    }
    if (pedido.papel === "admin" && (acessos.gerenciar_usuarios === false || acessos.gerenciar_permissoes === false)) {
      return "o Admin não pode perder gerenciar usuários/permissões";
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

const NOME_PAPEL: Record<Papel, string> = {
  admin: "Admin", planejamento: "Planejamento", operacao: "Operação", gestao: "Gestão", qualidade: "Qualidade",
};

/** Dados do convite que o modelo de e-mail do Supabase usa ({{ .Data.empresa_nome }} etc.): para qual empresa,
 * com qual papel e quem convidou. A equipe MotorCob aparece como "a equipe MotorCob", nunca pelo nome. */
export function dadosDoConvite(quem: Perfil, nome: string | undefined, empresaNome: string | null,
                               papel: Papel): Record<string, string> {
  const dados: Record<string, string> = {
    empresa_nome: (empresaNome ?? "").trim() || "sua empresa",
    papel: NOME_PAPEL[papel],
    convidado_por: quem.equipe ? "a equipe MotorCob" : (quem.nome ?? "").trim() || "o Admin da sua empresa",
  };
  if (nome?.trim()) dados.nome = nome.trim();
  return dados;
}

/** Convite da equipe MotorCob: o modelo do e-mail é o mesmo do cliente, então os campos vão preenchidos. */
export function dadosConviteEquipe(quem: Perfil, nome: string | undefined): Record<string, string> {
  const dados: Record<string, string> = {
    empresa_nome: "equipe MotorCob",
    papel: "integrante da equipe",
    convidado_por: (quem.nome ?? "").trim() || "a equipe MotorCob",
  };
  if (nome?.trim()) dados.nome = nome.trim();
  return dados;
}

/** Erro do GoTrue (Supabase Auth) → status e frase em pt-BR para a tela, sem dado pessoal (nunca repete o e-mail).
 *  Só reconhece erro do Auth (AuthApiError/AuthError: `__isAuthError` ou nome Auth*); qualquer outro → null (500).
 *  Códigos: https://supabase.com/docs/guides/auth/debugging/error-codes */
export function erroDoAuth(e: unknown): { status: number; erro: string; codigo: string } | null {
  if (!e || typeof e !== "object") return null;
  const x = e as { __isAuthError?: unknown; name?: unknown; code?: unknown; status?: unknown; message?: unknown };
  const nome = typeof x.name === "string" ? x.name : "";
  if (x.__isAuthError !== true && !nome.startsWith("Auth")) return null;
  const codigo = typeof x.code === "string" ? x.code : "";
  const status = typeof x.status === "number" ? x.status : 0;
  const msg = typeof x.message === "string" ? x.message : "";
  if (["email_exists", "user_already_exists", "phone_exists"].includes(codigo) || /already (been )?registered|already exists/i.test(msg)) {
    return { status: 409, erro: "e-mail já cadastrado: este endereço já tem login no MotorCX (nesta empresa, em outra ou na equipe). Use outro e-mail; se a pessoa esqueceu a senha, ela usa “Esqueci a senha” na entrada", codigo: codigo || "email_exists" };
  }
  if (codigo === "over_email_send_rate_limit" || codigo === "over_request_rate_limit" || status === 429 || /rate limit/i.test(msg)) {
    return { status: 429, erro: "limite de e-mails do Supabase atingido; tente em alguns minutos ou configure o SMTP próprio", codigo: codigo || "rate_limit" };
  }
  if (codigo === "email_address_not_authorized") {
    return { status: 400, erro: "o envio para este endereço não é permitido pelo e-mail padrão do Supabase; configure o SMTP próprio em Supabase › Authentication › Emails", codigo };
  }
  if (codigo === "email_address_invalid" || (codigo === "validation_failed" && /email/i.test(msg)) || /invalid.*email|email.*invalid|validate email/i.test(msg)) {
    return { status: 400, erro: "e-mail inválido: confira o endereço", codigo: codigo || "email_invalid" };
  }
  if (/sending|send .*e-?mail|smtp|mail(er)? (error|failed)/i.test(msg)) {
    return { status: 502, erro: "o e-mail de convite não pôde ser enviado: confira o SMTP em Supabase › Authentication › Emails", codigo: codigo || "smtp" };
  }
  if (codigo === "signup_disabled" || codigo === "email_provider_disabled") {
    return { status: 400, erro: "o login por e-mail está desligado no Supabase (Authentication › Providers › Email)", codigo };
  }
  return null;
}
