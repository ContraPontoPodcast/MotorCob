# Certificação de Contato para Cobrança

## O problema
Empresas de cobrança disparam de forma pulverizada (discador, agente de voz, SMS, RCS,
WhatsApp, e-mail), tudo de uma vez e sem identificador, e não conseguem taguear o
retorno. Sem tag, não sabem qual contato é do cliente, em qual canal ele engaja nem qual
comunicação funciona — e a operação não é previsível (acionados → contato → CPC → conversão).

## O que o produto faz
Uma camada que fica ANTES de qualquer disparo em massa e responde, por cliente:
1. **Contato certo**: qual telefone ou e-mail é de fato do cliente (certificação).
2. **Canal certo**: em qual canal esse cliente engaja (afinidade).
3. **Comunicação certa**: qual abordagem gerou engajamento ou conversão (fase 3).

Cliente novo sem histórico (cold start) usa o hit rate da carteira por canal como prior
e é priorizado por valor esperado, que já desconta o custo de cada tentativa.

## Princípios de arquitetura (não violar)
- **O núcleo é determinístico e estatístico.** Score, certificação e priorização por
  registro NUNCA passam por LLM. Motivos: escala (milhões de registros), custo e auditoria.
- **Agentes atuam na borda:** mapear layouts novos de fornecedor, analisar resultados,
  montar estratégia/régua e validar compliance. Eles leem as saídas do motor.
- **Engajamento ≠ titularidade.** "Lido" no WhatsApp prova que alguém leu, não que é o
  cliente. Só CPC, identidade confirmada ou acesso autenticado ao portal certificam.
- **Engajamento ≠ contato efetivo no valor esperado.** A priorização usa
  P(titular) × P(certifica | titular, canal), não P(engaja).
- **WhatsApp só para contato CERTIFICADO** ou com score ≥ `LIMIAR_WHATSAPP` (banimento).
- **`sem_conta` no WhatsApp restringe o canal, não invalida o telefone** (e expira em 90 dias).
- **O motor roda pelo `id_cliente`** (ID do sistema de cobrança, opaco), nunca pelo CPF.
  Fornecedores recebem e devolvem só o ID. O CPF é opcional na carteira e serve apenas
  para agrupar IDs da mesma pessoa: vira chave pseudônima em memória e não vai para
  nenhuma saída.
- **Contato certificado para uma pessoa é evidência contra as outras pessoas** que o têm
  e a favor dos outros IDs da mesma pessoa.
- **Retorno reimportado não conta duas vezes** (dedup por fornecedor + id_externo).
- Toda evidência decai no tempo (meia-vida de 90 dias).
- Resultado que a taxonomia não conhece gera erro (`ResultadoDesconhecido`), nunca é
  classificado por palpite.

## Estrutura
- `motor/normalizacao.py`: ID do cliente, CPF opcional (com DV), telefone e e-mail na forma canônica — o mesmo
  contato escrito de dois jeitos não pode virar dois contatos.
- `motor/ingestao.py`: arquivo de retorno + layout → eventos. Código sem de-para vai para
  a **quarentena** (nunca é classificado por palpite); ID/contato/data inválidos são
  rejeitados com motivo; reexportação é deduplicada; arquivo sem layout não é processado.
- `layouts/*.json`: um layout declarativo por fornecedor (colunas, formato de data,
  separador decimal, de-para de códigos → taxonomia). Fornecedor novo = JSON novo. O
  layout é validado na carga: de-para para resultado fora da taxonomia é recusado.
- `motor/rastreio.py`: link rastreável por ação. Token = HMAC(segredo, campanha|cliente|
  contato|canal): sem dado pessoal, não adivinhável, idempotente. O log do portal
  (token;evento;ocorrido_em;valor_acordo) vira evidência no contato/canal exatos:
  clique = engajamento, login autenticado = CERTIFICA, acordo = conversão atribuída.
  Token desconhecido é descartado. Portal certifica, mas não entra no hit rate (não é
  tentativa de contato).
