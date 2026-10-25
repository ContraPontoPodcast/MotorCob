# Prompt Horizons — 75: seletor de área, empresa no topo, carteira sem beco, marca MotorCX e tema escuro (demo)

Versão final (UX + CX, 25/10/2026). Rode depois do 74 e do SQL 46 (já rodado). Protótipo: `navegacao-prototipo.html` v3.
Sai junto com o 76 (site público). Resolve UX-01, 02 (app, login e prévia de link), 03, 04, 08, 11, 17 e 21.

```text
NÃO crie, altere ou apague tabelas, views ou políticas. Nada de CPF ou nome de devedor. Não mude o que as telas
fazem; só o que está abaixo. Não mexa em ids internos (motorcob, motorcli, mc-frente) nem em nomes de parâmetro.

## 1. Seletor de área no topo do menu lateral, em passos
1.1 Remova do menu lateral (app-shell): o link "‹ Início", a pílula da empresa (componente Ae) e a linha de botões
    de área (componente Me), inclusive na versão recolhida.
1.2 No cabeçalho do menu fique só: [seletor de área] à esquerda e o ↤ (recolher) à direita, com borda embaixo.
1.3 Seletor = botão (altura 44, raio 10, sem fundo; hover e aberto = var(--base-fill)): quadrado 28×28, raio 8,
    fundo var(--area-cobranca | --area-jornada | --area-mensageria | --area-neutro) com ícone lucide branco 16 px
    (Cobrança Wallet · Jornada: trocar Compass por Route · Mensageria MessageSquare · Relatórios ChartColumn) +
    nome da área 15 px peso 700 com reticências + ChevronDown 14 cinza. Recolhido: só o quadrado, centrado.
1.4 Clique, Enter ou Espaço abre o menu suspenso num portal no body (createPortal), z-[70], ancorado abaixo do botão
    (recolhido: à direita). Largura 310, raio 12, fundo var(--base-cartao), borda var(--base-borda), sombra,
    role="menu", setas ↑↓, fecha no Esc, no clique fora e ao escolher. Conteúdo:
    "Áreas" (11 px maiúsculo cinza) · uma linha por área liberada (regra do 74), na ordem Cobrança, Jornada do
    Cliente, Mensageria, Relatórios: quadrado 24 + nome 14 semibold + descrição 12 cinza ("Lista do dia, réguas e
    carteiras" · "Boas-vindas, ativação e retenção" · "Campanhas, lotes e respostas" · "Os números de todas as
    áreas") + ✓ na atual · linha · "Não contratadas" (se houver): quadrado var(--base-fill) com ícone cinza, nome
    cinza e "Quero conhecer" (card que já existe; equipe com pílula: "Abrir mesmo assim") · linha · "‹ Ir para o
    Início". Escolher = navegar para o destino do 74 com aplicarFrente.
1.5 Mensageria: abaixo do cabeçalho, uma faixa com o rótulo "Canal" (11 px maiúsculo cinza) e as pílulas de canal;
    a ativa com fundo var(--base-texto) e texto var(--base-cartao); borda embaixo separando da navegação.
1.6 Gaveta (< 1024 px): Início · (equipe: Console MotorCX e a pílula da empresa) · linha · o mesmo seletor (menu
    suspenso na largura da gaveta) · menu da área · linha · Empresa (Dados e contatos, Pessoas e perfis,
    Integrações, Faturas, Auditoria, com as permissões de hoje) · Suporte. Fora de uma área: a lista "Áreas" de hoje.
1.7 Aceite: o aside não tem nenhum botão ou link com o nome de uma área fora do seletor, nem pílula de empresa.
Cores escuras das áreas (acrescente no CSS global, sem mudar o claro):
[data-tema=escuro]{--area-cobranca:#a07c38;--area-jornada:#5e7f45;--area-mensageria:#9a3e4e;--area-neutro:#545458}

## 2. Empresa é contexto: só no topo
- Remova Ae do menu (passo 1.1) e mude o estilo da pílula que JÁ existe no topo (assistente-gaveta, componente q):
  ícone Building2 + nome + ▾, borda 1 px var(--base-borda), raio 999, altura 30, máx. 240 px com reticências; sem
  empresa: "Escolher empresa" em âmbar. Não crie outra pílula.
- Última empresa da equipe: use a chave que já existe, mc-empresa (auth-provider). Só deixe de apagá-la ao sair.
- Telas com "Escolha a empresa no topo…": mantenha o texto e ponha o botão "Escolher empresa", que abre a pílula.
- Cliente: sem pílula. Nome da empresa no menu do avatar e no subtítulo das telas; rodapé do menu "{nome} · {perfil}".

## 3. Carteira
Lista do dia, Orquestração, Personas e Comitê: com "Todas as carteiras", troque o aviso "Escolha o credor no topo…"
por um cartão "Escolha a carteira" com um botão por carteira ativa; clicar chama selectCredor (o mesmo do seletor).
Enviar arquivos: só a palavra ("Escolha a carteira no topo do bloco de envio"). Textos visíveis "credor(es)" →
"carteira(s)", EXCETO docs-api, /documentacao e nomes de parâmetro ou campo (?credor=, credor_id, escopos).

## 4. Marca MotorCX
4.1 No helper seo (o que monta title, og:title, twitter:title e description), antes de montar as tags: troque
    "MotorCob" por "MotorCX" e o " | " final do título por " · ". Depois troque também o texto nos meta das rotas.
4.2 Regra geral: todo texto visível "MotorCob" vira "MotorCX" e "MotorCli" vira "Jornada do Cliente". Exceções: ids
    internos, empresas.nome (dado), o nome do fator do autenticador (duasEtapasLogica, prompt 76) e o site público
    (prompt 76). Inclui "O Suporte da MotorCob…", "Equipe MotorCob no Console", "sugestão do MotorCob", "fale com o
    suporte MotorCob", "Acesse a plataforma MotorCob", "Modelos MotorCob", "playbook MotorCob" → "padrão MotorCX".
4.3 Nome da área no lugar de frentes.nome (sem mexer nos ids): cartões de escolha do login, pílula do Início
    ("Cobrança", não "MotorCob · Cobrança") e aviso do Workspace ("Sua empresa ainda não tem a Cobrança"). Logo do
    login com frente no link: só "MotorCX". Login: "Uma conta para todas as áreas." e "Quem tem acesso a uma área só
    entra direto nela." Console › Assistente: filtros "Cobrança" e "Jornada do Cliente".
4.4 Aceite: fora das exceções, nenhuma ocorrência visível de MotorCob ou MotorCli (inclusive no HTML do servidor:
    view-source de /login e /fila com "· MotorCX").

## 5. Tema escuro: cole este bloco no CSS global (as classes estão escritas como no código, com maiúsculas)
.mc-platform .bg-\[\#FFE8E6\],.mc-platform .hover\:bg-\[\#FFE8E6\]:hover{background-color:var(--estado-erro-fundo)}
.mc-platform .bg-\[\#E8F8EC\],.mc-platform .hover\:bg-\[\#E8F8EC\]:hover{background-color:var(--estado-pronto-fundo)}
[data-tema=escuro] .mc-platform :is(.bg-\[\#FFF3E8\],.bg-\[\#FFF7E8\],.bg-\[\#FFF8E1\],.bg-\[\#FFF3DF\],
.hover\:bg-\[\#FFF1D8\]:hover){background-color:var(--estado-atencao-fundo)}
.mc-platform .bg-\[\#E8F1FF\]{background-color:var(--estado-info-fundo)}
[data-tema=escuro] .mc-platform :is(.bg-\[\#E8E8ED\],.bg-\[\#E5E5EA\],.bg-\[\#EEEEF0\],.bg-\[\#F0F0F2\],
.hover\:bg-\[\#E8E8ED\]:hover,.hover\:bg-\[\#E5E5EA\]:hover,.hover\:bg-\[\#EEEEF0\]:hover){background-color:var(--base-fill)}
[data-tema=escuro] .mc-platform :is(.bg-\[\#FAFAFC\],.bg-\[\#FAFAFB\],.bg-\[\#F8F8F9\],.bg-\[\#F8F9FB\],
.hover\:bg-\[\#FAFAFC\]:hover){background-color:var(--base-cartao)}
.mc-platform .text-\[\#0A60D0\]{color:var(--estado-info)}
.mc-platform .border-\[\#0A60D0\]{border-color:var(--estado-info)}
.mc-platform .text-\[\#FF3B30\],.mc-platform .hover\:text-\[\#FF3B30\]:hover{color:var(--estado-erro)}
.mc-platform .border-\[\#FF3B30\]{border-color:var(--estado-erro)}
.mc-platform .text-\[\#248A3D\]{color:var(--estado-pronto-texto)}
[data-tema=escuro] .mc-platform .border-\[\#FFE08A\]{border-color:var(--base-borda)}
As variáveis --estado-* e --base-* já existem no claro e no escuro (no claro têm o mesmo valor das classes); os
cinzas e âmbares ficam presos ao escuro para o claro não mudar. Aceite: no CSS publicado, grep "FFE8E6" e
"0A60D0" (maiúsculas) acha essas regras; no claro nada muda de cor.

Confira no claro e no escuro, em 1440, 900 e 390 px, como cliente (Admin, Operação) e equipe com e sem empresa: o
topo do menu mostra só o seletor + ↤ (passo 1.7); o menu suspenso fica por cima da barra do topo, inclusive recolhido;
a pílula da empresa só no topo, para a equipe, e volta igual depois de sair e entrar; Lista do dia com "Todas as
carteiras" mostra os botões; Faturas, Pessoas e Atendimento legíveis no escuro; nenhum MotorCob visível (4.4).
```
