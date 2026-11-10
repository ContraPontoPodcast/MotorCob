import { test } from "node:test";
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import {
  assinadorDe, base64, jwtDaConta, lerChave, motivoSenha, nivelDaSessao, nomeDaEmpresa, numeroVersao, pedidoCriar,
  pedidoVersao, REGIAO, SENHA_MAX, urlDestruir, urlVersoes, validarPedido, versoesAntigas,
} from "./regras.ts";

const SENHA = "Senha-Ficticia-123";

test("pedido: só tronco (inteiro > 0) e senha; nada mais", () => {
  assert.deepEqual(validarPedido({ tronco: 7, senha: SENHA }).pedido, { tronco: 7, senha: SENHA });
  assert.equal(validarPedido({ tronco: "7", senha: SENHA }).erro, "tronco inválido");
  assert.equal(validarPedido({ tronco: 0, senha: SENHA }).erro, "tronco inválido");
  assert.equal(validarPedido({ tronco: 7, senha: SENHA, empresa: 3 }).erro, "pedido inválido");
  assert.equal(validarPedido({ tronco: 7, senha: SENHA, nome: "motorcx-voz-trunk-e1-x" }).erro, "pedido inválido");
  assert.equal(validarPedido([7]).erro, "pedido inválido");
  assert.equal(validarPedido(null).erro, "pedido inválido");
});

test("senha: 8 a 128, sem quebra de linha, controle nem espaço nas pontas; ; e acento valem", () => {
  assert.equal(motivoSenha("1234567"), "a senha precisa ter de 8 a 128 caracteres");
  assert.equal(motivoSenha("x".repeat(SENHA_MAX + 1)), "a senha precisa ter de 8 a 128 caracteres");
  assert.equal(motivoSenha("x".repeat(SENHA_MAX)), null);
  assert.match(motivoSenha("abcd\nefgh") ?? "", /quebra de linha/);
  assert.match(motivoSenha("abcd\tefgh") ?? "", /quebra de linha/);
  assert.match(motivoSenha(" abcdefgh") ?? "", /espaço/);
  assert.match(motivoSenha("abcdefgh ") ?? "", /espaço/);
  assert.equal(motivoSenha("ab;cd ção#[x]"), null);
  assert.equal(motivoSenha(12345678), "senha inválida");
});

test("o erro da validação nunca repete a senha", () => {
  for (const s of ["curta", " com-espaco-na-ponta", "linha\nquebrada-123"]) {
    assert.ok(!(validarPedido({ tronco: 1, senha: s }).erro ?? "").includes(s.trim()));
  }
});