- `disparar.py`: plano → mailing por canal com link + registro de ações (`acoes/`,
  fora do git: tem contato real). Exige `MOTORCOB_SEGREDO`.
- `rodar.py`: pipeline de produção do MVP (retornos + carteira [+ ações + log do
  portal] → plano, funil, quarentena, conversões e atribuição por canal).
- `exemplos/gerar_retornos.py`: gera arquivos simulados de 6 fornecedores fictícios, com
  a bagunça real (formatos diferentes, códigos novos, linhas sem ID, duplicatas), mais
  uma campanha pulverizada rastreada para os clientes novos e o log do portal.
- `motor/taxonomia.py`: retorno bruto de cada canal → `Nivel` (INVALIDO, SEM_RETORNO,
  ENTREGUE, ENGAJADO, CERTIFICADO) + pesos de evidência + restrições. Fornecedor novo entra aqui.
- `motor/certificacao.py`: score Beta por contato, status, hit rate por canal e afinidade
  (P(engaja) e P(certifica | titular), com correção do viés de seleção).
- `motor/priorizacao.py`: plano pré-disparo, bloqueios com motivo e funil projetado.
- `demo.py`: carteira sintética com verdade conhecida; mede acerto da certificação,
  trava do WhatsApp e projetado x realizado.
- `db/schema.sql`: modelo alvo em Postgres.
- `tests/`: testes dos princípios acima.

## Status (CERTIFICADO → DESCONHECIDO)
CERTIFICADO (certificação + score ≥ 0,7) · PROVAVEL (≥ 0,6) · NAO_CONFIRMADO ·
CONTESTADO (< 0,2: evidência de que é de outra pessoa) · INVALIDO · DESCONHECIDO (sem evento).

## Roadmap
1. **MVP (feito):** arquivos exportados → eventos → certificação → plano priorizado + funil.
2. **Ingestão real:** (a) arquivos de retorno por layout declarativo — **feito** com
   layouts simulados; falta validar com arquivos reais; (b) webhook/API; (c) ID de
   campanha e link único rastreável em toda ação — **feito** (`rastreio.py`); falta o
   redirecionador do portal gravar o log no formato esperado.
3. **Conversão:** ligar acordo/pagamento (operador e portal) à ação que o originou —
   portal **feito** via token; falta o acordo pelo operador;
   medir conversão por contato, canal e mensagem.
4. **Camada de agentes:** Ingestão, Analista, Estrategista, Validador (LGPD, horários,
   opt-out, frequência, risco de ban).
5. **Calibração:** pesos, limiares e prior com dados reais de carteira.

## Pontos em aberto para calibrar com dados reais
- Pesos de evidência (`taxonomia.py`) e limiares de status.
- Prior de titularidade por origem do contato (hoje fixo em 0,4).
- Valor do contato efetivo por carteira (hoje R$ 8).
- Funil projetado sai ~10–20% conservador no CPC na carteira simulada.

## Convenções
Python 3.11+, sem dependências no núcleo. Nomes de domínio em português.
Nenhum dado pessoal real no repositório: exemplos e testes usam IDs e CPFs fictícios.
Carteira: `id_cliente;contato;tipo;origem;cpf` (separador `;`, `origem` e `cpf` opcionais).
- Demo (carteira sintética com verdade conhecida): `python demo.py`
- Pipeline com arquivos: `python exemplos/gerar_retornos.py` e depois
  `python rodar.py --retornos exemplos/retornos --carteira exemplos/carteira_contatos.csv \
   --acoes exemplos/acoes.csv --portal exemplos/portal/acessos_2026-09.csv`
- Disparo: `MOTORCOB_SEGREDO=... python disparar.py --plano saida/plano_acionamento.csv \
   --campanha X --mensagem Y --base-url https://...`
- Testes: `python -m unittest`
