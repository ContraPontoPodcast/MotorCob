// node --experimental-strip-types --test supabase/functions/admin-usuarios/regras.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { autorizar, empresaAlvo, validarPedido, type Perfil } from "./regras.ts";

const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const admA: Perfil = { id: ID(1), papel: "admin", ativo: true, empresa_id: 1, equipe: false };
const gestA: Perfil = { id: ID(2), papel: "gestao", ativo: true, empresa_id: 1, equipe: false };
const operA: Perfil = { id: ID(3), papel: "operacao", ativo: true, empresa_id: 1, equipe: false };
const operB: Perfil = { id: ID(4), papel: "operacao", ativo: true, empresa_id: 2, equipe: false };
const equipe: Perfil = { id: ID(5), papel: "admin", ativo: true, empresa_id: null, equipe: true };

const ped = (c: unknown) => {
  const r = validarPedido(c);
  assert.ok(r.pedido, r.erro);
  return r.pedido!;
};

test("valida o pedido", () => {
  assert.equal(validarPedido(null).erro, "pedido inválido");
  assert.equal(validarPedido({ acao: "apagar" }).erro, "ação desconhecida");
  assert.equal(validarPedido({ acao: "desativar", usuario_id: "1 or 1=1" }).erro, "usuário inválido");
  assert.equal(validarPedido({ acao: "convidar", email: "x@y", papel: "operacao" }).erro, "e-mail inválido");
  assert.equal(validarPedido({ acao: "convidar", email: "a@b.com", papel: "dono" }).erro, "perfil inválido");
  assert.equal(validarPedido({ acao: "listar", empresa_id: "1;drop" }).erro, "empresa inválida");
  assert.deepEqual(ped({ acao: "convidar", email: " Ana@Empresa.com ", papel: "gestao" }),
    { acao: "convidar", email: "ana@empresa.com", papel: "gestao" });
});

test("Admin da empresa gerencia a própria empresa", () => {
  assert.equal(autorizar(admA, true, ped({ acao: "desativar", usuario_id: operA.id }), operA), null);
  assert.equal(autorizar(admA, true, ped({ acao: "convidar", email: "a@b.com", papel: "admin" }), null), null);
  assert.equal(empresaAlvo(admA, ped({ acao: "convidar", email: "a@b.com", papel: "operacao", empresa_id: 2 })), 1);
});

test("travas", () => {
  assert.equal(autorizar(operA, false, ped({ acao: "listar" }), null), "sem permissão para gerenciar usuários");
  assert.equal(autorizar({ ...admA, ativo: false }, true, ped({ acao: "listar" }), null), "usuário inativo");
  assert.equal(autorizar(admA, true, ped({ acao: "desativar", usuario_id: operB.id }), operB), "usuário de outra empresa");
  assert.equal(autorizar(admA, true, ped({ acao: "listar", empresa_id: 2 }), null), "só a equipe MotorCob gerencia outra empresa");
  assert.equal(autorizar(admA, true, ped({ acao: "alterar_papel", usuario_id: admA.id, papel: "gestao" }), admA),
    "ninguém altera o próprio perfil ou status");
  assert.equal(autorizar(admA, true, ped({ acao: "desativar", usuario_id: equipe.id }), equipe), "usuário da equipe MotorCob");
  // gestão com a permissão liberada pelo Admin não mexe em Admin nem cria Admin
  assert.equal(autorizar(gestA, true, ped({ acao: "desativar", usuario_id: admA.id }), admA), "só um Admin cria ou altera outro Admin");
  assert.equal(autorizar(gestA, true, ped({ acao: "alterar_papel", usuario_id: operA.id, papel: "admin" }), operA),
    "só um Admin cria ou altera outro Admin");
  assert.equal(autorizar(gestA, true, ped({ acao: "convidar", email: "a@b.com", papel: "admin" }), null), "só um Admin cria outro Admin");
  assert.equal(autorizar(gestA, true, ped({ acao: "reativar", usuario_id: operA.id }), operA), null);
  assert.equal(autorizar(admA, true, ped({ acao: "resetar_senha", usuario_id: admA.id }), admA), null);
});

test("equipe MotorCob gerencia qualquer empresa", () => {
  assert.equal(autorizar(equipe, true, ped({ acao: "desativar", usuario_id: operB.id }), operB), null);
  assert.equal(empresaAlvo(equipe, ped({ acao: "listar", empresa_id: 2 })), 2);
  assert.equal(autorizar(equipe, true, ped({ acao: "listar" }), null), "informe a empresa");
});

test("acessos no convite", () => {
  assert.equal(validarPedido({ acao: "convidar", email: "a@b.com", papel: "operacao", acessos: { apagar: true } }).erro,
    "acessos inválidos");
  assert.equal(validarPedido({ acao: "convidar", email: "a@b.com", papel: "operacao", acessos: { reenquadrar: "sim" } }).erro,
    "acessos inválidos");
  const p = ped({ acao: "convidar", email: "a@b.com", papel: "operacao", acessos: { reenquadrar: true, baixar_listas: false } });
  assert.deepEqual(p.acessos, { reenquadrar: true, baixar_listas: false });
  assert.equal(autorizar(admA, true, p, null), null);
  assert.equal(autorizar(gestA, true, p, null), null);
  const adm = ped({ acao: "convidar", email: "a@b.com", papel: "operacao", acessos: { ver_auditoria: true } });
  assert.equal(autorizar(gestA, true, adm, null), "só um Admin libera acessos de administração");
  assert.equal(autorizar(admA, true, adm, null), null);
  const tranca = ped({ acao: "convidar", email: "a@b.com", papel: "admin", acessos: { gerenciar_usuarios: false } });
  assert.equal(autorizar(admA, true, tranca, null), "o Admin não pode perder gerenciar usuários/permissões");
});
