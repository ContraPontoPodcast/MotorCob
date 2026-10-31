import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createVerify, generateKeyPairSync } from "node:crypto";
import {
  ACAO_ACESSO, PERMISSAO, assinadorDe, autorizar, caminhoObjeto, carimbo, lerChave, lerTranscricao, mascarar,
  textoParaAssinar, urlAssinada, validarPedido, VALIDADE_S,
} from "./regras.ts";

const cliente = { id: "u1", ativo: true, equipe: false, empresa_id: 7 };
const grav = { id: 501, empresa_id: 7, caminho: "cartao/2026/10/31/AC-9912_ch-88.mp3", transcricao_caminho: "cartao/2026/10/31/AC-9912_ch-88.json" };

test("pedido: só gravacao (inteiro > 0) e tipo audio | transcricao", () => {
  assert.deepEqual(validarPedido({ gravacao: 501, tipo: "audio" }).pedido, { gravacao: 501, tipo: "audio" });
  assert.equal(validarPedido({ gravacao: 501, tipo: "transcricao" }).pedido?.tipo, "transcricao");
  assert.equal(validarPedido({ gravacao: "501", tipo: "audio" }).erro, "gravação inválida");
  assert.equal(validarPedido({ gravacao: 0, tipo: "audio" }).erro, "gravação inválida");
  assert.equal(validarPedido({ gravacao: 5, tipo: "baixar" }).erro, "tipo inválido: audio ou transcricao");
  assert.equal(validarPedido({ gravacao: 5, tipo: "audio", caminho: "x" }).erro, "pedido inválido");
  assert.equal(validarPedido(null).erro, "pedido inválido");
  assert.equal(validarPedido([1]).erro, "pedido inválido");
});

test("permissão e registro por tipo", () => {
  assert.equal(PERMISSAO.audio, "ouvir_gravacoes");
  assert.equal(PERMISSAO.transcricao, "ver_transcricoes");
  assert.equal(ACAO_ACESSO.audio, "ouvir_gravacao");
  assert.equal(ACAO_ACESSO.transcricao, "ler_transcricao");
});

test("quem pode: cliente ativo, mesma empresa, com a permissão", () => {
  assert.equal(autorizar(cliente, true, grav), null);
  assert.equal(autorizar(cliente, false, grav), "sem permissão");
  assert.equal(autorizar({ ...cliente, empresa_id: 8 }, true, grav), "gravação não encontrada");
  assert.equal(autorizar(cliente, true, null), "gravação não encontrada");     // a RLS escondeu: 404, não 403
  assert.equal(autorizar({ ...cliente, ativo: false }, true, grav), "acesso desativado");
  assert.equal(autorizar({ ...cliente, equipe: true }, true, grav), "a equipe MotorCX não ouve nem lê gravações pelo site");
  assert.equal(autorizar(null, true, grav), "acesso desativado");
});

test("credencial: JSON da conta de serviço, sem expor nada quando inválido", () => {
  assert.equal(lerChave(undefined), null);
  assert.equal(lerChave("não é json"), null);
  assert.equal(lerChave(JSON.stringify({ client_email: "x@p.iam.gserviceaccount.com" })), null);
  const ok = lerChave(JSON.stringify({ client_email: "leitor@proj.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----\n" }));
  assert.equal(ok?.client_email, "leitor@proj.iam.gserviceaccount.com");
});

test("caminho do objeto: path-style, codificado, sem .. e sem 10+ dígitos", () => {
  assert.equal(caminhoObjeto("voz-aurora", "a/b_c.mp3"), "/voz-aurora/a/b_c.mp3");
  assert.throws(() => caminhoObjeto("voz-aurora", "a/b c.mp3"), /caminho inválido/);
  assert.throws(() => caminhoObjeto("voz-aurora", "a/../b.mp3"), /caminho inválido/);
  assert.throws(() => caminhoObjeto("voz-aurora", "a//b.mp3"), /caminho inválido/);
  assert.throws(() => caminhoObjeto("voz-aurora", "a/11987654321.mp3"), /caminho inválido/);
  assert.throws(() => caminhoObjeto("Voz Aurora", "a.mp3"), /bucket inválido/);
});

