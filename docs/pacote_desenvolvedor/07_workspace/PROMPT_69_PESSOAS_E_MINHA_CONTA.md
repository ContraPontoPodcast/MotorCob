# Prompt Horizons — 69: Empresa › Pessoas e perfis e Minha conta numa rota só

Rode depois do SQL 44 e do prompt 68. Protótipo aprovado em 16/10/2026: `docs/homologacao/workspace-prototipo.html`
(telas "Empresa › Pessoas e perfis" e "Minha conta"). Substitui as telas Membros, Usuários e Permissões e as rotas
antigas de Minha conta.

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Use as funções que já existem para convidar, mudar perfil,
desativar e ajustar permissões (as mesmas que as telas antigas usam); só a tela muda.

## 1. Empresa › Pessoas e perfis (/empresa/pessoas?aba=pessoas|perfis)
Cabeçalho "Pessoas e perfis" + botão "Convidar pessoa" (só com pode('gerenciar_usuarios')). Duas abas.
Aba Pessoas: rpc pessoas_empresa(empresa | null) → {id, nome, email, papel, areas, ultimo_acesso, situacao,
duas_etapas_obrigatoria}. Colunas: Nome (e o e-mail em cinza embaixo; vem vazio para quem não gerencia, aí não mostre)
· Perfil (Admin, Planejamento, Operação, Gestão) · Áreas (cobranca "Cobrança", jornada "Jornada") · Último acesso
("hoje 08:02", "ontem", "12/10", "—") · Situação: ativo → "Ativo" verde; convite → "Convite enviado" âmbar + link
"Reenviar convite"; inativo → "Desativado" cinza. Ação "Gerenciar".
Celular: cada pessoa vira cartão (nome e situação na 1ª linha; perfil e áreas embaixo).
Sem pode('gerenciar_usuarios'): a lista em leitura (sem "Gerenciar" e sem "Convidar"), com a nota "Quem convida e
ajusta perfis é o Admin da sua empresa."
Gerenciar → PainelEdicao (painel lateral): Perfil (com a descrição do item 2) · Áreas · "Redefinir senha" (manda o
e-mail de redefinição) · últimos acessos · "Desativar" com a confirmação do prompt 49: "{nome} perde o acesso na
hora. O histórico fica." Resumo do que muda antes de salvar.
Convidar pessoa → PainelEdicao: E-mail* · Nome* · Perfil* (rádios com a descrição) · Áreas (só as da empresa). O
resumo antes de enviar diz o que a pessoa vai poder fazer ("Vai poder: trabalhar a Lista do dia e as respostas…").
Admin: mostra "Verificação em duas etapas obrigatória no 1º acesso".

## 2. Aba Perfis
rpc perfis_empresa(empresa | null) → {papel, pessoas, ajustes}. Um cartão por perfil, nesta ordem e com este texto:
Admin "Tudo da empresa: pessoas e perfis, faturas, integrações e configurações." · Planejamento "Monta estratégias,
campanhas e réguas; envia cargas; vê resultados." · Operação "Trabalha a Lista do dia e as respostas dos clientes;
não muda estratégias." · Gestão "Acompanha resultados e relatórios; não muda nada na operação."
Rodapé do cartão: "{pessoas} pessoas" · "{ajustes} ajuste(s)" quando > 0 · Admin: "duas etapas obrigatória".
Abaixo, "O que cada perfil pode": a matriz que hoje está em /permissoes (permissoes_catalogo × os quatro perfis), cada
permissão com o nome em negrito e a descrição em cinza. Diferente do padrão → pílula "ajustado" + "Voltar ao padrão".
Cadeado nas permissões que o perfil não pode mudar. Sem pode('gerenciar_permissoes'): em leitura.

## 3. Minha conta (/conta?aba=dados|seguranca|notificacoes|preferencias|perfil)
Uma rota só, cinco abas (no celular, um seletor no topo). Aba guardada na URL.
- Dados: foto, nome, sobrenome, telefone. E-mail em leitura com "Só o Admin troca o e-mail."
- Segurança: trocar senha (12+ caracteres, letra e número, a regra do prompt 68), verificação em duas etapas (prompt
  19; para Admin aparece "obrigatória" e não desliga) e "Sair dos outros aparelhos" →
  supabase.auth.signOut({ scope: 'others' }) com confirmação "Os outros aparelhos voltam para o login."
- Notificações: a tela do prompt 64 (minhas_notificacoes / salvar_notificacoes), sem mudar nada nela.
- Preferências: Tema (claro, escuro, do sistema, prompt 44) · Ajuda nas telas (automática, sempre aberta, só o (i),
  desligada, prompt 43) · "Área que abre primeiro" (só para quem tem as duas frentes; grava perfis.frente_preferida).
- Meu perfil: o que o seu perfil pode, em leitura (a coluna do seu perfil na matriz do item 2), com "Quem ajusta é o
  Admin, em Empresa › Pessoas e perfis."
Tokens saem de Minha conta (já estão em Empresa › Integrações, prompt 63).

Confira em 1440 e 390 px, claro e escuro, como Admin e como Operação.
```
