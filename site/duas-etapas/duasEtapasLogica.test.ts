// node --experimental-strip-types --test site/duas-etapas/duasEtapasLogica.test.ts
// Supabase falso que imita o GoTrue: fatores unverified/verified, challenge, conferência TOTP de verdade (RFC 6238),
// nível da sessão (aal1 → aal2) e os erros que travaram o login em produção.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { cancelarCadastro, chaveEmGrupos, confirmarCodigo, ErroDuasEtapas, esquecerPendente, iniciarCadastro, limparCodigo, proximoPasso,
  traduzir, type ClienteAuth, type Fator } from "./duasEtapasLogica.ts";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(s: string): Buffer {
  let bits = "";
  for (const c of s.replace(/=+$/, "")) bits += B32.indexOf(c).toString(2).padStart(5, "0");
  return Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
}
export function totp(segredo: string, ms = Date.now()): string {
  const passo = Buffer.alloc(8);
  passo.writeBigUInt64BE(BigInt(Math.floor(ms / 30000)));
  const h = createHmac("sha1", base32(segredo)).update(passo).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

class SupabaseFalso {
  fatores: (Fator & { segredo: string; nome: string })[] = [];
  nivel = "aal1";
  saiu = false;
  chamadas: string[] = [];
  falharIp = false;
  seq = 0;
  r = <T>(data: T, msg?: string) => Promise.resolve({ data, error: msg ? { message: msg } : null });
  get cliente(): ClienteAuth {
    const f = this;
    return { auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: () => f.r({ currentLevel: f.nivel,
          nextLevel: f.fatores.some((x) => x.status === "verified") ? "aal2" : "aal1" }),
        listFactors: () => f.r({ all: f.fatores.map(({ id, status, factor_type }) => ({ id, status, factor_type })),
          totp: f.fatores.filter((x) => x.status === "verified").map(({ id, status, factor_type }) => ({ id, status, factor_type })) }),
        enroll: ({ friendlyName }) => {
          f.chamadas.push("enroll");
          if (f.fatores.some((x) => x.nome === friendlyName || (x.status === "unverified" && !friendlyName))) {
            return f.r(null, "A factor with the friendly name \"\" for this user already exists");
          }
          const segredo = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP".slice(0, 16 + (++f.seq % 3) * 8);
          const id = `f${f.seq}`;
          f.fatores.push({ id, status: "unverified", factor_type: "totp", segredo, nome: friendlyName ?? "" });
          return f.r({ id, totp: { qr_code: `data:image/svg+xml;utf-8,<svg id="${id}"/>`, secret: segredo } });
        },
        unenroll: ({ factorId }) => {
          f.chamadas.push(`unenroll:${factorId}`);
          f.fatores = f.fatores.filter((x) => x.id !== factorId);
          return f.r({ id: factorId });
        },
        challengeAndVerify: ({ factorId, code }) => {
          f.chamadas.push("challengeAndVerify");
          const fat = f.fatores.find((x) => x.id === factorId);
          if (!fat) return f.r(null, "MFA factor not found");
          if (f.falharIp) return f.r(null, "Challenge and verify IP addresses mismatch");
          if (code !== totp(fat.segredo)) return f.r(null, "Invalid TOTP code entered");
          fat.status = "verified";
          f.nivel = "aal2";
          return f.r({ access_token: "x" });
        },
      },
      refreshSession: () => f.r({}),
      signOut: () => { f.saiu = true; return Promise.resolve({ error: null }); },
    } };
  }
}

test("próximo passo depois do login", async () => {
  const s = new SupabaseFalso();
  assert.deepEqual(await proximoPasso(s.cliente, false), { etapa: "pronto" });         // não Admin, sem fator
  assert.deepEqual(await proximoPasso(s.cliente, true), { etapa: "cadastro" });        // Admin sem fator
  assert.deepEqual(await proximoPasso(s.cliente, true, false), { etapa: "pronto" });   // obrigatoriedade desligada
  s.fatores.push({ id: "u", status: "unverified", factor_type: "totp", segredo: "X", nome: "" });
  assert.deepEqual(await proximoPasso(s.cliente, true), { etapa: "cadastro" });        // pela metade não conta
  s.fatores.push({ id: "v", status: "verified", factor_type: "totp", segredo: "X", nome: "a" });
  assert.deepEqual(await proximoPasso(s.cliente, false), { etapa: "codigo", fatorId: "v" });
  s.nivel = "aal2";
  assert.deepEqual(await proximoPasso(s.cliente, true), { etapa: "pronto" });
});

