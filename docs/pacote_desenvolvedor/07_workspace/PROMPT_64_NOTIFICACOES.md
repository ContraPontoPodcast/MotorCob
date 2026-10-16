# Prompt Horizons — 64: Minha conta › Notificações, Empresa › Contatos (e-mail voltou) e a página /email/sair

Rode depois do SQL 42 e da função `emails`. Protótipo aprovado em 16/10/2026: `docs/homologacao/emails-sistema-prototipo.html`
(telas "Minha conta › Notificações" e "Empresa › Contatos").

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Nada de e-mail ou CPF de devedor em nenhuma destas telas.

## 1. Minha conta › Notificações (/minha-conta/notificacoes)
Nova aba em Minha conta. rpc minhas_notificacoes() devolve só os assuntos que o perfil recebe:
assunto, nome, descricao, sino, email, sino_travado, email_travado.
Tabela (no celular, cartão por assunto): Assunto (nome em negrito + descricao em cinza) · Sino · E-mail.
Travado = cadeado e o texto "obrigatório" no lugar do interruptor (title: "Avisa de algo que para a operação ou mexe
em acesso e pagamento"). Os demais = checkbox.
Salvar → rpc salvar_notificacoes([{assunto, sino, email}, ...]) só com o que mudou; toast "Salvo." Se ligou algum
e-mail: "Salvo. Você passa a receber por e-mail: {nomes}."
Abaixo: "O e-mail começa desligado nos assuntos opcionais. Mesmo aviso repetido: no máximo 1 e-mail por dia. O link
'Não quero mais estes e-mails' no rodapé de cada e-mail desliga o assunto direto."
O sino (prompt 49) já respeita o "Sino" desligado; não mude o sino.

## 2. Empresa › Contatos: quando o e-mail volta
from('empresa_contatos') ganha email_situacao ('ok'|'voltou'), email_motivo, email_voltou_em, email_entregue_em.
Coluna "Situação" (no celular, no canto do cartão): voltou → pílula vermelha "E-mail voltou" (title = email_motivo
e a data); ok com email_entregue_em → pílula verde "Entregue {dd/mm}"; sem e-mail ou nunca enviado → "—".
Faixa âmbar no topo quando algum contato que recebe faturas voltou: "O e-mail de {nome} ({área}) voltou. A fatura
não chega para ele. Confira o endereço." + "Corrigir" (abre o PainelEdicao do contato no campo E-mail).
Ao salvar um e-mail diferente, a marca some sozinha (o banco faz); toast "E-mail corrigido. O próximo envio vai para
o endereço novo."
Se nenhum contato que recebe faturas está ok: faixa vermelha "Nenhum contato recebe a fatura por e-mail. Ela vai
para os Admins até você corrigir." 

## 3. Página pública /email/sair (sem login, sem menu)
Abre pelo link do rodapé: /email/sair?u=&a=&t=. Ao abrir: GET {SUPABASE_URL}/functions/v1/emails/sair?u=&a=&t= com o
cabeçalho apikey = anon key (só confere, não muda nada). Válido → cartão central com o nome MotorCX em texto e:
- a = 'relatorio:<id>': "Sair da lista deste relatório?" + botão "Sair da lista".
- outro: "Parar de receber estes e-mails?" + botão "Não quero mais".
Botão → POST {SUPABASE_URL}/functions/v1/emails com { acao: "sair", u, a, t } (apikey anon) → mostra a "mensagem"
devolvida (ex.: "Pronto: você não recebe mais por e-mail "Atendimento". O sino continua mostrando.") e o link
"Escolher outros em Minha conta › Notificações" (/minha-conta/notificacoes, pede login).
Inválido → "Este link não vale mais. Entre na plataforma e ajuste em Minha conta › Notificações."
Não confirme sozinho ao abrir (programas de e-mail abrem links para conferir). Sem rastreador nesta página.

Confira em 1440 e 390 px, claro e escuro.
```
