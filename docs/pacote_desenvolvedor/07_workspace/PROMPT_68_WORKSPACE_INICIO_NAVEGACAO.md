# Prompt Horizons — 68: Workspace sem menu lateral, Início ("Para hoje" e Suas áreas) e a moldura das áreas

Rode depois do SQL 44. Protótipo aprovado em 16/10/2026: `docs/homologacao/workspace-prototipo.html` (telas "Início",
"Moldura e navegação" e "Rotas e nomes"). Substitui o que os prompts 1, 16, 18, 20 e 23 dizem sobre barra escura,
menu do Workspace e seletor de frente.

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Nada de CPF ou nome de devedor em nenhuma destas telas.

## 1. Duas molduras, o mesmo topo
Barra do topo clara (fundo do cartão, borda embaixo), igual em todas as telas logadas:
MotorCX · Início · Áreas ▾ · Empresa ▾ · Suporte (com o número de chamados "Aguardando você", prompt 70) · à direita
o campo "Busque uma tela ou pergunte ao Assistente" (⌘K, prompt 17) · "?" (O que significa, prompt 43) · sino ·
avatar (Minha conta · Documentação · Sair). Para a equipe, entra a pílula da empresa com busca; cliente com uma
empresa só não vê seletor.
- Workspace (Início, Empresa, Suporte, Minha conta): SÓ a barra do topo. Sem menu lateral. Conteúdo até 1200 px.
- Áreas (Cobrança, Jornada do Cliente, Mensageria, Relatórios): a mesma barra + o menu lateral claro do prompt 45. No
  topo do menu: "‹ Início" e a troca de área (só para quem tem as duas frentes; a escolha fica em
  perfis.frente_preferida). Tire a barra escura e o "‹ Voltar ao Workspace".
- Áreas ▾: Cobrança, Jornada do Cliente, Mensageria, Relatórios. Só as contratadas (rpc numeros_areas(): contratada);
  as outras esmaecidas com "Quero conhecer" (abre o card de interesse que já existe).
- Empresa ▾: Dados e contatos · Pessoas e perfis · Integrações · Faturas · Auditoria (cada item some sem a permissão).
Menu lateral · Cobrança: Operação (Lista do dia · Clientes · Ações · Enviar carga) · Estratégia (Orquestração ·
Personas · Segmentos · Carteiras · Mapa da Esteira · Comitê) · Mensageria (Campanhas · Lotes · Respostas · Templates ·
Listas · Configurações) · Resultados (Painel · Relatórios).
Menu lateral · Jornada do Cliente: Jornada (Mapa · Lista do dia · Clientes · Enviar carga) · Estratégia (Momentos e
fases · Mensagens por momento) · Mensageria (as mesmas telas) · Resultados (Painel · Relatórios).

## 2. Início (/inicio)
"Bom dia/Boa tarde/Boa noite, {primeiro nome}" + campo grande "O que você quer fazer? Busque ou pergunte" (abre o ⌘K).
Primeiros passos (prompt 51) continuam acima enquanto não acabarem; depois somem.
Cartão "Para hoje": rpc para_hoje(empresa_da_pilula | null, 5) → linhas {tipo, urgencia, titulo, detalhe, acao, link}.
Cada linha: ícone pelo tipo (fatura, chamado, carga, pausa, respostas, token, lista), titulo em negrito, detalhe em
cinza, botão secundário pequeno com o texto de "acao" que navega para "link". urgencia < 20 → borda esquerda vermelha;
< 40 → âmbar; o resto neutro. Lista vazia: "Tudo em dia por aqui." com um ✓ verde. Não invente itens.
Cartão "Suas áreas": rpc numeros_areas(empresa | null) → {area, contratada, numero, detalhe, link}.
Nomes: cobranca "Cobrança", mensageria "Mensageria", jornada "Jornada do Cliente". Contratada: numero grande + detalhe
+ "Abrir ›" (link). numero vazio: só o detalhe. Não contratada: cartão esmaecido, texto "Boas-vindas, ativação,
retenção" (Jornada) ou "SMS, RCS e e-mail" (Mensageria) ou "Lista do dia e réguas" (Cobrança) + "Quero conhecer".
Tire as "Dicas" rotativas e os cards de produto antigos.

## 3. Celular (até 820 px)
A barra vira: ☰ · MotorCX · sino · avatar. O ☰ abre uma gaveta à esquerda com Início, Áreas, Empresa e Suporte; dentro
das áreas, o menu lateral vai para a mesma gaveta (abaixo de "‹ Início" e da troca de área). Sem rolagem lateral em
390 px. O botão do Assistente sobe 64 px quando a tela tem botão fixo embaixo.

## 4. Rotas, nomes e login
Rotas novas, com as antigas redirecionando (replace, sem piscar):
/workspace → /inicio · /empresa/membros, /usuarios, /permissoes → /empresa/pessoas · /auditoria → /empresa/auditoria ·
/conta/permissoes → /conta?aba=perfil · /conta/seguranca → /conta?aba=seguranca · /conta/tokens →
/empresa/integracoes · /minha-conta/notificacoes → /conta?aba=notificacoes · /mensageria/:canal/relatorios →
/relatorios?canal=:canal.
Textos: "MotorCob" vira "MotorCX" em "Sobre", "Console", "Suporte MotorCX", "Equipe MotorCX", "Padrão MotorCX".
"Escolha a frente" vira "Escolha a área" e só aparece no 1º login de quem tem as duas (perfis.frente_preferida vazio);
depois abre direto a área guardada (troca em Minha conta › Preferências ou no topo do menu). Tire "Trocar para
MotorCli" do avatar.
Senha: uma regra só em todo o site (convite, troca e redefinição): 12 caracteres ou mais, com letra e número. Tire as
exigências de maiúscula, minúscula e símbolo da página de usuários.

Confira em 1440 e 390 px, claro e escuro, como cliente (Admin, Operação) e como equipe com a pílula da empresa.
```
