# Prompt Horizons — 65: Console › E-mails do sistema

Rode depois do SQL 42, da função `emails` e do guia `02_supabase_painel/EMAILS_SISTEMA.md`. Protótipo aprovado em
16/10/2026: `docs/homologacao/emails-sistema-prototipo.html` (tela "Console › E-mails do sistema").

```text
NÃO crie, altere ou apague tabelas, views ou políticas. A equipe nunca vê o conteúdo de um e-mail.

## 1. Lugar
Console › E-mails do sistema (/console/emails), item novo no grupo Sistema do menu do Console (prompt 45). Só equipe.

## 2. Painel
Período 7 · 30 · 90 dias → rpc emails_console(dias). Cartões: Enviados (enviados) · Entregues (%: enviados menos
voltaram_definitivo, voltaram_temporario e spam, sobre enviados) · Voltaram ({definitivos} definitivos · {temporários}
temporários, número em vermelho quando > 0) · Marcados como spam (spam; "meta: abaixo de 0,1%") · Não saíram
(nao_sairam, só se > 0, em vermelho: "a conta de envio recusou; veja o motivo abaixo").
"Por tipo" (por_tipo): Tipo (nomes: fatura "Fatura emitida", lembrete_fatura "Lembrete de fatura", acordo
"Acordo registrado", lembrete_parcela "Lembrete de parcela", relatorio "Relatório agendado", teste "Teste", e os
assuntos do sino pelo nome de notificacao_assuntos) · Remetente (remetente + "@{dominio}") · Enviados · Voltaram ·
Não saíram.

## 3. Remetentes e domínio
dominio.verificacao: SPF, DKIM, DMARC como pílulas (ok verde · ausente vermelha · duplicado âmbar "dois registros
SPF: junte em um" · sem_seletor cinza "preencha o seletor DKIM") + "política DMARC: {politica_dmarc}" +
"conferido em {verificado_em}". Abaixo: "A conta de envio do sistema é separada da conta da Mensageria." e o link
para o guia (texto, sem abrir arquivo): "Passo a passo: 02_supabase_painel/EMAILS_SISTEMA.md".

## 4. O que voltou
voltaram (até 100): Quando · Empresa · E-mail (tipo e titulo) · Situação (voltou_definitivo "definitivo" vermelho ·
voltou_temporario "temporário" âmbar · spam · erro "não saiu") · Motivo. Coluna "Endereço" só aparece quando vier
preenchida (só o Master recebe, e mascarada: c***@alfa…).

## 5. Configurações (só o Master; os demais veem em leitura)
from('email_config').select('*') → PainelEdicao com resumo antes de salvar → rpc salvar_email_config(jsonb só com os
campos mudados): Domínio dos remetentes · Rodapé: Razão social · CNPJ · Endereço · E-mails da equipe: Suporte
(chamados) · Comercial (contato do site) · Financeiro (empresa sem contato de fatura) · Seletor DKIM.
Faixa âmbar enquanto faltar rodapé (rodape_completo false): "Os e-mails saem sem razão social, CNPJ e endereço."
e enquanto faltar e-mail da equipe (equipe_completa false): "Chamados e contatos do site não chegam por e-mail."

## 6. Enviar teste para mim (só o Master)
Botões por tipo: Aviso obrigatório · Aviso opcional · Relatório · Fatura → POST {SUPABASE_URL}/functions/v1/emails
com o token da sessão e { acao: "teste", tipo: "aviso_obrigatorio" | "aviso_opcional" | "relatorio" | "fatura" }.
Toast "Enviado para o seu e-mail, com dados fictícios." ou o erro devolvido.

## 7. Links novos dos avisos da equipe
Os avisos de chamado apontam para /console/chamados?id={id} e os de contato pelo site para /console/contatos-site:
se a rota tiver outro nome no site, crie o redirecionamento para a tela de chamados e a de contatos do site.

Confira em 1440 e 390 px, claro e escuro.
```
