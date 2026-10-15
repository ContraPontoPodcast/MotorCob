# api.motorcob.online — como colocar a API no domínio da MotorCob

Aprovado em 15/10/2026. Hoje a API responde em `https://jxwppkrkuckfwmphqjva.supabase.co/functions/v1/api/v1/...`
(endereço técnico). O objetivo é responder em `https://api.motorcob.online/v1/...` sem mudar a função: a rota já
aceita os dois caminhos. **Nada disso foi feito ainda**: depende de quem administra o DNS de motorcob.online.

## Opção recomendada: proxy no Cloudflare (Worker)

Vale se o DNS de motorcob.online estiver (ou puder ficar) no Cloudflare. Plano gratuito atende o volume da API.

1. Gere um segredo longo (32+ caracteres aleatórios) e guarde no gerenciador de senhas. Ele **não** vai para o chat,
   o site ou o git.
2. Supabase › Edge Functions › Secrets: crie `API_PROXY_SEGREDO` com esse valor. Sem ele, a função continua usando o
   IP que o Supabase vê (e a restrição por IP passaria a ver o IP do Cloudflare — por isso o segredo).
3. Cloudflare › Workers › Create: cole o código abaixo; em Settings › Variables crie o segredo `API_PROXY_SEGREDO`
   (o mesmo valor) e a variável `DESTINO` = `https://jxwppkrkuckfwmphqjva.supabase.co/functions/v1/api`.
4. Workers › Triggers › Custom Domains: `api.motorcob.online` (o Cloudflare cria o DNS e o certificado).
5. Teste: `curl https://api.motorcob.online/v1/teste -H "Authorization: Bearer mc_..."` deve responder a empresa.
6. Troque o endereço na documentação (/docs/api) e no exemplo do Criar token (prompt 63).

```js
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/v1/")) return new Response('{"erro":"use /v1/..."}', { status: 404 });
    const h = new Headers(req.headers);
    h.set("x-motorcob-proxy", env.API_PROXY_SEGREDO);
    h.set("x-ip-original", req.headers.get("cf-connecting-ip") ?? "");
    h.delete("cookie");
    return fetch(env.DESTINO + url.pathname + url.search,
                 { method: req.method, headers: h, body: req.body, redirect: "manual" });
  },
};
```

## Alternativa: domínio personalizado do Supabase

O Supabase tem um add-on pago de domínio personalizado (confira o preço atual no painel: Project Settings › Custom
Domains). Ele troca o endereço do projeto inteiro (por exemplo `api.motorcob.online/functions/v1/api/v1/...`), então
o caminho continua longo e o login do site também passa a usar o domínio. Por isso a recomendação é o Worker.

## Depois de no ar

- A documentação passa a mostrar só `https://api.motorcob.online`. O endereço antigo continua funcionando (quem já
  integrou não para).
- Se o Worker cair, as integrações param: deixe o endereço antigo anotado para emergência.
