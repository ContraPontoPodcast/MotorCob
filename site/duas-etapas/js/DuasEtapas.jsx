// Tela da verificação em duas etapas do MotorCob. Cole este arquivo INTEIRO em src/components/DuasEtapas.jsx
// (na mesma pasta de duasEtapasLogica.js). Gerado de site/duas-etapas/DuasEtapas.tsx (fonte testada); não edite à mão.
import { useEffect, useRef, useState } from "react";
import {
  cancelarCadastro,
  chaveEmGrupos,
  confirmarCodigo,
  iniciarCadastro,
  limparCodigo,
  traduzir
} from "./duasEtapasLogica";
const cor = { texto: "#1D1D1F", texto2: "#6E6E73", texto3: "#8E8E93", borda: "#D2D2D7", fundo2: "#F5F5F7", erro: "#D70015" };
const fonte = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif';
const s = {
  caixa: { width: "100%", maxWidth: 380, margin: "0 auto", display: "grid", gap: 16, fontFamily: fonte, color: cor.texto, textAlign: "center" },
  titulo: { fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em", margin: 0 },
  sub: { fontSize: 17, color: cor.texto2, margin: 0, lineHeight: 1.4 },
  qr: { width: 200, height: 200, margin: "4px auto", background: "#FFFFFF", borderRadius: 12, padding: 8, boxShadow: `0 0 0 1px ${cor.borda}` },
  chave: { fontSize: 13, color: cor.texto2, display: "flex", gap: 8, justifyContent: "center", alignItems: "center", flexWrap: "wrap" },
  codigoChave: { fontVariantNumeric: "tabular-nums", letterSpacing: "0.04em", color: cor.texto, wordBreak: "break-all" },
  campo: {
    height: 56,
    border: `1px solid ${cor.borda}`,
    borderRadius: 14,
    fontSize: 28,
    textAlign: "center",
    letterSpacing: "0.3em",
    fontVariantNumeric: "tabular-nums",
    fontFamily: fonte,
    color: cor.texto,
    outline: "none",
    width: "100%",
    boxSizing: "border-box"
  },
  botao: { height: 50, border: 0, borderRadius: 12, background: "#1D1D1F", color: "#FFFFFF", fontSize: 17, fontWeight: 500, cursor: "pointer", fontFamily: fonte },
  link: { background: "none", border: 0, color: cor.texto2, fontSize: 14, cursor: "pointer", fontFamily: fonte, textDecoration: "underline" },
  pilula: { border: 0, background: cor.fundo2, borderRadius: 980, padding: "4px 10px", fontSize: 12.5, cursor: "pointer", color: cor.texto, fontFamily: fonte },
  erro: { color: cor.erro, fontSize: 14, margin: 0 },
  detalhe: { color: cor.texto3, fontSize: 12, margin: "2px 0 0", wordBreak: "break-word" },
  ajuda: { fontSize: 13, color: cor.texto2, background: cor.fundo2, borderRadius: 12, padding: "10px 12px", textAlign: "left", margin: 0 }
};
function DuasEtapas({ supabase, passo, onPronto, onSair }) {
  const [cadastro, setCadastro] = useState(null);
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [ajuda, setAjuda] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const iniciou = useRef(false);
  const campo = useRef(null);
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
  const digitar = (v) => {
    const so = v.replace(/[^\d ]/g, "").slice(0, 7);
    setCodigo(so);
    if (limparCodigo(so)) void confirmar(so);
  };
  const sair = async () => {
    try {
      await cancelarCadastro(supabase, passo.etapa === "cadastro" ? cadastro?.fatorId : void 0);
    } finally {
      onSair?.();
    }
  };
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(cadastro?.chave ?? "");
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2e3);
    } catch {
      setCopiado(false);
    }
  };
  return <form style={s.caixa} onSubmit={(e) => {
    e.preventDefault();
    void confirmar();
  }} noValidate>
      {passo.etapa === "cadastro" ? <>
          <h1 style={s.titulo}>Proteja sua conta.</h1>
          <p style={s.sub}>Leia o código com o aplicativo autenticador (Google Authenticator, Microsoft Authenticator ou 1Password).</p>
          {cadastro ? <>
              <img src={cadastro.qr} alt="QR do autenticador MotorCX" width={200} height={200} style={s.qr} />
              <div style={s.chave}>
                <span>Ou digite a chave:</span>
                <span style={s.codigoChave}>{chaveEmGrupos(cadastro.chave)}</span>
                <button type="button" style={s.pilula} onClick={copiar}>{copiado ? "Copiada" : "Copiar chave"}</button>
              </div>
            </> : <p style={s.sub} aria-live="polite">{ocupado ? "Preparando o autenticador\u2026" : ""}</p>}
        </> : <>
          <h1 style={s.titulo}>Digite o código.</h1>
          <p style={s.sub}>Use os 6 dígitos do seu aplicativo autenticador.</p>
        </>}

      {(passo.etapa === "codigo" || cadastro) && <input
    ref={campo}
    style={s.campo}
    value={codigo}
    onChange={(e) => digitar(e.target.value)}
    inputMode="numeric"
    autoComplete="one-time-code"
    aria-label="Código de 6 dígitos"
    placeholder="000000"
    disabled={ocupado}
  />}

      {erro && <div role="alert">
          <p style={s.erro}>{erro.frase}</p>
          {erro.detalhe && <p style={s.detalhe}>Detalhe: {erro.detalhe}</p>}
        </div>}

      {passo.etapa === "cadastro" && !cadastro && erro && <button type="button" style={s.botao} onClick={() => void preparar()}>Tentar de novo</button>}
      {(passo.etapa === "codigo" || cadastro) && <button type="submit" style={{ ...s.botao, opacity: ocupado ? 0.6 : 1 }} disabled={ocupado}>
          {ocupado ? "Conferindo\u2026" : "Continuar"}
        </button>}

      <div style={{ display: "flex", justifyContent: "center", gap: 18 }}>
        <button type="button" style={s.link} onClick={() => setAjuda(!ajuda)} aria-expanded={ajuda}>Problemas com o código?</button>
        <button type="button" style={s.link} onClick={() => void sair()}>{passo.etapa === "cadastro" ? "Cancelar" : "Sair"}</button>
      </div>
      {ajuda && <p style={s.ajuda}>
          Confira se o relógio do celular está no automático e use o código que aparece agora no aplicativo. Se você
          trocou de celular ou apagou o aplicativo, peça a outro Admin da sua empresa para resetar a sua verificação em
          Usuários › Resetar duas etapas, ou fale com o suporte MotorCX.
        </p>}
    </form>;
}
export {
  DuasEtapas as default
};
