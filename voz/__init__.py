"""Telefonia do agente de voz do MotorCX (decisão 20 do dono, 31/10/2026).

O Asterisk do MotorCX (VMs em São Paulo, IP fixo) origina pelos troncos de cada empresa, aplica rota e tech
prefix, grava, lê a causa Q.850, detecta máquina e só então liga o provedor de voz; quando é preciso um humano,
transfere por SIP para o discador do cliente.

  voz/banco.py               leitura das tabelas voz_* (nomes de coluna num lugar só, fáceis de ajustar)
  voz/segredos.py            senhas de tronco pela referência no Secret Manager (nunca do banco)
  voz/tarifacao.py           tipo do número, rota vigente, segundos tarifados e custo da operadora
  voz/asterisk/gerador.py    pjsip.conf e extensions.conf a partir de troncos, rotas e transferências
  voz/orquestrador/          ARI: lote do dia, guarda, concorrência, AMD, provedor, gravação, eventos
  voz/provedores/            interface ProvedorVoz e adaptadores
  voz/fluxo_validador.py     validador do fluxo (SQL 58), cópia fiel de public.fluxo_voz_erros; casos comuns em
                             voz/fluxo_casos.py (rodam aqui e no Postgres) e modelos em voz/fluxo_modelos.py
  voz/importador/            gravações do discador do cliente (SQL 64): envio pelo site, SFTP e HTTPS, manifesto
                             validado, par com a transferência da IA, bucket da empresa e fila do Whisper

Nada aqui é importado pelo motor: o motor só lê os eventos que o orquestrador escreve (CSV de ocorrência com
as colunas de voz que motor/ingestao.py e motor/entrada.py já entendem). Dependências de rede (ARI, GCS,
Secret Manager) são importadas só na hora do uso: os testes rodam só com a biblioteca padrão.
"""
