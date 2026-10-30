# Prompt Horizons — 90: Estratégia › Discagem (regras de discagem e renitência da carteira)

UX, 30/10/2026. RODE DEPOIS DO SQL 51 (credores.discagem) E DO MERGE DO PR 128 (branch claude/discagem-credor:
sincronizar passa credores.discagem ao motor e grava execucoes.resumo.discagem). Protótipo aprovado:
scratchpad/ux/discagem-prototipo.html (depois das decisões do dono). Motor: motor/discagem.py (PR 125).
Princípio do dono: a ferramenta informa, sugere e alerta; quem decide e configura é o cliente.

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Grave só em credores.discagem (jsonb objeto) da carteira
do contexto, com a RLS de hoje (quem tem editar_credores na matriz de permissões, pode(); os outros só
veem). Leia execucoes.resumo e execucoes.alertas da última execução da carteira. Nada de CPF, nome de
devedor nem telefone na tela.

## 0. Onde fica e como grava
- Estratégia ganha a subaba "Discagem" (rota nova /discagem), depois de Frases. Carteira do contexto no topo.
- Grave SÓ as chaves que o cliente mudou; chave AUSENTE = sugestão do MotorCX. Nunca grave null: o motor
  transforma null em alerta DISCAGEM diário. "Voltar à sugestão" APAGA a chave. Única exceção:
  tentativas_cliente_dia aceita null ou "" (= o valor da estratégia). Botão "Salvar" (com "Alterações não
  salvas"); toast "Salvo. Vale na próxima lista do dia." Nunca grave {} por cima de um bloco que já existe
  sem o cliente pedir.
- Sugestões do MotorCX (mostre ao lado de cada campo como "sugestão: …"): tentativas_numero_dia 2;
  tentativas_cliente_dia vazio (= as tentativas por dia da estratégia); intervalo_min_minutos 120;
  intervalo_ocupado_minutos 15; descanso_nao_atende {ativo false, n 6, em_dias 3, descansa_dias 7};
  descanso_recusa {ativo false, dias 7}; promessa_suspende {ativo false, dias_sem_data 7}; inexistente {ativo
  true}; nao_ligar {ativo true}; horarios {ativo false, tabela null}; chamadas_curtas {ativo true, aviso 0.75,
  corte_ativo false, corte 0.80, max_por_numero_dia 900, max_total_dia 9000, abandono_conta true, segundos 6}.
- A trava "ligacoes" da estratégia (motor/travas.py; só quando ligada, na Cobrança, por estratégia) vence SÓ
  nos campos que ela define: por_dia → tentativas_cliente_dia; por_numero → tentativas_numero_dia;
  intervalo_min → intervalo_min_minutos; intervalo_ocupado → intervalo_ocupado_minutos. Avise por campo:
  "Nas estratégias <nomes> vale a trava (<valor>)." (leia as estratégias usadas pelos segmentos da carteira).

## 1. Abas internas: Chamadas curtas (abre aqui) · Renitência · Horários · Resultado do dia
## 2. Chamadas curtas (MP 1.396/2026)
- Caixa azul fixa: "O acompanhamento da regra e as medidas são responsabilidade da sua operação; o MotorCX
  mostra os números e avisa. A regra ainda depende de regulamentação da Anatel."
- Medidor do último dia medido (resumo.discagem.chamadas_curtas.medido, último item: chamadas, curtas,
  fracao) e a previsão de hoje (previsao: chamadas, curtas, fracao), com marcas: seu aviso, corte (se ligado)
  e "MP 85%". Lista dos 7 dias medidos. "A lista de hoje precisa de pelo menos <linhas_minimas> linha(s) de
  saída" (o MotorCX não sabe por qual linha o discador liga). Com chamadas_curtas.ativo false, previsao vem
  null e linhas_minimas não vem: mostre só o medido, sem quebrar.
- Seus limites: ativo (monitorar), aviso (% de 1 a 100 na tela; grave a FRAÇÃO valor/100, de 0.01 a 1;
  sugestão 75%), max_por_numero_dia, max_total_dia,
  segundos (1–60; até quantos segundos conta como curta), abandono_conta (sim/não). Aviso ≥ 85%: dica "o
  aviso chega junto ou depois da referência da MP". Nada é travado no limite da lei.
- Corte OPCIONAL, desligado: chave "Cortar a voz pelo fim da prioridade ao passar de <corte>%" (corte_ativo;
  corte também de 1 a 100% na tela, gravado como fração de 0.01 a 1). Ligado, mostre "<cortados> clientes
  saíram da voz hoje" (chamadas_curtas.cortados) e previsao_depois.
- Alertas do dia (execucoes.alertas), um bloco por prefixo: "CHAMADAS CURTAS", "DISCAGEM", "HORÁRIO POR
  UF/DDD:" e "RENITÊNCIA:" (os dois últimos aparecem também nas abas Horários e Renitência).

## 3. Renitência (cada regra: chave liga/desliga, campos, texto curto, "sugestão")
- Tentativas no dia: por número (1–10) e por cliente (1–10; vazio = as da estratégia).
- Intervalo mínimo entre tentativas (0–1440 min) e depois de ocupado (0–1440 min).
- Descanso depois de vários "não atende": N (1–50) em até X dias (1–60) → descansa Y dias (1–365).
- Recusa: descanso da voz por N dias (1–365). Promessa: voz suspensa até a data prometida + 1; sem data,
  N dias (1–90). Texto: "Promessa é CPC, não é pagamento."
- Bloqueio de número inexistente (recomendado ligado) e lista "não ligar" (recomendado ligado): podem ser
  desligados; ao desligar, confirmação "Recomendamos manter ligado. Desligar mesmo assim?".
- Nenhuma regra impede salvar.

## 4. Horários por UF/DDD (desligado por padrão)
- Chave "Usar janela por UF/DDD" (horarios.ativo). Caixa âmbar fixa: "Referência inicial, não é orientação
  jurídica. Confirme com o seu jurídico e ajuste: a responsabilidade pelos horários é da sua operação."
- Tabela editável (hora LOCAL da UF; o motor converte pelo fuso; domingo e feriado nacional nunca; a faixa
  08:00–20:00 de Brasília vale por cima). Começa com a PRÉVIA MotorCX (constante na tela; seg–sex / sábado):
  SP 08:00–19:50 / 08:00–13:50 · RJ 09:00–18:50 / não · MG 08:00–19:50 / não · RS, ES, CE 08:00–18:50 / não ·
  PR 08:00–18:50 / 08:00–12:50 · DF, PA 08:00–17:50 / 08:00–13:50 · GO 08:00–17:50 / 08:00–12:50 ·
  PE 08:00–18:50 / 08:00–14:50 · PI 08:00–18:50 / 08:00–13:50 · AL 08:00–19:50 / 08:00–13:50 ·
  AM 08:00–17:50 / 08:00–13:50 · MT, MS, RO, RR 08:00–19:50 / 09:00–14:50 · AC 08:00–18:50 / 09:00–13:50 ·
  BA, MA, PB, SC, SE, TO, AP 07:00–20:50 / 09:00–15:50 · RN 08:00–18:50 / não (a confirmar) ·
  DDD 48 (Florianópolis) 08:00–18:50 / 08:00–13:50 · DDD 84 (Natal) 08:00–18:50 / não.
  Fonte: Portal ContraPonto, 28/01/2026.
- A tabela do cliente NÃO substitui a prévia: o motor junta linha a linha, nesta ordem: DDD do cliente > UF
  do cliente > DDD da prévia > UF da prévia. "DDD vence UF" vale dentro de cada tabela.
- Linha: UF ou DDD, seg–sex de/até, sábado de/até, marcador "prévia MotorCX" ou "ajustado por vocês".
  Linha da prévia: editar horas ou "não liga neste período" (seg_sex ou sabado = null); sem remover.
  "Remover linha" só nas linhas que o cliente acrescentou. "Restaurar a prévia" apaga os ajustes.
- "Acrescentar UF" (as 27 UFs) e "Acrescentar DDD" (só DDDs válidos do motor: 11–19, 21, 22, 24, 27, 28,
  31–35, 37, 38, 41–49, 51, 53–55, 61–69, 71, 73–75, 77, 79, 81–89, 91–99; outro DDD o motor ignora com
  alerta).
- Ao ajustar uma UF que tem DDD na prévia (SC → 48, RN → 84), avise: "A sua linha de SC vence a linha do DDD
  48 da prévia" e ofereça "Copiar também para o DDD 48".
- Gravação: grave horarios.ativo e, só se houver ajuste, horarios.tabela com APENAS as linhas mudadas ou
  acrescentadas, cada uma COMPLETA (sempre seg_sex e sabado, mesmo que só um tenha mudado; sem seg_sex o
  motor descarta a linha): {"hora":"local","ufs":{"SC":{"seg_sex":["08:00","18:50"],"sabado":null}},"ddds":{…}}.

## 5. Resultado do dia (só leitura, da última execução)
renitencia (clientes com voz suspensa hoje: recusa, promessa, nao_ligar), horario_fora_por_uf (números fora
da janela hoje, por UF), regras_desligadas e mailing (linhas do discador_mailing). Sem execução, ou com
resumo.discagem null (execuções antigas): "Sem execução: aparece depois da próxima lista do dia."

Aceite: abrir /discagem mostra a carteira do contexto com as sugestões; mudar um valor grava só essa chave em
credores.discagem e "Voltar à sugestão" remove a chave; horários começam desligados com o aviso e, ligados,
gravam ativo (e a tabela só se houver ajuste); o corte de curtas começa desligado; o medidor lê
execucoes.resumo.discagem; Operação vê tudo sem gravar. Confira em 1440 e 390 px, claro e escuro.
```
