# Prompt Horizons — Workspace 22: correção dos bugs encontrados depois do prompt 20

Conferido no código publicado (motorcob.online). Cada item diz a causa encontrada. Protótipo:
https://claude.ai/artifact/XWCscHJhaWo4HQNM9MzUGf

```text
CORREÇÃO DE BUGS. Não mude tabelas, views, políticas, a função assistente nem o visual que não for citado.

1. MENSAGERIA NÃO ABRE ("Ops! Ocorreu um erro inesperado" em /mensageria/:canal e filhas). Causa: em
   routes/mensageria-canal-layout existe a linha solta "useNavigate();" e useNavigate NÃO está importado
   (ReferenceError). Remova essa linha (ela não é usada) ou importe useNavigate do mesmo pacote de rotas usado
   nos outros arquivos. Depois abra e confira: /mensageria/sms, /campanhas, /campanhas/nova, /lotes, /templates,
   /listas, /respostas, /config e /relatorios, em SMS, RCS e E-mail.

2. PERGUNTA NÃO SAI no campo "O que você quer fazer?" (ex.: "Quero disparar um SMS"). Causa: só vira pergunta
   com "?" ou palavra inicial (como, onde…). Nova regra:
   - Com 3 palavras ou mais, OU sem atalho cujo nome comece com o texto, a PRIMEIRA linha da lista é sempre
     "Perguntar ao Assistente: “{texto}”" e os atalhos vêm abaixo.
   - Enter sem ter usado as setas = primeira linha. Com 1–2 palavras que batem com um atalho, o atalho vem
     primeiro e a pergunta fica como última linha.
   - Botão redondo 32px com ícone ArrowUp (#1D1D1F, branco) à direita do campo quando houver texto: pergunta.
   Na gaveta, Enter envia e Shift+Enter quebra linha; o botão Enviar fica ativo sempre que houver texto.

3. EMPRESA ESCOLHIDA SE PERDE. Causa no auth-provider: a empresa da equipe fica em sessionStorage e é comparada
   com "===" entre texto (o que foi salvo) e número (id da empresa), então nunca é encontrada. Corrija:
   - Guarde em localStorage ("mc-empresa") e compare String(empresa.id) === valorSalvo.
   - Equipe com UMA empresa ativa: selecione sozinha. Cliente (perfil.empresa_id): carrega direto, sem tela de
     escolha (já é assim; garanta que nada pede escolha para ele).
   - Depois do login vá direto para /workspace com a empresa carregada. A escolha só muda pelo seletor de empresa
     e vale para todas as telas, abas e recargas. Ao sair (logout), apague "mc-empresa".

4. SELETOR DE CANAL DA MENSAGERIA (feio e "E-mail" quebrando em duas linhas). Troque o controle segmentado por
   uma grade 2×2 no menu lateral: cada canal é um botão de 34px, raio 9, texto 12.5px 500 sem quebra de linha,
   com um ponto 7px na cor do canal (SMS #7A4FB0, RCS #3B5BA9, E-mail #A2552B, WhatsApp #1F8A4C) antes do nome.
   Normal: fundo rgba(255,255,255,.04), texto #A1A1A6, contorno interno 1px rgba(255,255,255,.06). Hover: fundo
   rgba(255,255,255,.08), texto branco. Ativo: fundo rgba(255,255,255,.14), texto branco, contorno .22 e o ponto
   cheio. Não contratado: opacidade .38, ponto cinza, title "{canal} · não contratado". Menu recolhido: os 4
   empilhados, só o ponto/inicial.

5. MENU LATERAL — RELATÓRIOS E ITENS REPETIDOS. Causas: o grupo fixo põe "Relatórios" (/relatorios, que são os
   relatórios da Mensageria) também na Orquestração e no Console, e ganhou o título "Administração", repetindo o
   grupo de cima.
   - "Relatórios" aparece SÓ na Mensageria (grupo Análise, /mensageria/:canal/relatorios). Tire da Orquestração
     e do Console.
   - Grupo fixo SEM título, separado por uma linha #2C2C2E: Usuários e permissões · Auditoria.
   - Tire "Permissões" do grupo Administração da Orquestração: a página /permissoes vira uma aba dentro de
     Usuários e permissões (segmentado claro "Usuários · Permissões" no topo de /usuarios e de /permissoes).
   - Orquestração, Operação: sempre Início, Lista do dia, Ações e (com permissão) Painel; Carteira: Clientes,
     Personas (com permissão) e Credores. A equipe MotorCob vê todos os itens.

Confira em 1440 e 390px, logado como equipe e como cliente: Mensageria abrindo em todas as telas, pergunta
saindo pelo Enter, empresa mantida ao trocar de produto e ao recarregar, canais sem quebra de linha, e
Relatórios só na Mensageria.
```
