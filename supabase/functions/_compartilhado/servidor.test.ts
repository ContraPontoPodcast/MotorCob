import assert from "node:assert/strict";
import { test } from "node:test";
import { chavesDoServidor, ehServidor, mesmoTexto } from "./servidor.ts";

const env = (m: Record<string, string>) => (k: string) => m[k];
const resposta = (status: number) => async () => new Response("{}", { status });

test("chaves do ambiente: a antiga e as secretas novas", () => {
  assert.deepEqual(chavesDoServidor(env({ SUPABASE_SERVICE_ROLE_KEY: "eyJ.a.b", SUPABASE_SECRET_KEYS: '{"default":"sb_secret_x","motor":"sb_secret_y"}' })),
    ["eyJ.a.b", "sb_secret_x", "sb_secret_y"]);
  assert.deepEqual(chavesDoServidor(env({ SUPABASE_SECRET_KEYS: "não é json" })), []);
});

test("chave secreta nova reconhecida sem perguntar ao Supabase", async () => {
  let chamou = false;
  const f = async () => { chamou = true; return new Response("{}", { status: 401 }); };
  assert.equal(await ehServidor("sb_secret_x", "https://p.supabase.co", f as typeof fetch,
    env({ SUPABASE_SERVICE_ROLE_KEY: "eyJ.a.b", SUPABASE_SECRET_KEYS: '{"default":"sb_secret_x"}' })), true);
  assert.equal(chamou, false);
});

test("outra chave de servidor: o Supabase confirma (sb_secret só no apikey)", async () => {
  let cab: Record<string, string> = {};
  const f = async (_u: string, o: RequestInit) => { cab = o.headers as Record<string, string>; return new Response("{}", { status: 200 }); };
  assert.equal(await ehServidor("sb_secret_outra", "https://p.supabase.co/", f as unknown as typeof fetch, env({})), true);
  assert.equal(cab.apikey, "sb_secret_outra");
  assert.equal(cab.Authorization, undefined);
});

test("login de usuário não é servidor", async () => {
  assert.equal(await ehServidor("eyJ.usuario.x", "https://p.supabase.co", resposta(403) as typeof fetch, env({ SUPABASE_SERVICE_ROLE_KEY: "eyJ.a.b" })), false);
  assert.equal(await ehServidor("", "https://p.supabase.co", resposta(200) as typeof fetch, env({})), false);
  assert.equal(await ehServidor("x", "https://p.supabase.co", (async () => { throw new Error("rede"); }) as typeof fetch, env({})), false);
});

test("comparação exata", () => {
  assert.equal(mesmoTexto("abc", "abc"), true);
  assert.equal(mesmoTexto("abc", "abd"), false);
  assert.equal(mesmoTexto("abc", "abcd"), false);
});
