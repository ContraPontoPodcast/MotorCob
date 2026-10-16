// Edge Function api: o sistema do cliente envia cargas (Cobrança e Jornada) e lê a Lista do dia com um token de API.
// Publicar com "Verify JWT" DESLIGADO (o token é nosso, não é login do Supabase). Tudo passa por regras.ts
// e entra pelo mesmo caminho do site: arquivo no bucket "entradas" + linha em "envios" (o motor processa).
// Cada chamada com token reconhecido fica em api_registros (rota sem parâmetros, carteira, código e IP; nunca o
// arquivo), para a tela "Uso e erros" (SQL 41). A chave service_role vem só do ambiente do servidor.
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  escopoDaCarga, hojeSP, ipDaRequisicao, ipPermitido, LIMITE_MINUTO, rota, rotaRegistro, semAcesso, sha256Hex,
  TAMANHO_MAX, type Token, tokenDoCabecalho, tokenInvalido, validarCarga, validarLista,
} from "./regras.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } });

const DOC = "https://motorcob.online/docs/api";
// api.motorcob.online passa por um proxy (docs/pacote_desenvolvedor/08_api/DOMINIO_API.md) que manda o IP original
// com este segredo; sem o Secret, vale o IP que o Supabase vê.
const PROXY = Deno.env.get("API_PROXY_SEGREDO") ?? "";
const cab = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (corpo: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cab, "Content-Type": "application/json; charset=utf-8", ...extra } });
const erro = (texto: string, status: number, extra: Record<string, string> = {}) =>
  json({ erro: texto, documentacao: DOC }, status, extra);

interface Credor { id: number; codigo: string; nome: string; ativo: boolean; entrada_carga: string; frente: string }
async function credorDa(empresa: number, codigo: string) {
  const { data } = await admin.from("credores").select("id, codigo, nome, ativo, entrada_carga, frente")
    .eq("empresa_id", empresa).eq("codigo", codigo).maybeSingle();
  return data as Credor | null;
}

// o que vai para o registro de uso da chamada
interface Registro { carteira?: string; motivo?: string }

