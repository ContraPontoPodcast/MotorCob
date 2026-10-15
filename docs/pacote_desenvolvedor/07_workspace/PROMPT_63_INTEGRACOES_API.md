# Prompt Horizons — 63: Empresa › Integrações (tokens de API) e Console › Integrações (substitui o item 1 do prompt 19)

Rode depois do SQL 41 e da função `api` nova. Protótipo aprovado em 15/10/2026: `docs/homologacao/tokens-api-prototipo.html`.

```text
NÃO crie, altere ou apague tabelas, views ou políticas. O token inteiro só existe na tela que o criou.

## 1. Lugar
"Tokens de API" sai de Minha conta (deixe lá só o link "Os tokens agora ficam em Empresa › Integrações") e vira
Empresa › Integrações › API (/empresa/integracoes). Sem o módulo api: o card atual "Quero ser avisado". Sem
pode('gerenciar_api'): "Quem cuida dos tokens é o Admin da sua empresa." Com os dois, a tela abaixo.

## 2. Lista
from('api_tokens').select('id,nome,prefixo,escopos,credor_ids,ips,criado_por,criado_em,expira_em,ultimo_uso,
revogado_em,revogado_motivo,substitui_id,substituido_por') + rpc uso_tokens_api(empresa, 7).
Colunas: Nome (e "criado por {nome}") · Token ("mc_1a2b3c4d…") · Pode (em palavras: cargas:enviar "Enviar cargas",
cargas:status "Acompanhar cargas", lista:ler "Ler a Lista do dia", jornada:enviar "Enviar cargas da Jornada" + as
carteiras ou "Todas as carteiras" + "só de {n} faixas de IP") · Uso · 7 dias ("{chamadas} chamadas · {erros} erros"
em vermelho; "nunca usado") · Vence (âmbar com 15 dias ou menos) · Situação: Ativo · Saindo (substituido_por
preenchido: "para em {dias}"; ação "Parar agora" = revogar_token_api) · Vencido · Revogado (com o motivo, se veio da
MotorCob). Ações: Uso · Trocar · Revogar (confirmação do prompt 49: "O sistema que usa este token para de funcionar
na hora.").
Faixa âmbar no topo para o token que vence primeiro em até 15 dias: "{nome} vence em {n} dias. Troque antes para
o sistema não parar." + "Trocar agora". No celular, cada token vira cartão.

## 3. Criar token (PainelEdicao)
Nome* (2 a 60); "O que pode" em dois grupos com explicação: Cobrança (Enviar cargas · Acompanhar cargas · Ler a
Lista do dia) e Jornada (Enviar cargas da Jornada: clientes, contatos e leads) — só mostre o grupo da frente que a
empresa tem; Carteiras (multisseleção; vazio = todas); Validade 30 · 90 · 180 · 365 (padrão 90); "Só destes
endereços IP (opcional)": faixas uma por linha (ex.: 200.155.10.0/24), até 20. Resumo antes de criar →
rpc criar_token_api(empresa, nome, escopos, credores|null, dias, ips|null). Depois: o token numa caixa mono com
"Copiar" e "Por segurança, ele não aparece de novo."; "Primeira chamada": o curl com a carteira escolhida e o
endereço https://api.motorcob.online/v1/... (enquanto o domínio não estiver no ar, use o endereço do Supabase);
botão "Testar agora" → fetch GET {endereço}/v1/teste com o token → mostre "Funcionou: {empresa} · {pode} ·
{carteiras}" ou o erro devolvido. "Já copiei" apaga o token da memória da tela.

## 4. Trocar token
"O antigo continua valendo por" 1 · 7 · 14 dias (padrão 7) → rpc trocar_token_api(token_id, convivencia) → mostra
o token novo como no item 3. Texto: "Mesmo nome, permissões, carteiras e IPs. Depois de colar o novo, veja em Uso se
o antigo parou de ser chamado e use Parar agora."

## 5. Uso e erros (/empresa/integracoes/{id})
Cartões: Chamadas · 7 dias, Deram certo (%), Erros, Último uso (com o IP). Barras por dia: rpc uso_token_api_dias(token,
7). "Últimos erros": from('api_registros') status >= 400, 20 mais recentes: Quando · Chamada (método, rota, carteira)
· Código · O que fazer (400 "confira os parâmetros: {motivo}" · 401 "token vencido ou revogado: troque o token" ·
403 "{motivo}" · 404 "{motivo}" · 409 "mude a carteira para API em Como a carga chega" · 413 "arquivo acima de 20 MB:
divida em partes" · 429 "mais de 60 chamadas no minuto: espere 60 s" · 500 "falha nossa; tente de novo"). Nota:
"Guardamos método, rota, carteira, código e IP por 90 dias; nunca o arquivo."

## 6. Console › Integrações (equipe)
rpc tokens_console(): Empresa · Tokens ativos · Chamadas 7 dias · Erros · Vence primeiro; linha com muitos 401
(recusados_401_7d > 50) em destaque "O sistema desta empresa parou". "Ver" abre a lista do item 2 da empresa (sem o
token). Só o Master vê "Revogar (incidente de segurança)" com campo Motivo obrigatório → revogar_token_api(id,
motivo); texto "A empresa recebe o aviso no sino e a revogação fica na Auditoria."

Confira em 1440 e 390 px, claro e escuro.
```