test("cadastro limpa o que ficou pela metade e confirma com o código do aplicativo", async () => {
  esquecerPendente();
  const s = new SupabaseFalso();
  s.fatores.push({ id: "velho", status: "unverified", factor_type: "totp", segredo: "X", nome: "" });   // o que travava
  const c = await iniciarCadastro(s.cliente);
  assert.ok(s.chamadas.includes("unenroll:velho"));
  assert.match(c.qr, /^data:image\/svg/);
  assert.equal(s.fatores.length, 1);
  await assert.rejects(confirmarCodigo(s.cliente, c.fatorId, "000000"), (e: ErroDuasEtapas) =>
    /Código inválido/.test(e.frase) && /Invalid TOTP/.test(e.detalhe));
  assert.equal(s.nivel, "aal1");
  const codigo = totp(c.chave);
  await confirmarCodigo(s.cliente, c.fatorId, `${codigo.slice(0, 3)} ${codigo.slice(3)}`);   // colado com espaço
  assert.equal(s.nivel, "aal2");
  assert.equal(s.fatores[0].status, "verified");
  assert.ok(!s.chamadas.includes("verify"));    // nunca verify sem challenge
});

test("login de quem já tem autenticador pede só o código", async () => {
  esquecerPendente();
  const s = new SupabaseFalso();
  const c = await iniciarCadastro(s.cliente);
  await confirmarCodigo(s.cliente, c.fatorId, totp(c.chave));
  s.nivel = "aal1";                                   // novo login
  const p = await proximoPasso(s.cliente, true);
  assert.deepEqual(p, { etapa: "codigo", fatorId: c.fatorId });
  await confirmarCodigo(s.cliente, c.fatorId, totp(c.chave));
  assert.deepEqual(await proximoPasso(s.cliente, true), { etapa: "pronto" });
});

test("tela montada de novo no meio do cadastro mostra o MESMO QR", async () => {
  esquecerPendente();
  const s = new SupabaseFalso();
  const a = await iniciarCadastro(s.cliente, new Date("2026-10-11T07:00:00Z"));
  const b = await iniciarCadastro(s.cliente, new Date("2026-10-11T07:00:05Z"));   // remontou (rota, StrictMode)
  assert.deepEqual(b, a);
  assert.equal(s.chamadas.filter((c) => c === "enroll").length, 1);
  await confirmarCodigo(s.cliente, b.fatorId, totp(a.chave));                     // código lido do 1º QR vale
  assert.equal(s.nivel, "aal2");
});

test("cadastro velho (mais de 10 min) ou apagado no servidor gera QR novo; cancelar limpa tudo", async () => {
  esquecerPendente();
  const s = new SupabaseFalso();
  const a = await iniciarCadastro(s.cliente, new Date("2026-10-11T07:00:00Z"));
  const b = await iniciarCadastro(s.cliente, new Date("2026-10-11T07:11:00Z"));
  assert.notEqual(a.fatorId, b.fatorId);
  assert.deepEqual(s.fatores.map((f) => f.id), [b.fatorId]);
  s.fatores = [];                                                                  // reset pelo Admin
  const c = await iniciarCadastro(s.cliente, new Date("2026-10-11T07:11:30Z"));
  assert.notEqual(c.fatorId, b.fatorId);
  await cancelarCadastro(s.cliente, c.fatorId);
  assert.equal(s.fatores.length, 0);
  assert.ok(s.saiu);
  const d = await iniciarCadastro(s.cliente, new Date("2026-10-11T07:11:40Z"));    // depois de cancelar: novo
  assert.notEqual(d.fatorId, c.fatorId);
});

test("mensagens de erro em português com o detalhe guardado", async () => {
  esquecerPendente();
  const s = new SupabaseFalso();
  const c = await iniciarCadastro(s.cliente);
  s.falharIp = true;
  await assert.rejects(confirmarCodigo(s.cliente, c.fatorId, totp(c.chave)), (e: ErroDuasEtapas) => /internet/.test(e.frase));
  await assert.rejects(confirmarCodigo(s.cliente, c.fatorId, "12345"), (e: ErroDuasEtapas) => /6 números/.test(e.frase));
  assert.equal(traduzir({ message: "Erro novo qualquer" }).frase, "Não foi possível verificar o segundo fator.");
  assert.equal(traduzir({ message: "Erro novo qualquer" }).detalhe, "Erro novo qualquer");
  assert.equal(limparCodigo("12 34 56"), "123456");
  assert.equal(chaveEmGrupos("JBSWY3DPEHPK3PXP"), "JBSW Y3DP EHPK 3PXP");
  assert.equal(totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59000), "287082");   // vetor do RFC 6238 (SHA-1, T=59)
});