function jwt(payload: object) {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "HS256" })}.${b(payload)}.assinatura`;
}

test("nível da sessão: lê o aal do JWT; sem ele, vazio", () => {
  assert.equal(nivelDaSessao(jwt({ sub: "u", aal: "aal2" })), "aal2");
  assert.equal(nivelDaSessao(jwt({ sub: "u", aal: "aal1" })), "aal1");
  assert.equal(nivelDaSessao(jwt({ sub: "u" })), "");
  assert.equal(nivelDaSessao("lixo"), "");
});

test("nome do segredo: só o da empresa do tronco, no prefixo motorcx-voz-trunk-e<empresa>-", () => {
  assert.equal(nomeDaEmpresa("motorcx-voz-trunk-e12-aurora-opc", 12), true);
  assert.equal(nomeDaEmpresa("motorcx-voz-trunk-e12-aurora_01", "12"), true);
  assert.equal(nomeDaEmpresa("motorcx-voz-trunk-e12-aurora-opc", 1), false);
  assert.equal(nomeDaEmpresa("motorcx-voz-trunk-e1-2-aurora", 12), false);
  assert.equal(nomeDaEmpresa("motorcx-voz-ari-senha", 12), false);
  assert.equal(nomeDaEmpresa("motorcx-voz-identidade-e12", 12), false);
  assert.equal(nomeDaEmpresa("motorcx-voz-trunk-e12-../x", 12), false);
  assert.equal(nomeDaEmpresa(null, 12), false);
});

test("chave: conta de serviço com e-mail, chave privada e projeto; erro nunca devolve a chave", () => {
  const ok = JSON.stringify({ client_email: "motorcx-voz-cofre-escrita@motorcob.iam.gserviceaccount.com",
                              private_key: "-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----\n", project_id: "motorcob" });
  assert.equal(lerChave(ok)?.project_id, "motorcob");
  assert.equal(lerChave(ok, "outro-projeto")?.project_id, "outro-projeto");
  assert.equal(lerChave("{}"), null);
  assert.equal(lerChave("não é json"), null);
  assert.equal(lerChave(undefined), null);
  assert.equal(lerChave(JSON.stringify({ client_email: "x@y.com", private_key: "-----BEGIN PRIVATE KEY-----" })), null);
});

test("JWT da conta: RS256 assinado com a chave, escopo cloud-platform, 10 minutos", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const chave = { client_email: "c@motorcob.iam.gserviceaccount.com", project_id: "motorcob",
                  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
  const j = await jwtDaConta(chave, new Date("2027-02-16T12:00:00Z"), await assinadorDe(chave));
  const [cab, corpo, ass] = j.split(".");
  const c = JSON.parse(Buffer.from(corpo, "base64url").toString());
  assert.deepEqual([c.iss, c.scope, c.aud, c.exp - c.iat], [chave.client_email, "https://www.googleapis.com/auth/cloud-platform",
                                                          "https://oauth2.googleapis.com/token", 600]);
  const v = createVerify("RSA-SHA256");
  v.update(`${cab}.${corpo}`);
  assert.ok(v.verify(publicKey, Buffer.from(ass, "base64url")));
});

test("Secret Manager: cria com réplica em São Paulo e rótulo da empresa; versão com a senha em base64", () => {
  const c = pedidoCriar("motorcob", "motorcx-voz-trunk-e12-aurora", 12);
  assert.equal(c.url, "https://secretmanager.googleapis.com/v1/projects/motorcob/secrets?secretId=motorcx-voz-trunk-e12-aurora");
  assert.deepEqual(c.corpo.replication.userManaged.replicas, [{ location: REGIAO }]);
  assert.equal(c.corpo.labels["motorcx-empresa"], "12");
  assert.ok(!JSON.stringify(c).includes(SENHA));
  const v = pedidoVersao("motorcob", "motorcx-voz-trunk-e12-aurora", "Ação;123");
  assert.equal(v.url, "https://secretmanager.googleapis.com/v1/projects/motorcob/secrets/motorcx-voz-trunk-e12-aurora:addVersion");
  assert.equal(Buffer.from(v.corpo.payload.data, "base64").toString("utf8"), "Ação;123");
  assert.equal(base64("abc"), "YWJj");
});

test("versões: o número vem do nome; destrói todas menos a nova", () => {
  assert.equal(numeroVersao("projects/1/secrets/x/versions/7"), 7);
  assert.equal(numeroVersao("projects/1/secrets/x/versions/latest"), null);
  assert.equal(numeroVersao(undefined), null);
  const lista = { versions: [{ name: "projects/1/secrets/x/versions/9" }, { name: "projects/1/secrets/x/versions/8" },
                             { name: "projects/1/secrets/x/versions/3" }, { name: 5 }] };
  assert.deepEqual(versoesAntigas(lista, 9), ["projects/1/secrets/x/versions/8", "projects/1/secrets/x/versions/3"]);
  assert.deepEqual(versoesAntigas(null, 9), []);
  assert.equal(urlDestruir("projects/1/secrets/x/versions/8"), "https://secretmanager.googleapis.com/v1/projects/1/secrets/x/versions/8:destroy");
  assert.match(urlVersoes("motorcob", "x"), /\/projects\/motorcob\/secrets\/x\/versions\?filter=state%3A/);
});
