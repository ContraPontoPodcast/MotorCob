// Verificação em duas etapas do MotorCob (lógica, sem tela). Cole este arquivo INTEIRO em
// src/components/duasEtapasLogica.js. Gerado de site/duas-etapas/duasEtapasLogica.ts (fonte testada); não edite à mão.
class ErroDuasEtapas extends Error {
  constructor(frase, detalhe = "") {
    super(frase);
    this.frase = frase;
    this.detalhe = detalhe;
  }
}
const FRASES = [
  [/invalid totp code/i, "C\xF3digo inv\xE1lido. Use o c\xF3digo que est\xE1 na tela do aplicativo agora e confira se o rel\xF3gio do celular est\xE1 no autom\xE1tico."],
  [/ip address/i, "A sua internet trocou de endere\xE7o no meio da verifica\xE7\xE3o. Tente de novo, de prefer\xEAncia no Wi-Fi."],
  [/expired/i, "O c\xF3digo expirou. Digite o c\xF3digo novo que est\xE1 no aplicativo."],
  [/too many|rate limit/i, "Muitas tentativas seguidas. Espere um minuto e tente de novo."],
  [/already exists/i, "J\xE1 existe um cadastro em andamento. Toque em Tentar de novo."]
];
function traduzir(erro) {
  if (erro instanceof ErroDuasEtapas) return erro;
  const msg = erro?.message ?? String(erro ?? "");
  const frase = FRASES.find(([re]) => re.test(msg))?.[1] ?? "N\xE3o foi poss\xEDvel verificar o segundo fator.";
  return new ErroDuasEtapas(frase, msg);
}
async function ok(r) {
  const { data, error } = await r;
  if (error) throw traduzir(error);
  return data;
}
async function proximoPasso(sb, ehAdmin, obrigarAdmin = true) {
  const nivel = await ok(sb.auth.mfa.getAuthenticatorAssuranceLevel());
  if (nivel?.currentLevel === "aal2") return { etapa: "pronto" };
  const fatores = await ok(sb.auth.mfa.listFactors());
  const verificado = (fatores?.totp ?? []).find((f) => f.status === "verified");
  if (verificado) return { etapa: "codigo", fatorId: verificado.id };
  if (ehAdmin && obrigarAdmin) return { etapa: "cadastro" };
  return { etapa: "pronto" };
}
let pendente = null;
const VALIDADE_PENDENTE = 10 * 60 * 1e3;
async function iniciarCadastro(sb, agora = /* @__PURE__ */ new Date()) {
  const fatores = await ok(sb.auth.mfa.listFactors());
  const abertos = (fatores?.all ?? []).filter((f) => f.factor_type === "totp" && f.status !== "verified");
  if (pendente && agora.getTime() - pendente.criado < VALIDADE_PENDENTE && abertos.some((f) => f.id === pendente.fatorId)) {
    const { fatorId, qr, chave } = pendente;
    return { fatorId, qr, chave };
  }
  for (const f of abertos) {
    await sb.auth.mfa.unenroll({ factorId: f.id });
  }
  const nome = `MotorCob ${agora.toISOString().slice(0, 19).replace("T", " ")}`;
  const d = await ok(sb.auth.mfa.enroll({ factorType: "totp", friendlyName: nome }));
  if (!d?.id || !d.totp?.qr_code || !d.totp.secret) {
    throw new ErroDuasEtapas("N\xE3o foi poss\xEDvel preparar o autenticador.", "enroll sem QR ou chave");
  }
  pendente = { fatorId: d.id, qr: d.totp.qr_code, chave: d.totp.secret, criado: agora.getTime() };
  return { fatorId: d.id, qr: d.totp.qr_code, chave: d.totp.secret };
}
function esquecerPendente() {
  pendente = null;
}
function limparCodigo(texto) {
  const d = (texto ?? "").replace(/\D/g, "");
  return d.length === 6 ? d : null;
}
async function confirmarCodigo(sb, fatorId, texto) {
  const code = limparCodigo(texto);
  if (!code) throw new ErroDuasEtapas("Digite os 6 n\xFAmeros do aplicativo.");
  await ok(sb.auth.mfa.challengeAndVerify({ factorId: fatorId, code }));
  await ok(sb.auth.refreshSession());
  const nivel = await ok(sb.auth.mfa.getAuthenticatorAssuranceLevel());
  if (nivel?.currentLevel !== "aal2") {
    throw new ErroDuasEtapas("O c\xF3digo foi aceito, mas a sess\xE3o n\xE3o foi confirmada. Entre de novo.", "aal1 depois do verify");
  }
  esquecerPendente();
}
async function cancelarCadastro(sb, fatorId) {
  esquecerPendente();
  if (fatorId) await sb.auth.mfa.unenroll({ factorId: fatorId });
  await sb.auth.signOut();
}
function chaveEmGrupos(chave) {
  return (chave ?? "").replace(/\s/g, "").replace(/(.{4})/g, "$1 ").trim();
}
export {
  ErroDuasEtapas,
  cancelarCadastro,
  chaveEmGrupos,
  confirmarCodigo,
  esquecerPendente,
  iniciarCadastro,
  limparCodigo,
  proximoPasso,
  traduzir
};
