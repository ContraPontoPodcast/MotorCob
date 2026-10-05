# Prompt do site: detalhe técnico no erro genérico

Só layout. Não precisa de SQL.

---

```text
Hoje, quando uma consulta ao Supabase falha, o site mostra só "Não foi possível concluir a operação.
Tente novamente ou fale com o administrador." e o motivo se perde. Mantenha essa frase, mas guarde o
erro original e mostre-o de forma discreta. NÃO crie, altere ou apague tabelas, views, buckets ou
políticas.

1. Onde o site troca o erro do Supabase pela mensagem genérica (função que devolve esse texto,
   usada em todas as páginas), guarde também o erro original: code, message, details e hint, e o nome
   da tabela/view consultada quando houver.
2. Abaixo da mensagem genérica (no aviso vermelho/âmbar da página ou no toast), mostre o link pequeno
   "Detalhe técnico" (text-xs text-slate-400). Ao clicar, abre um bloco recolhível com fonte mono:
   "código: 57014 · consulta: fluxo_esteira · canceling statement due to statement timeout"
   e o botão "Copiar detalhe" (copia o texto, com a página e a data/hora).
3. Nunca mostre chave, token, e-mail ou dado de cliente no detalhe; só código, mensagem do banco e o
   nome da tabela/view.
4. Erro 57014 (tempo esgotado): além do detalhe, troque a frase por "A consulta demorou demais.
   Tente de novo em alguns segundos; se repetir, copie o detalhe técnico e envie ao suporte."
```
