# MotorCob — Gestão de Contatos para Cobrança

Implementa a gestão de contatos do Playbook de Gestão de Cobrança: mantém a **TAG** de
cada cliente (`S260801-A1-CPB-WA-T2`) e a **trilha** de eventos, gera a **fila do dia** pelas
réguas (localização, CPC/rotação, giro, preventivo, quebra) e decide **em qual contato**
acionar em cada canal, com trava de WhatsApp contra banimento. Regras em
[`CLAUDE.md`](CLAUDE.md) e [`regras/regua.json`](regras/regua.json).

```bash
# Rotina diária (toda manhã): atualiza TAGs e gera a fila do dia
python rodar_dia.py --clientes exemplos/clientes.csv --carteira exemplos/carteira_contatos.csv \
    --retornos exemplos/retornos --parcelas exemplos/parcelas.csv --data 2026-09-25
#   → saida/2026-09-25/fila_do_dia.csv, fila_<canal>.csv, enriquecimento.csv, alertas.txt
#   → estado/estados.json (TAG atual) e estado/trilha.csv (extrato de cada cliente)

# Operação simulada de 45 dias com verdade conhecida e auditoria das regras
python exemplos/simular_operacao.py
```

Outras ferramentas:

```bash
# Pipeline com arquivos de retorno dos fornecedores
python exemplos/gerar_retornos.py      # gera arquivos simulados de 6 fornecedores
python rodar.py --retornos exemplos/retornos --carteira exemplos/carteira_contatos.csv \
    --acoes exemplos/acoes.csv --portal exemplos/portal/acessos_2026-09.csv

# Disparo com link rastreável (o segredo nunca vai para o repositório)
MOTORCOB_SEGREDO=... python disparar.py --plano saida/plano_acionamento.csv \
    --campanha CAMP-2026-10-A --mensagem SMS-V3 --base-url https://portal.exemplo.com.br/r

python demo.py          # validação com carteira sintética de verdade conhecida
python -m unittest      # testes
```

Arquivos de entrada (separador `;`):
- clientes: `id_cliente;data_entrada;saldo;dias_atraso[;bloqueio][;id_contrato]` — vários
  contratos do mesmo cliente são somados;
- carteira: `id_cliente;contato;tipo[;origem;cpf;whatsapp_valido;atualizado_em]` — o CPF só
  agrupa IDs da mesma pessoa e não aparece em nenhuma saída;
- parcelas: `id_cliente;id_acordo;parcela;vencimento;valor;pago_em`.

Para plugar um fornecedor novo, crie `layouts/<fornecedor>.json` (veja os existentes):
colunas do arquivo, formato de data e o de-para dos códigos dele para a taxonomia.
Código que o layout não conhece cai em `saida/quarentena.csv` para mapear.

Sem dependências externas (Python 3.11+). Arquitetura, princípios e roadmap em
[`CLAUDE.md`](CLAUDE.md); modelo de dados em [`db/schema.sql`](db/schema.sql).

## Saídas
| Arquivo | Conteúdo |
|---|---|
| `certificacao_contatos.csv` | status e score de titularidade por contato, com restrições |
| `hit_rate_carteira.csv` | força de contato e custo por canal (base do cold start) |
| `plano_acionamento.csv` | ações por cliente em ordem de valor esperado |
| `bloqueios.csv` | o que não foi disparado e por quê (auditoria) |
| `relatorio_ingestao.csv` | linhas lidas, aceitas, duplicadas e rejeitadas por arquivo |
| `quarentena.csv` | códigos de retorno sem de-para (contato mascarado) |
| `conversoes.csv` | acordos do portal atribuídos à ação (campanha, mensagem, contato, canal) |
| `atribuicao_por_canal.csv` | ações → cliques → logins → acordos → R$, por canal |
| `mailing_<canal>.csv` | (disparar.py) contatos com link único, para subir no fornecedor |

**Como o portal precisa registrar os acessos:** o link `https://…/r/<token>` redireciona
para o portal e grava `token;evento;ocorrido_em;valor_acordo`, com `evento` = `clique`
(abriu o link), `login` (autenticou) ou `acordo` (fechou, com o valor).
