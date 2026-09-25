# Certificação de Contato para Cobrança

Motor que roda **antes de qualquer disparo em massa** e responde, por CPF:
qual contato é do cliente, em qual canal ele engaja e em que ordem acionar — com o
funil projetado (acionados → contato → CPC) e o custo.

```bash
python demo.py          # carteira sintética de ponta a ponta; gera CSVs em ./saida/
python -m unittest      # testes
```

Sem dependências externas (Python 3.11+). Arquitetura, princípios e roadmap em
[`CLAUDE.md`](CLAUDE.md); modelo de dados em [`db/schema.sql`](db/schema.sql).

## Saídas
| Arquivo | Conteúdo |
|---|---|
| `certificacao_contatos.csv` | status e score de titularidade por contato, com restrições |
| `hit_rate_carteira.csv` | força de contato e custo por canal (base do cold start) |
| `plano_acionamento.csv` | ações por CPF em ordem de valor esperado |
| `bloqueios.csv` | o que não foi disparado e por quê (auditoria) |
