# Prompt Horizons — Duas etapas: componente pronto (substitui o código gerado)

Cole no Horizons e publique. Traz os dois arquivos inteiros; o Horizons só cria os arquivos e liga na página /login.

```text
Substitua TODA a verificação em duas etapas (MFA) do site por estes dois arquivos prontos. Não reescreva o conteúdo
deles: crie exatamente como está abaixo. Apague o código antigo de MFA (telas, guardas, efeitos).

1. Crie src/components/duasEtapasLogica.ts com o conteúdo do bloco LOGICA.
2. Crie src/components/DuasEtapas.tsx com o conteúdo do bloco TELA.
3. Na página /login, depois de signInWithPassword (e ao abrir /login já com sessão):
   const { data: perfil } = await supabase.from("perfis").select("papel").eq("id", user.id).single();
   const passo = await proximoPasso(supabase, perfil?.papel === "admin");
   se passo.etapa === "pronto" → navegue para a página inicial; senão guarde o passo no estado e mostre
   <DuasEtapas supabase={supabase} passo={passo} onPronto={() => navegar para a página inicial}
   onSair={() => limpar o passo e voltar ao formulário de senha} /> no lugar do formulário de senha.
4. Guarda das páginas protegidas: sem sessão → /login. Com sessão → proximoPasso(supabase, ehAdmin); se não for
   "pronto", mande para /login. Nenhum outro lugar decide sobre duas etapas.
5. Minha conta › Segurança › "Ligar": abra num modal <DuasEtapas passo={{ etapa: "cadastro" }} ... />.

=== LOGICA (src/components/duasEtapasLogica.ts) ===
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

=== TELA (src/components/DuasEtapas.tsx) ===
// Tela da verificação em duas etapas do MotorCob (linha Apple). Fica DENTRO da página /login, como etapa:
//   <DuasEtapas supabase={supabase} passo={passo} onPronto={() => navigate("/workspace")} />
// passo vem de proximoPasso(supabase, ehAdmin) (duasEtapasLogica.ts). Nada de navegar durante o duplo fator.
import { useEffect, useRef, useState } from "react";
import {
  cancelarCadastro, chaveEmGrupos, type ClienteAuth, confirmarCodigo, ErroDuasEtapas, iniciarCadastro, limparCodigo,
  type Passo, traduzir,
} from "./duasEtapasLogica";

type Props = {
  supabase: ClienteAuth;
  passo: Exclude<Passo, { etapa: "pronto" }>;
  onPronto: () => void;
  onSair?: () => void;
};

const cor = { texto: "#1D1D1F", texto2: "#6E6E73", texto3: "#8E8E93", borda: "#D2D2D7", fundo2: "#F5F5F7", erro: "#D70015" };
const fonte = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif';
const s = {
  caixa: { width: "100%", maxWidth: 380, margin: "0 auto", display: "grid", gap: 16, fontFamily: fonte, color: cor.texto, textAlign: "center" as const },
  titulo: { fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em", margin: 0 },
  sub: { fontSize: 17, color: cor.texto2, margin: 0, lineHeight: 1.4 },
  qr: { width: 200, height: 200, margin: "4px auto", background: "#FFFFFF", borderRadius: 12, padding: 8, boxShadow: `0 0 0 1px ${cor.borda}` },
  chave: { fontSize: 13, color: cor.texto2, display: "flex", gap: 8, justifyContent: "center", alignItems: "center", flexWrap: "wrap" as const },
  codigoChave: { fontVariantNumeric: "tabular-nums" as const, letterSpacing: "0.04em", color: cor.texto, wordBreak: "break-all" as const },
  campo: { height: 56, border: `1px solid ${cor.borda}`, borderRadius: 14, fontSize: 28, textAlign: "center" as const, letterSpacing: "0.3em",
           fontVariantNumeric: "tabular-nums" as const, fontFamily: fonte, color: cor.texto, outline: "none", width: "100%", boxSizing: "border-box" as const },
  botao: { height: 50, border: 0, borderRadius: 12, background: "#1D1D1F", color: "#FFFFFF", fontSize: 17, fontWeight: 500, cursor: "pointer", fontFamily: fonte },
  link: { background: "none", border: 0, color: cor.texto2, fontSize: 14, cursor: "pointer", fontFamily: fonte, textDecoration: "underline" },
  pilula: { border: 0, background: cor.fundo2, borderRadius: 980, padding: "4px 10px", fontSize: 12.5, cursor: "pointer", color: cor.texto, fontFamily: fonte },
  erro: { color: cor.erro, fontSize: 14, margin: 0 },
  detalhe: { color: cor.texto3, fontSize: 12, margin: "2px 0 0", wordBreak: "break-word" as const },
  ajuda: { fontSize: 13, color: cor.texto2, background: cor.fundo2, borderRadius: 12, padding: "10px 12px", textAlign: "left" as const, margin: 0 },
};

export default function DuasEtapas({ supabase, passo, onPronto, onSair }: Props) {
  const [cadastro, setCadastro] = useState<{ fatorId: string; qr: string; chave: string } | null>(null);
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<ErroDuasEtapas | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [ajuda, setAjuda] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const iniciou = useRef(false);            // React StrictMode roda o efeito duas vezes: cadastra uma vez só
  const campo = useRef<HTMLInputElement>(null);

  const preparar = async () => {
    setErro(null);
    setOcupado(true);
    try {
      setCadastro(await iniciarCadastro(supabase));
    } catch (e) {
      setErro(traduzir(e));
    } finally {
      setOcupado(false);
    }
  };

  useEffect(() => {
    if (passo.etapa === "cadastro" && !iniciou.current) {
      iniciou.current = true;
      void preparar();
    }
    campo.current?.focus();
  }, [passo.etapa]);

  const fatorId = passo.etapa === "codigo" ? passo.fatorId : cadastro?.fatorId;

  const confirmar = async (texto = codigo) => {
    if (!fatorId || ocupado) return;
    setErro(null);
    setOcupado(true);
    try {
      await confirmarCodigo(supabase, fatorId, texto);
      onPronto();
    } catch (e) {
      const t = traduzir(e);
      console.error("MFA", passo.etapa, t.detalhe || t.frase);
      setErro(t);
      setCodigo("");
      campo.current?.focus();
    } finally {
      setOcupado(false);
    }
  };

  const digitar = (v: string) => {
    const so = v.replace(/[^\d ]/g, "").slice(0, 7);
    setCodigo(so);
    if (limparCodigo(so)) void confirmar(so);    // envia sozinho com 6 dígitos (aceita colar "123 456")
  };

  const sair = async () => {
    try {
      await cancelarCadastro(supabase, passo.etapa === "cadastro" ? cadastro?.fatorId : undefined);
    } finally {
      onSair?.();
    }
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(cadastro?.chave ?? "");
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  };

  return (
    <form style={s.caixa} onSubmit={(e) => { e.preventDefault(); void confirmar(); }} noValidate>
      {passo.etapa === "cadastro" ? (
        <>
          <h1 style={s.titulo}>Proteja sua conta.</h1>
          <p style={s.sub}>Leia o código com o aplicativo autenticador (Google Authenticator, Microsoft Authenticator ou 1Password).</p>
          {cadastro ? (
            <>
              <img src={cadastro.qr} alt="QR do autenticador MotorCob" width={200} height={200} style={s.qr} />
              <div style={s.chave}>
                <span>Ou digite a chave:</span>
                <span style={s.codigoChave}>{chaveEmGrupos(cadastro.chave)}</span>
                <button type="button" style={s.pilula} onClick={copiar}>{copiado ? "Copiada" : "Copiar chave"}</button>
              </div>
            </>
          ) : (
            <p style={s.sub} aria-live="polite">{ocupado ? "Preparando o autenticador…" : ""}</p>
          )}
        </>
      ) : (
        <>
          <h1 style={s.titulo}>Digite o código.</h1>
          <p style={s.sub}>Use os 6 dígitos do seu aplicativo autenticador.</p>
        </>
      )}

      {(passo.etapa === "codigo" || cadastro) && (
        <input
          ref={campo}
          style={s.campo}
          value={codigo}
          onChange={(e) => digitar(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label="Código de 6 dígitos"
          placeholder="000000"
          disabled={ocupado}
        />
      )}

      {erro && (
        <div role="alert">
          <p style={s.erro}>{erro.frase}</p>
          {erro.detalhe && <p style={s.detalhe}>Detalhe: {erro.detalhe}</p>}
        </div>
      )}

      {passo.etapa === "cadastro" && !cadastro && erro && (
        <button type="button" style={s.botao} onClick={() => void preparar()}>Tentar de novo</button>
      )}
      {(passo.etapa === "codigo" || cadastro) && (
        <button type="submit" style={{ ...s.botao, opacity: ocupado ? 0.6 : 1 }} disabled={ocupado}>
          {ocupado ? "Conferindo…" : "Continuar"}
        </button>
      )}

      <div style={{ display: "flex", justifyContent: "center", gap: 18 }}>
        <button type="button" style={s.link} onClick={() => setAjuda(!ajuda)} aria-expanded={ajuda}>Problemas com o código?</button>
        <button type="button" style={s.link} onClick={() => void sair()}>{passo.etapa === "cadastro" ? "Cancelar" : "Sair"}</button>
      </div>
      {ajuda && (
        <p style={s.ajuda}>
          Confira se o relógio do celular está no automático e use o código que aparece agora no aplicativo. Se você
          trocou de celular ou apagou o aplicativo, peça a outro Admin da sua empresa para resetar a sua verificação em
          Usuários › Resetar duas etapas, ou fale com o suporte MotorCob.
        </p>
      )}
    </form>
  );
}

=== FIM ===
```
