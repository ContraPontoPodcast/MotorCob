# Certificação de Contato para Cobrança

Motor que roda **antes de qualquer disparo em massa** e responde, por cliente (`id_cliente` do sistema de cobrança):
qual contato é do cliente, em qual canal ele engaja e em que ordem acionar — com o
funil projetado (acionados → contato → CPC) e o custo.

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

A carteira é um CSV `id_cliente;contato;tipo;origem;cpf` — `origem` e `cpf` são opcionais;
o CPF só agrupa IDs da mesma pessoa e não aparece em nenhuma saída.

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