test("pedido canônico V4: GET, host, query ordenada, UNSIGNED-PAYLOAD", () => {
  const agora = new Date("2026-10-31T17:13:32.123Z");
  assert.deepEqual(carimbo(agora), { data: "20261031", hora: "20261031T171332Z" });
  const t = textoParaAssinar({ email: "leitor@proj.iam.gserviceaccount.com", bucket: "voz-aurora", objeto: grav.caminho, agora, validade: VALIDADE_S });
  assert.equal(t.escopo, "20261031/auto/storage/goog4_request");
  assert.equal(t.query,
    "X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=leitor%40proj.iam.gserviceaccount.com%2F20261031%2Fauto%2Fstorage%2Fgoog4_request"
    + "&X-Goog-Date=20261031T171332Z&X-Goog-Expires=300&X-Goog-SignedHeaders=host");
  assert.equal(t.canonico, `GET\n/voz-aurora/cartao/2026/10/31/AC-9912_ch-88.mp3\n${t.query}\nhost:storage.googleapis.com\n\nhost\nUNSIGNED-PAYLOAD`);
  assert.throws(() => textoParaAssinar({ email: "a@b", bucket: "voz-aurora", objeto: "a.mp3", agora, validade: 0 }), /validade/);
});

test("URL assinada: 5 minutos, assinatura RSA-SHA256 que confere com a chave pública", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const chave = lerChave(JSON.stringify({ client_email: "leitor@proj.iam.gserviceaccount.com", private_key: pem }))!;
  const agora = new Date("2026-10-31T17:13:32Z");
  const r = await urlAssinada({ email: chave.client_email, bucket: "voz-aurora", objeto: grav.caminho, agora, validade: VALIDADE_S }, await assinadorDe(chave));
  assert.equal(r.expira_em, "2026-10-31T17:18:32.000Z");
  const u = new URL(r.url);
  assert.equal(u.host, "storage.googleapis.com");
  assert.equal(u.searchParams.get("X-Goog-Expires"), "300");
  const assinatura = u.searchParams.get("X-Goog-Signature")!;
  assert.match(assinatura, /^[0-9a-f]{512}$/);
  const t = textoParaAssinar({ email: chave.client_email, bucket: "voz-aurora", objeto: grav.caminho, agora, validade: VALIDADE_S });
  const texto = ["GOOG4-RSA-SHA256", t.hora, t.escopo, createHash("sha256").update(t.canonico).digest("hex")].join("\n");
  assert.ok(createVerify("RSA-SHA256").update(texto).verify(publicKey, assinatura, "hex"));
  assert.ok(!r.url.includes("BEGIN"));
});

test("transcrição: formato fechado, quem normalizado e máscara de garantia", () => {
  const s = lerTranscricao({ segmentos: [
    { quem: "agente", em_s: 0, texto: "Falo com [NOME]?" },
    { quem: "user", em_s: 6.4, texto: "Meu CPF é 123.456.789-09 e o telefone (11) 98765-4321" },
    { role: "agent", time_in_call_secs: 11, message: "Mande para ana@exemplo.com" },
    { quem: "sistema", texto: "ignorado" },
    { quem: "pessoa", texto: "   " },
  ] })!;
  assert.equal(s.length, 3);
  assert.deepEqual(s[0], { quem: "agente", em_s: 0, texto: "Falo com [NOME]?" });
  assert.equal(s[1].quem, "pessoa");
  assert.equal(s[1].em_s, 6);
  assert.doesNotMatch(s[1].texto, /\d{4}/);
  assert.match(s[1].texto, /\[CPF\]/);
  assert.equal(s[2].texto, "Mande para [E-MAIL]");
  assert.equal(lerTranscricao({ outra: 1 }), null);
  assert.equal(mascarar("pagar dia 5, parcela de 120"), "pagar dia 5, parcela de 120");
});
