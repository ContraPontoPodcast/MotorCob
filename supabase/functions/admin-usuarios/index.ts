// Edge Function admin-usuarios: convidar, listar, desativar, reativar, resetar senha e trocar o perfil.
// O site chama com o login do usuário (Authorization: Bearer <token>); quem pode é decidido pelo banco
// (pode('gerenciar_usuarios')) e por regras.ts. A chave service_role vem só da variável de ambiente do
// servidor (Supabase › Edge Functions › Secrets) e nunca sai daqui.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { autorizar, empresaAlvo, type Pedido, type Perfil, validarPedido } from "./regras.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = Deno.env.get("SITE_URL") ?? "https://motorcob.online";
const ORIGENS = (Deno.env.get("ORIGENS_PERMITIDAS") ?? SITE).split(",").map((s) => s.trim()).filter(Boolean);
const BANIDO = "876000h"; // ~100 anos: o login fica bloqueado até reativar

const sem = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(SUPABASE_URL, SERVICE, sem);

function cabecalhos(origem: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origem && ORIGENS.includes(origem) ? origem : ORIGENS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

function responder(corpo: unknown, status: number, origem: string | null) {
  return new Response(JSON.stringify(corpo), { status, headers: cabecalhos(origem) });
}

async function auditar(quem: Perfil, empresa_id: number | null, acao: "INSERT" | "UPDATE", registro: string,
                       mudou: Record<string, unknown>) {
  const { error } = await admin.from("auditoria").insert({
    empresa_id, usuario: quem.id, tabela: "perfis", acao, registro, mudou,
  });
  if (error) console.error("auditoria", error.code);
}

async function executar(quem: Perfil, pedido: Pedido, alvo: Perfil | null): Promise<[number, unknown]> {
  switch (pedido.acao) {
    case "listar": {
      const empresa = empresaAlvo(quem, pedido);
      const { data, error } = await admin.from("perfis")
        .select("id, nome, email, papel, ativo, empresa_id, criado_em")
        .eq("empresa_id", empresa).eq("equipe", false).order("nome");
      if (error) throw error;
      const ultimos = new Map<string, string | null>();
      for (let pagina = 1; pagina <= 20; pagina++) {
        const { data: lote, error: e } = await admin.auth.admin.listUsers({ page: pagina, perPage: 500 });
        if (e) throw e;
        for (const u of lote.users) ultimos.set(u.id, u.last_sign_in_at ?? null);
        if (lote.users.length < 500) break;
      }
      return [200, { usuarios: (data ?? []).map((p) => ({ ...p, ultimo_acesso: ultimos.get(p.id) ?? null })) }];
    }
    case "convidar": {
      const empresa = empresaAlvo(quem, pedido);
      const { data, error } = await admin.auth.admin.inviteUserByEmail(pedido.email!, {
        redirectTo: `${SITE}/definir-senha`,
        data: pedido.nome ? { nome: pedido.nome } : undefined,
      });
      if (error) {
        if (/already|registered|exists/i.test(error.message)) return [409, { erro: "e-mail já cadastrado" }];
        throw error;
      }
      const id = data.user.id;
      const { error: e } = await admin.from("perfis")
        .update({ papel: pedido.papel, empresa_id: empresa, ativo: true }).eq("id", id);
      if (e) throw e;
      const acessos = Object.entries(pedido.acessos ?? {}).map(([permissao, permitido]) => ({
        usuario_id: id, permissao, permitido,
      }));
      if (acessos.length) {
        const { error: ea } = await admin.from("permissoes_usuario").upsert(acessos);
        if (ea) throw ea;
      }
      await auditar(quem, empresa, "INSERT", id, {
        convite: { antes: null, depois: "enviado" }, papel: { antes: null, depois: pedido.papel },
        ...(acessos.length ? { acessos: { antes: null, depois: pedido.acessos } } : {}),
      });
      return [200, { ok: true, usuario_id: id }];
    }
    case "desativar":
    case "reativar": {
      const ativo = pedido.acao === "reativar";
      const { error } = await admin.from("perfis").update({ ativo }).eq("id", alvo!.id);
      if (error) throw error;
      const { error: e } = await admin.auth.admin.updateUserById(alvo!.id, { ban_duration: ativo ? "none" : BANIDO });
      if (e) throw e;
      await auditar(quem, alvo!.empresa_id, "UPDATE", alvo!.id, { ativo: { antes: alvo!.ativo, depois: ativo } });
      return [200, { ok: true }];
    }
    case "resetar_senha": {
      const { data, error } = await admin.auth.admin.getUserById(alvo!.id);
      if (error || !data.user.email) throw error ?? new Error("sem e-mail");
      const publico = createClient(SUPABASE_URL, ANON, sem);
      const { error: e } = await publico.auth.resetPasswordForEmail(data.user.email, {
        redirectTo: `${SITE}/redefinir-senha`,
      });
      if (e) throw e;
      await auditar(quem, alvo!.empresa_id, "UPDATE", alvo!.id, { senha: { antes: null, depois: "link de redefinição enviado" } });
      return [200, { ok: true }];
    }
    case "alterar_papel": {
      const { error } = await admin.from("perfis").update({ papel: pedido.papel }).eq("id", alvo!.id);
      if (error) throw error;
      await auditar(quem, alvo!.empresa_id, "UPDATE", alvo!.id, { papel: { antes: alvo!.papel, depois: pedido.papel } });
      return [200, { ok: true }];
    }
  }
}

Deno.serve(async (req) => {
  const origem = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cabecalhos(origem) });
  if (origem && !ORIGENS.includes(origem)) return responder({ erro: "origem não permitida" }, 403, origem);
  if (req.method !== "POST") return responder({ erro: "método não permitido" }, 405, origem);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return responder({ erro: "faça login" }, 401, origem);
  const { data: sessao, error: eLogin } = await admin.auth.getUser(token);
  if (eLogin || !sessao?.user) return responder({ erro: "login expirado" }, 401, origem);

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return responder({ erro: "pedido inválido" }, 400, origem);
  }
  const { pedido, erro } = validarPedido(corpo);
  if (!pedido) return responder({ erro }, 400, origem);

  const campos = "id, papel, ativo, empresa_id, equipe";
  const { data: quem } = await admin.from("perfis").select(campos).eq("id", sessao.user.id).maybeSingle();
  // a permissão vem do banco, com o login de quem pede (padrão MotorCob + ajuste do Admin da empresa)
  const comoUsuario = createClient(SUPABASE_URL, ANON, { ...sem, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: pode } = await comoUsuario.rpc("pode", { perm: "gerenciar_usuarios" });
  let alvo: Perfil | null = null;
  if (pedido.usuario_id) {
    const { data } = await admin.from("perfis").select(campos).eq("id", pedido.usuario_id).maybeSingle();
    alvo = (data as Perfil | null) ?? null;
  }
  const negado = autorizar(quem as Perfil | null, pode === true, pedido, alvo);
  if (negado) return responder({ erro: negado }, negado === "usuário não encontrado" ? 404 : 403, origem);

  try {
    const [status, resultado] = await executar(quem as Perfil, pedido, alvo);
    return responder(resultado, status, origem);
  } catch (e) {
    console.error(pedido.acao, (e as { code?: string })?.code ?? "erro"); // sem dado pessoal no log
    return responder({ erro: "não foi possível concluir; tente de novo" }, 500, origem);
  }
});
