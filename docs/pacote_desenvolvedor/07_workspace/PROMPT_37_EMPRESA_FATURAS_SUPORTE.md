# Prompt Horizons — Workspace 37: quem recebe as faturas e aviso de resposta no Suporte

Rode depois do SQL 29 e, para o e-mail da fatura usar a nova regra, publique de novo a função `cobranca`.

```text
Workspace do cliente (motorcob.online). NÃO crie, altere ou apague tabelas, views ou políticas.

## 1. Empresa › Contatos: "Recebe faturas"
Em cada contato, uma Chave (o mesmo componente do Console: 44×26, verde ligada) "Recebe faturas", gravando
empresa_contatos.recebe_faturas. Na lista, selo "Faturas" nos contatos marcados. No formulário de novo contato,
a chave vem ligada quando o papel escolhido for Financeiro. Texto de ajuda acima da lista: "A fatura (demonstrativo,
boleto e nota) vai por e-mail para todos os contatos com 'Recebe faturas'. Sem nenhum marcado, vai para os de papel
Financeiro." Contato sem e-mail: a chave fica desabilitada com a dica "Cadastre o e-mail".
Empresa › Faturamento: abaixo do título, "As faturas são enviadas para: a@x.com, b@x.com" (os contatos marcados;
se não houver, os de papel Financeiro) com o link "Alterar em Contatos".

## 2. Suporte: aviso de resposta
- No menu do Workspace, item Suporte com contador: rpc atendimento_pendentes() → respostas_novas (bolinha
  vermelha com o número; some quando 0). Atualize ao entrar e a cada 60 s.
- Na lista de chamados: chamado com ultima_de = 'equipe' e (visto_cliente_em nulo ou < ultima_em) em negrito com o
  selo "Nova resposta"; esses ficam no topo.
- Ao abrir um chamado: rpc marcar_chamado_visto({cid}) e atualize o contador.

Confira em 1440 e 390 px.
```
