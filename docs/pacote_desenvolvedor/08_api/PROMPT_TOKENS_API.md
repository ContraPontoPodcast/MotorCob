# Prompt Horizons — Tokens de API, página /docs/api e Credores com API

Rode depois do SQL 8 e da função `api` publicada (ver LEIA.md desta pasta). Cole no Horizons e publique:

```text
Três ajustes. Não mude tabelas, views ou políticas.

1. MINHA CONTA › TOKENS DE API (/conta/tokens), no lugar do card "chegam com o módulo API":
- Sem o módulo api ativo na empresa (empresa_modulos modulo 'api' ativo): mantenha o card atual com "Quero ser
  avisado". Sem a permissão gerenciar_api: "Quem cria tokens é o Admin da sua empresa." e nada mais.
- Com os dois: título "Tokens de API", texto "O sistema da sua empresa usa o token para enviar cargas e ler a
  Lista do dia. Guarde-o num cofre de segredos." + link "Ver a documentação da API" (/docs/api).
- Lista: from('api_tokens').select('id,nome,prefixo,escopos,credor_ids,criado_em,expira_em,ultimo_uso,revogado_em')
  .eq('empresa_id', empresa).order('criado_em', {ascending:false}) (o hash não é lido, nem existe para o site).
  Colunas: Nome · Token ("mc_1a2b3c4d…", tabular-nums) · Escopos (pílulas: cargas:enviar "Enviar cargas",
  cargas:status "Acompanhar cargas", lista:ler "Ler a Lista do dia") · Credores ("Todos" ou os nomes) · Criado ·
  Vence (laranja se faltar menos de 15 dias) · Último uso ("nunca") · Situação (Ativo verde, Vencido cinza,
  Revogado vermelho). Ação "Revogar" nos ativos: confirmação na linha ("O sistema que usa este token para de
  funcionar na hora.") → rpc('revogar_token_api', {token_id: id}).
- Botão "Criar token" → modal: Nome* (2 a 60, ex.: "ERP Financeiro"); Escopos* (3 caixas, ao menos uma); Credores
  (multisseleção dos credores da empresa; vazio = todos); Validade (segmentado 30 · 90 · 180 · 365 dias, padrão 90).
  Criar → rpc('criar_token_api', {empresa, nome, escopos, credores: lista ou null, dias}). O retorno é o token
  inteiro: mostre UMA vez numa caixa com fonte monoespaçada, botão "Copiar" e o aviso em laranja "Copie agora:
  por segurança, este token não aparece de novo." Botão "Já copiei" fecha e apaga o token da memória da tela.
  Erros do banco em texto ("limite de 10 tokens ativos: revogue um antes", "o módulo API não está ativo…").

2. PÁGINA /docs/api (Documentação › Integração e API), coluna de 760px, com: Endereço
   "https://jxwppkrkuckfwmphqjva.supabase.co/functions/v1/api"; Autenticação (cabeçalho Authorization: Bearer
   mc_..., token criado em Minha conta); Limite (60 chamadas por minuto); tabela de escopos; e três seções, cada
   uma com um bloco de código com botão Copiar:
   - Enviar carga: POST /v1/cargas?credor=banco-x&tipo=incremental&nome=incremental.csv, corpo = o arquivo
     (CSV, TXT ou XLSX, até 20 MB); tipos geral, incremental, retirada, acordo, baixa, ocorrencia; resposta 202
     { "envio_id": 1234, "situacao": "pendente", "acompanhar": "/v1/cargas/1234" }.
     curl -X POST "$API/v1/cargas?credor=banco-x&tipo=incremental&nome=incremental.csv" -H "Authorization: Bearer
     $TOKEN" -H "Content-Type: text/csv" --data-binary @incremental.csv
   - Acompanhar: GET /v1/cargas/{id} → situacao pendente | aguardando | processado | erro e o relatório.
   - Lista do dia: GET /v1/lista-do-dia?credor=banco-x&canal=sms&data=2026-10-14 → CSV (mesmo do site).
   Tabela de erros: 400 parâmetro inválido · 401 token inválido, revogado ou vencido · 403 sem escopo, credor fora
   do token, módulo desligado · 404 não encontrado · 409 credor recebe por arquivo · 413 acima de 20 MB ·
   429 limite por minuto · 500 tente de novo. Boas práticas: um token por sistema, menor escopo, trocar antes de
   vencer, nunca dado pessoal na URL.

3. CREDORES: com "Como a carga chega" = API, troque o aviso "A API está em preparação…" por "Envie pela API:
   POST /v1/cargas?credor={código do credor}" + link "Ver a documentação" (/docs/api). O código do credor aparece
   ao lado do nome, com botão de copiar.

Sem rolagem lateral em 1440, 1024 e 390px. Foco visível; Esc fecha modais.
```
