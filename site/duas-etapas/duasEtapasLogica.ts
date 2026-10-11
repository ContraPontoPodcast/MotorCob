// Verificação em duas etapas (TOTP) do MotorCob, sem tela: decide o próximo passo depois do login, cadastra o
// autenticador, confere o código e cancela. Usa só a API mfa do supabase-js v2. A tela está em DuasEtapas.tsx.
//
// Regras que evitam os travamentos vistos em produção:
// * nunca chama mfa.verify sem um challenge: usa challengeAndVerify (pede e confere numa chamada só);
// * antes de cadastrar, apaga cadastros pela metade ("unverified"), que impediam o próximo;
// * nome do autenticador sempre diferente;
// * depois do código, renova a sessão e confere que ela subiu para aal2 antes de liberar.

export type Passo = { etapa: "pronto" } | { etapa: "codigo"; fatorId: string } | { etapa: "cadastro" };

export interface Fator { id: string; status: string; factor_type: string }
type Resp<T> = Promise<{ data: T; error: { message: string } | null }>;
export interface ClienteAuth {
  auth: {
    mfa: {
      getAuthenticatorAssuranceLevel(): Resp<{ currentLevel: string | null; nextLevel: string | null } | null>;
      listFactors(): Resp<{ all: Fator[]; totp: Fator[] } | null>;
      enroll(p: { factorType: "totp"; friendlyName?: string }): Resp<unknown>;
      unenroll(p: { factorId: string }): Resp<unknown>;
      challengeAndVerify(p: { factorId: string; code: string }): Resp<unknown>;
    };
    refreshSession(): Resp<unknown>;
    signOut(): Promise<{ error: { message: string } | null }>;
  };
}

/** Erro com a frase para a pessoa e o detalhe técnico (mensagem do Supabase) separado. */
export class ErroDuasEtapas extends Error {
  frase: string;
  detalhe: string;
  constructor(frase: string, detalhe = "") {
    super(frase);
    this.frase = frase;
    this.detalhe = detalhe;
  }
}

const FRASES: [RegExp, string][] = [
  [/invalid totp code/i, "Código inválido. Use o código que está na tela do aplicativo agora e confira se o relógio do celular está no automático."],
  [/ip address/i, "A sua internet trocou de endereço no meio da verificação. Tente de novo, de preferência no Wi-Fi."],
  [/expired/i, "O código expirou. Digite o código novo que está no aplicativo."],
  [/too many|rate limit/i, "Muitas tentativas seguidas. Espere um minuto e tente de novo."],
  [/already exists/i, "Já existe um cadastro em andamento. Toque em Tentar de novo."],
];

export function traduzir(erro: unknown): ErroDuasEtapas {
  if (erro instanceof ErroDuasEtapas) return erro;
  const msg = (erro as { message?: string })?.message ?? String(erro ?? "");
  const frase = FRASES.find(([re]) => re.test(msg))?.[1] ?? "Não foi possível verificar o segundo fator.";
  return new ErroDuasEtapas(frase, msg);
}

async function ok<T>(r: Resp<T>): Promise<T> {
  const { data, error } = await r;
  if (error) throw traduzir(error);
  return data;
}

/** Depois do signInWithPassword (ou ao abrir uma página protegida): o que fazer agora. */
export async function proximoPasso(sb: ClienteAuth, ehAdmin: boolean, obrigarAdmin = true): Promise<Passo> {
  const nivel = await ok(sb.auth.mfa.getAuthenticatorAssuranceLevel());
  if (nivel?.currentLevel === "aal2") return { etapa: "pronto" };
  const fatores = await ok(sb.auth.mfa.listFactors());
  const verificado = (fatores?.totp ?? []).find((f) => f.status === "verified");
  if (verificado) return { etapa: "codigo", fatorId: verificado.id };
  if (ehAdmin && obrigarAdmin) return { etapa: "cadastro" };
  return { etapa: "pronto" };
}

/** Começa o cadastro: limpa os pela metade e devolve o QR e a chave para mostrar. */
export async function iniciarCadastro(sb: ClienteAuth, agora = new Date()):
  Promise<{ fatorId: string; qr: string; chave: string }> {
  const fatores = await ok(sb.auth.mfa.listFactors());
  for (const f of fatores?.all ?? []) {
    if (f.factor_type === "totp" && f.status !== "verified") {
      await sb.auth.mfa.unenroll({ factorId: f.id });   // se já sumiu, segue
    }
  }
  const nome = `MotorCob ${agora.toISOString().slice(0, 19).replace("T", " ")}`;
  const d = (await ok(sb.auth.mfa.enroll({ factorType: "totp", friendlyName: nome }))) as
    { id?: string; totp?: { qr_code?: string; secret?: string } } | null;
  if (!d?.id || !d.totp?.qr_code || !d.totp.secret) {
    throw new ErroDuasEtapas("Não foi possível preparar o autenticador.", "enroll sem QR ou chave");
  }
  return { fatorId: d.id, qr: d.totp.qr_code, chave: d.totp.secret };
}

/** Só os dígitos; aceita colar "123 456". Devolve null se não tiver 6 dígitos. */
export function limparCodigo(texto: string): string | null {
  const d = (texto ?? "").replace(/\D/g, "");
  return d.length === 6 ? d : null;
}

/** Confere o código (cadastro ou login) e só devolve quando a sessão já está em aal2. */
export async function confirmarCodigo(sb: ClienteAuth, fatorId: string, texto: string): Promise<void> {
  const code = limparCodigo(texto);
  if (!code) throw new ErroDuasEtapas("Digite os 6 números do aplicativo.");
  await ok(sb.auth.mfa.challengeAndVerify({ factorId: fatorId, code }));
  await ok(sb.auth.refreshSession());
  const nivel = await ok(sb.auth.mfa.getAuthenticatorAssuranceLevel());
  if (nivel?.currentLevel !== "aal2") {
    throw new ErroDuasEtapas("O código foi aceito, mas a sessão não foi confirmada. Entre de novo.", "aal1 depois do verify");
  }
}

/** Cancelar no meio do cadastro: não deixa autenticador pela metade e sai. */
export async function cancelarCadastro(sb: ClienteAuth, fatorId?: string): Promise<void> {
  if (fatorId) await sb.auth.mfa.unenroll({ factorId: fatorId });
  await sb.auth.signOut();
}

/** A chave em grupos de 4 para digitar à mão no aplicativo. */
export function chaveEmGrupos(chave: string): string {
  return (chave ?? "").replace(/\s/g, "").replace(/(.{4})/g, "$1 ").trim();
}
