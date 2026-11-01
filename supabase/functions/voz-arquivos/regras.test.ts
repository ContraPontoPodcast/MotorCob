// node --experimental-strip-types --test supabase/functions/voz-arquivos/regras.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { bilheteDoCabecalho, operacaoDoCabecalho, sha256Hex, tamanhoAceito, urlObjeto, usoValido } from "./regras.ts";

const B = "a".repeat(64);

test("bilhete e operação no cabeçalho", () => {
  assert.equal(bilheteDoCabecalho(new Headers({ "x-voz-bilhete": B })), B);
  assert.equal(bilheteDoCabecalho(new Headers({ "x-voz-bilhete": B.toUpperCase() })), null);
  assert.equal(bilheteDoCabecalho(new Headers({ "x-voz-bilhete": "a".repeat(63) })), null);
  assert.equal(bilheteDoCabecalho(new Headers()), null);
  assert.equal(operacaoDoCabecalho(new Headers({ "x-voz-operacao": "baixar" })), "baixar");
  assert.equal(operacaoDoCabecalho(new Headers({ "x-voz-operacao": "listar" })), null);
});

test("sha-256 igual ao do banco (encode(sha256(convert_to(t, 'UTF8')), 'hex'))", async () => {
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("uso devolvido pelo banco: operação e bucket casados, caminho limpo", () => {
  const ok = { operacao: "baixar", bucket: "saidas", caminho: "alfa/2026-11-03/discador_mailing.csv" };
  assert.deepEqual(usoValido([ok], "baixar"), ok);
  assert.equal(usoValido([ok], "enviar"), null);                                    // pediu outra operação
  assert.equal(usoValido([], "baixar"), null);                                      // bilhete não achado
  assert.equal(usoValido([{ ...ok, bucket: "entradas" }], "baixar"), null);         // baixar só de saidas
  assert.equal(usoValido([{ operacao: "enviar", bucket: "saidas", caminho: "a/b.csv" }], "enviar"), null);
  assert.equal(usoValido([{ ...ok, caminho: "alfa/../beta/x.csv" }], "baixar"), null);
  assert.equal(usoValido([{ ...ok, caminho: "/alfa/x.csv" }], "baixar"), null);
});

test("apagar anexo de pedido de fluxo (SQL 58): entradas ou chamados, nome dado pela pessoa", () => {
  const anexo = { operacao: "apagar", bucket: "chamados", caminho: "alfa/Pedido Fluxo v2.docx" };
  assert.deepEqual(usoValido([anexo], "apagar"), anexo);
  assert.deepEqual(usoValido([{ ...anexo, bucket: "entradas" }], "apagar")?.bucket, "entradas");
  assert.equal(usoValido([{ ...anexo, operacao: "enviar" }], "enviar"), null);       // chamados: só apagar
  assert.equal(usoValido([{ ...anexo, operacao: "baixar" }], "baixar"), null);
  assert.equal(usoValido([{ ...anexo, caminho: "alfa/../beta/x.pdf" }], "apagar"), null);
  assert.equal(usoValido([{ ...anexo, caminho: "Alfa/x.pdf" }], "apagar"), null);    // slug minúsculo
  assert.equal(usoValido([{ ...anexo, bucket: "saidas" }], "apagar"), null);
  assert.equal(usoValido([{ operacao: "enviar", bucket: "entradas", caminho: "alfa/Com Espaco.csv" }], "enviar"), null);
});

test("url do objeto e tamanho", () => {
  assert.equal(urlObjeto("https://x.supabase.co/", "saidas", "alfa/2026-11-03/ids/agente_voz.csv"),
    "https://x.supabase.co/storage/v1/object/saidas/alfa/2026-11-03/ids/agente_voz.csv");
  assert.equal(tamanhoAceito("100", 100), true);
  assert.equal(tamanhoAceito(null), true);
  assert.equal(tamanhoAceito(String(21 * 1024 * 1024)), false);
  assert.equal(tamanhoAceito("10", 0), false);
  assert.equal(tamanhoAceito("abc"), false);
});
