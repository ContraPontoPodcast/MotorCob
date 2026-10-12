# Prompt Horizons — Workspace 17: campo único "O que você quer fazer?" e o Assistente MotorCob

Rode depois do SQL 17 (`17_funil_assistente.sql`) e da função `assistente` publicada (ver
`08_api/LEIA_ASSISTENTE.md`). Antes de colar, arraste para o chat do Horizons a imagem `assistente-motorcob.webp`
(o avatar). Protótipo: https://claude.ai/artifact/XWCscHJhaWo4HQNM9MzUGf

```text
No Workspace (/workspace, Início), troque a busca atual por UM campo que busca atalhos e responde perguntas, e
crie o Assistente MotorCob com o avatar que enviei (assistente-motorcob.webp). Não mude tabelas, views ou políticas.

1. CAMPO ÚNICO no topo do Início, abaixo de "Bom dia, {nome}.": largura 520px, 52px, raio 14, fundo #F5F5F7, ícone
   Search, placeholder "O que você quer fazer? Busque ou pergunte". Atalho ⌘K/Ctrl+K foca o campo.
   a) Enquanto digita: lista de atalhos (até 8) filtrada sem acento e sem maiúscula nos nomes e descrições das telas
      que a pessoa pode abrir (mesmos itens dos menus dos produtos ativos, Empresa, Minha conta, Suporte, Documentação
      e, para a equipe, Console). Cada linha: ícone, nome, "{produto} · {descrição curta}". Setas + Enter abrem.
   b) Se o texto termina com "?" ou começa com como, onde, o que, por que, qual, quando, quanto, posso, dá para,
      consigo: a primeira linha da lista vira "Perguntar ao Assistente: “{texto}”". Enter (ou clique) pergunta.
   c) A resposta aparece logo abaixo do campo, num card #F5F5F7 raio 16: avatar 44px redondo à esquerda, "Assistente
      MotorCob · “{pergunta}”" (12px #6E6E73), o texto (15px #1D1D1F), os passos numerados e, embaixo, o botão
      principal da ação (pílula #1D1D1F) + "Continuar a conversa" (abre a gaveta com a mesma conversa) + 👍 👎.
      Enquanto espera: três pontos animados no lugar do texto. Esc ou "×" fecha o card.
   d) Lista fechada ao clicar fora; nada de segundo campo de pergunta na página.

2. CHAMADA: supabase.functions.invoke('assistente', {body: {pergunta, origem: 'busca' | 'conversa', tela:
   location.pathname, historico}}) → {id, respondida, texto, passos[], acao: {id, rotulo} | null}. historico = as
   últimas 8 mensagens da conversa [{papel: 'usuario' | 'assistente', texto}]. Erro 429: "Muitas perguntas
   seguidas. Tente de novo em alguns minutos." Outro erro: "Não consegui responder agora." + botão Abrir chamado.
   Avaliação: supabase.rpc('avaliar_resposta', {id_pergunta: id, nota: 1 | -1}); depois de votar, "Obrigado!".

3. AÇÕES (id → rota; mostre o botão só se a pessoa tiver acesso à tela): abrir_lista_dia, abrir_inicio_orquestracao,
   abrir_painel_orquestracao, abrir_acoes, abrir_clientes, abrir_personas, abrir_credores, abrir_mapa_esteira,
   abrir_orquestracao, abrir_comite, abrir_enviar_arquivos, abrir_canais_frases → as telas da Orquestração de mesmo
   nome · abrir_mensageria_painel → /mensageria/{último canal} · abrir_campanhas, abrir_lotes, abrir_respostas,
   abrir_templates, abrir_listas, abrir_config_mensageria → /mensageria/{último canal}/{tela} · abrir_relatorios →
   /relatorios · abrir_empresa → /empresa · abrir_faturamento → /empresa/faturamento · abrir_membros →
   /empresa/membros · abrir_modulos → /empresa/modulos · abrir_minha_conta → /conta · abrir_seguranca_conta →
   /conta/seguranca · abrir_tokens_api → /conta/tokens · abrir_documentacao → /docs · abrir_permissoes →
   /permissoes · abrir_auditoria → /auditoria · abrir_chamado → /suporte/novo com a pergunta já no texto.
   Use sempre o "rotulo" que vem da função como texto do botão.

4. AVATAR NO WORKSPACE (só nas páginas do Workspace): botão fixo no canto inferior direito (20px das bordas, acima
   da área segura do celular): imagem redonda 64px (object-fit cover, borda branca 3px, sombra 0 8px 24px
   rgba(0,0,0,.22)) e um balão branco à esquerda "Dúvida? Fala comigo!" (13.5px, raio 14 14 4 14). Hover: sobe 2px e
   gira -4°. O balão some depois da primeira conversa (lembre no navegador). aria-label "Falar com o assistente".

5. GAVETA DO ASSISTENTE (abre pelo avatar ou por "Continuar a conversa"): painel à direita 400px (no celular, tela
   cheia), fundo branco, sombra. Topo: avatar 40px, "Assistente MotorCob" 16px 600, "Tira dúvidas sobre a
   plataforma" 12.5px #6E6E73 e "×". Mensagens: do usuário em pílula #1D1D1F texto branco à direita; do Assistente
   em #F5F5F7 à esquerda com passos, botão da ação e 👍 👎. Sem conversa: 3 sugestões clicáveis ("Como crio uma
   campanha?", "O que é Disparado?", "Como convido um usuário?"). Rodapé: aviso 12px #6E6E73 "O Assistente não vê
   dados de devedores. Não escreva CPF, telefone ou e-mail de clientes." + campo "Pergunte sobre o MotorCob" e
   "Enviar". A conversa do campo e a da gaveta são a mesma (até fechar o navegador). Esc fecha. Foco preso na gaveta.

6. CONSOLE (só equipe) › Atendimento: aba nova "Assistente": from('assistente_sem_resposta').select('*')
   .order('criado_em', {ascending:false}) — Data · Empresa · Tela · Pergunta · Resposta dada · Avaliação (👎 ou
   "sem resposta"). Texto no topo: "Perguntas que o Assistente não soube responder ou que receberam 👎. Use para
   completar a base de conhecimento." Exportar CSV.

Confira em 1440, 1024 e 390px: um campo só, avatar sem cobrir botões, gaveta com rolagem própria.
```