async function atender(req: Request, t: Token, url: URL, reg: Registro): Promise<Response> {
  const r = rota(req.method, url.pathname)!;
  const ip = ipDaRequisicao(req.headers, PROXY);
  if (!ipPermitido(ip, t.ips)) {
    reg.motivo = "IP fora das faixas do token";
    return erro(`este endereço IP (${ip ?? "desconhecido"}) não está liberado para o token`, 403);
  }
  const { data: n } = await admin.rpc("contar_chamada_api", { token: t.id });
  if ((n as number) > LIMITE_MINUTO) {
    reg.motivo = "limite por minuto";
    return erro(`limite de ${LIMITE_MINUTO} chamadas por minuto`, 429, { "Retry-After": "60" });
  }
  const { data: emp } = await admin.from("empresas").select("id, slug, nome, ativa, situacao").eq("id", t.empresa_id).single();
  if (!emp?.ativa || ["suspensa", "encerrada", "inadimplente"].includes(emp.situacao)) {
    reg.motivo = "empresa sem acesso";
    return erro("empresa sem acesso à API", 403);
  }
  const { data: mod } = await admin.from("empresa_modulos").select("ativo").eq("empresa_id", emp.id).eq("modulo", "api").maybeSingle();
  if (!mod?.ativo) {
    reg.motivo = "módulo API desligado";
    return erro("o módulo API não está ativo nesta empresa", 403);
  }

  if (r.nome === "teste") {
    // confere o token sem mexer em nada: empresa, o que ele pode, carteiras e quando vence
    let q = admin.from("credores").select("codigo, nome, frente").eq("empresa_id", emp.id).eq("ativo", true);
    if (t.credor_ids) q = q.in("id", t.credor_ids);
    const { data: cs } = await q.order("nome");
    return json({ ok: true, empresa: emp.nome, token: t.prefixo, pode: t.escopos, carteiras: cs ?? [],
                  vence_em: t.expira_em, ip });
  }

  if (r.nome === "enviar_carga") {
    const declarado = Number(req.headers.get("Content-Length") ?? "0");
    if (declarado > TAMANHO_MAX) {
      reg.motivo = "arquivo acima de 20 MB";
      return erro("arquivo acima de 20 MB: divida em partes", 413);
    }
    const corpo = new Uint8Array(await req.arrayBuffer());
    const v = validarCarga(url.searchParams, corpo.byteLength);
    if (v.credor) reg.carteira = v.credor;
    if (v.erro) {
      reg.motivo = v.erro;
      return erro(v.erro, corpo.byteLength > TAMANHO_MAX ? 413 : 400);
    }
    const credor = await credorDa(emp.id, v.credor!);
    if (!credor || !credor.ativo) {
      reg.motivo = "carteira não encontrada ou inativa";
      return erro("carteira (credor) não encontrada ou inativa", 404);
    }
    const esc = escopoDaCarga(credor.frente, v.tipo!);
    if (esc.erro) {
      reg.motivo = esc.erro;
      return erro(esc.erro, 400);
    }
    const negado = semAcesso(t, esc.escopo!, credor.id);
    if (negado) {
      reg.motivo = negado;
      return erro(negado, 403);
    }
    if (credor.entrada_carga !== "api") {
      reg.motivo = "carteira recebe por arquivo";
      return erro("esta carteira recebe a carga por arquivo: mude para API em Carteiras › Como a carga chega", 409);
    }
    const caminho = `${emp.slug}/${v.tipo}/${hojeSP()}/${crypto.randomUUID()}_${v.nome}`;
    const tipoArq = v.nome!.endsWith(".xlsx")
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv";
    const { error: eUp } = await admin.storage.from("entradas").upload(caminho, corpo, { contentType: tipoArq });
    if (eUp) throw eUp;
    const { data: envio, error: eIns } = await admin.from("envios").insert({
      empresa_id: emp.id, credor_id: credor.id, tipo: v.tipo, caminho, nome_original: v.nome,
      enviado_por: t.criado_por, status: "pendente",
    }).select("id").single();
    if (eIns) {
      await admin.storage.from("entradas").remove([caminho]);
      throw eIns;
    }
    await admin.from("auditoria").insert({
      empresa_id: emp.id, usuario: t.criado_por, tabela: "envios", acao: "INSERT", registro: String(envio.id),
      mudou: { via: { antes: null, depois: `API · token ${t.prefixo}` }, tipo: { antes: null, depois: v.tipo } },
    });
    return json({ envio_id: envio.id, situacao: "pendente", acompanhar: `/v1/cargas/${envio.id}` }, 202);
  }

  if (r.nome === "status_carga") {
    const { data: e } = await admin.from("envios")
      .select("id, tipo, credor_id, status, enviado_em, nome_original, relatorio")
      .eq("id", r.id).eq("empresa_id", emp.id).maybeSingle();
    if (!e) {
      reg.motivo = "envio não encontrado";
      return erro("envio não encontrado", 404);
    }
    const negado = semAcesso(t, "cargas:status", e.credor_id ?? undefined);
    if (negado) {
      reg.motivo = negado;
      return erro(negado, 403);
    }
    return json({ id: e.id, tipo: e.tipo, arquivo: e.nome_original, situacao: e.status, enviado_em: e.enviado_em,
                  relatorio: e.relatorio ?? null });
  }

  // lista do dia: o mesmo arquivo por canal que o site baixa (ID do cliente e contato a acionar)
  const v = validarLista(url.searchParams, hojeSP());
  if (v.credor) reg.carteira = v.credor;
  if (v.erro) {
    reg.motivo = v.erro;
    return erro(v.erro, 400);
  }
  const credor = await credorDa(emp.id, v.credor!);
  if (!credor) {
    reg.motivo = "carteira não encontrada";
    return erro("carteira (credor) não encontrada", 404);
  }
  const negado = semAcesso(t, "lista:ler", credor.id);
  if (negado) {
    reg.motivo = negado;
    return erro(negado, 403);
  }
  const caminho = `${emp.slug}/${v.data}/${credor.codigo}/ids/${v.canal}.csv`;
  const { data: arq, error: eArq } = await admin.storage.from("saidas").download(caminho);
  if (eArq || !arq) {
    reg.motivo = "lista ainda não gerada";
    return erro("lista ainda não gerada para este dia, carteira e canal", 404);
  }
  await admin.from("acessos").insert({ usuario: t.criado_por, acao: "download", alvo: `API ${t.prefixo}: ${caminho}` });
  return new Response(arq, { status: 200, headers: { ...cab, "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${v.credor}_${v.data}_${v.canal}.csv"` } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const r = rota(req.method, url.pathname);
  if (!r) return erro("rota não encontrada: POST /v1/cargas · GET /v1/cargas/{id} · GET /v1/lista-do-dia · GET /v1/teste", 404);
  const bruto = tokenDoCabecalho(req.headers.get("Authorization"));
  if (!bruto) return erro("envie o token no cabeçalho Authorization: Bearer mc_...", 401);
  const { data: tok } = await admin.from("api_tokens")
    .select("id, empresa_id, prefixo, escopos, credor_ids, criado_por, expira_em, revogado_em, ips")
    .eq("hash", await sha256Hex(bruto)).maybeSingle();
  const reg: Registro = {};
  let resp: Response;
  const invalido = tokenInvalido(tok as Token | null, new Date());
  if (invalido) {
    if (!tok) return erro(invalido, 401);         // token desconhecido: não há de quem registrar
    reg.motivo = invalido;
    resp = erro(invalido, 401);
  } else {
    try {
      resp = await atender(req, tok as Token, url, reg);
    } catch (e) {
      console.error(r.nome, (e as { code?: string })?.code ?? "erro"); // sem dado pessoal no log
      reg.motivo = "erro interno";
      resp = erro("não foi possível concluir; tente de novo", 500);
    }
  }
  try {   // uso e erros por token; nunca derruba a resposta
    await admin.rpc("registrar_chamada_api", { token: (tok as Token).id, metodo: req.method, rota: rotaRegistro(r),
      carteira: reg.carteira ?? null, status: resp.status, ip: ipDaRequisicao(req.headers, PROXY), motivo: reg.motivo ?? null });
  } catch { /* registro é melhor esforço */ }
  return resp;
});
