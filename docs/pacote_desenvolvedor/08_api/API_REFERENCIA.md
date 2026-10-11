# MotorCob · API das cargas (v1)

Para o time de tecnologia do credor ou da assessoria. Com ela, o seu sistema envia a carteira ao MotorCob e lê
a Lista do dia, sem passar pelo site.

**Endereço:** `https://jxwppkrkuckfwmphqjva.supabase.co/functions/v1/api`
**Autenticação:** cabeçalho `Authorization: Bearer mc_...` com um token criado em
*Minha conta › Tokens de API* (o token aparece uma vez só; guarde num cofre de segredos, nunca no código).
**Limite:** 60 chamadas por minuto por token (acima disso: `429` com `Retry-After: 60`).
**Credor:** sempre pelo código que aparece em *Credores* (ex.: `banco-x`). O credor precisa estar com
"Como a carga chega" = **API**.

## Escopos

| Escopo | Permite |
|---|---|
| `cargas:enviar` | `POST /v1/cargas` |
| `cargas:status` | `GET /v1/cargas/{id}` |
| `lista:ler` | `GET /v1/lista-do-dia` |

O token pode ser limitado a alguns credores e vence em até 365 dias.

## Enviar carga — `POST /v1/cargas`

Parâmetros na URL: `credor` (código), `tipo` (`geral`, `incremental`, `retirada`, `acordo`, `baixa` ou
`ocorrencia`) e `nome` (nome do arquivo, `.csv`, `.txt` ou `.xlsx`). O corpo é o arquivo, do mesmo jeito que seria
enviado pelo site (mesmo layout já mapeado). Até 20 MB por chamada.

    curl -X POST "$API/v1/cargas?credor=banco-x&tipo=incremental&nome=incremental_2026-10-14.csv" \
         -H "Authorization: Bearer $TOKEN" -H "Content-Type: text/csv" --data-binary @incremental.csv

Resposta `202`:

    { "envio_id": 1234, "situacao": "pendente", "acompanhar": "/v1/cargas/1234" }

## Acompanhar — `GET /v1/cargas/{id}`

    { "id": 1234, "tipo": "incremental", "arquivo": "incremental_2026-10-14.csv",
      "situacao": "processado", "enviado_em": "2026-10-14T09:02:11Z",
      "relatorio": { "linhas": 5000, "aceitas": 4987, "rejeitadas": 13, "...": "..." } }

`situacao`: `pendente` (na fila) · `aguardando` (layout novo, aguardando o mapeamento no site) · `processado` ·
`erro` (o motivo vem em `relatorio.erro`). O motor costuma processar em até 1 minuto.

## Lista do dia — `GET /v1/lista-do-dia`

Parâmetros: `credor`, `canal` (`whatsapp`, `rcs`, `sms`, `email`, `agente_voz`, `discador`) e `data`
(`AAAA-MM-DD`, padrão: hoje em São Paulo). Devolve o mesmo CSV que o site baixa (`id_cliente;contato` e, quando
houver, a frase ou o template). `404` se a lista ainda não foi gerada.

    curl "$API/v1/lista-do-dia?credor=banco-x&canal=sms" -H "Authorization: Bearer $TOKEN" -o sms.csv

Cada download fica registrado em *Acessos*, com o prefixo do token.

## Erros

Sempre JSON `{ "erro": "texto em português", "documentacao": "..." }`.

| Código | Quando |
|---|---|
| 400 | parâmetro faltando ou inválido |
| 401 | sem token, token inválido, revogado ou vencido |
| 403 | sem o escopo, credor fora do token, módulo API desligado ou empresa suspensa |
| 404 | rota, credor, envio ou lista não encontrados |
| 409 | o credor está configurado para receber carga por arquivo |
| 413 | arquivo acima de 20 MB |
| 429 | mais de 60 chamadas no minuto |
| 500 | falha nossa; tente de novo |

## Boas práticas

- Um token por sistema (ERP, BI…), com o menor escopo possível. Revogue o que não usa.
- Troque o token antes de vencer (crie o novo, troque no sistema, revogue o antigo).
- Nunca mande CPF, nome ou telefone em parâmetro de URL: os dados vão só no arquivo.
