# Prompt do site — Página comercial do MotorCob (home pública) com botão Entrar

Antes: rode o SQL `20261029000001_site_comercial.sql` e suba a mídia no bucket `site` (Supabase › Storage › site ›
Upload: os arquivos da pasta `midia`). Cole no Hostinger Horizons e publique:

---

```text
Crie a página comercial pública do MotorCob em "/". A plataforma que já existe NÃO muda: só a página inicial
dela sai de "/" e vai para "/inicio".

## Rotas
- "/" = página comercial (pública, sem login). Botão "Entrar" (topo e rodapé) leva para a tela de login atual.
- A página inicial da plataforma (Visão da operação) passa para "/inicio"; o item "Início" do menu aponta para
  ela; depois do login, redirecione para "/inicio" (ou para a página que o usuário tentou abrir). Todas as outras
  rotas e proteções continuam iguais. Usuário já logado que abre "/" vê a página comercial com o botão
  "Ir para a plataforma" no lugar de "Entrar".

## Mídia (vídeos curtos sem som, em loop)
Base: https://jxwppkrkuckfwmphqjva.supabase.co/storage/v1/object/public/site/
Arquivos: 01-dor, 02-visao-operacao, 03-enviar-arquivos, 04-credores, 05-segmentos, 06-esteira,
07-extrato-cliente, 08-lista-do-dia, 09-personas, 10-acoes — cada um em .mp4 (vídeo), .jpg (capa) e .gif.
Use <video muted loop playsinline preload="none" poster="<nome>.jpg"> com o .mp4; só dá play quando entra na tela
(IntersectionObserver) e pausa quando sai. Com prefers-reduced-motion, mostre só a capa. Vídeos dentro de uma
"moldura de navegador" (barra cinza com 3 bolinhas), cantos arredondados, sombra suave, alt/aria-label descritivo.
Vídeo completo com som: MotorCob_video_completo.mp4 (abre num modal com controles, botão "Assista ao vídeo").

## Visual
Mesma identidade da plataforma: azul-petróleo #0F4C5C, âmbar #E9A23B, fundo claro, fonte Inter, logo "MotorCob ·
Gestão de contatos". Sóbrio, B2B, sem exageros. Responsivo (no celular os vídeos ficam abaixo do texto).

## Seções (nesta ordem)
1. Topo fixo: logo · links (Como funciona, Funcionalidades, Segurança, Contato) · botão "Entrar".
2. Hero: título "Da carga à ação, com inteligência." Subtítulo: "O MotorCob decide, todo dia, quem acionar, por
   qual canal e em qual telefone — e aprende com cada ocorrência da sua operação de cobrança." Botões
   "Fale com a gente" (rola até o contato) e "Assista ao vídeo" (modal). Ao lado: 02-visao-operacao.
3. "O ritual de sempre" (fundo escuro #0F2E36): a carga chega, vira planilha, PROCV, filtro por UF e saldo, e as
   perguntas sem resposta: quem recebe WhatsApp? qual telefone discar primeiro? quem já foi acionado ontem?
   O resultado só aparece no fim do mês. Vídeo 01-dor.
4. "Como funciona" — 4 passos com ícones: (1) A carga chega (site ou API) · (2) Cada cliente cai num segmento e
   segue a estratégia do dia · (3) Sai a Lista do dia por canal, um contato por cliente, o Hot primeiro ·
   (4) A ocorrência volta e o motor aprende (CPC vira Hot; número inválido sai).
5. Funcionalidades — blocos alternados (texto de um lado, vídeo do outro), 2–3 frases cada:
   - Enviar arquivos (03): carga geral, incremental, retirada, acordo, pagamento, ocorrência e retorno dos canais,
     com leitura automática do layout de cada credor.
   - Credores e regras (04): calendário, mapeamento de arquivos, códigos de ocorrência e regras de retorno de cada
     canal por credor.
   - Segmentos e personas (05): a carga se divide sozinha em segmentos; cada um com a sua estratégia.
   - Esteira visual (06): arraste canais para os dias — cliente novo, CPC, não CPC, preventivo e quebra de acordo —
     com frases por dia e liga/desliga por fase.
   - Extrato do cliente (07): a linha do tempo de cada cliente: ações, ocorrências, CPC e acordos.
   - Lista do dia (08): um arquivo por canal, pronto para a ferramenta de disparo, com o motivo de cada cliente
     estar (ou não) na lista hoje.
   - Personas que aprendem (09): o motor descobre o melhor canal de cada perfil de cliente — CPC por real gasto —
     e sugere mudanças com evidência.
   - Indicadores (10): ações, CPC e custo por canal, segmento e estratégia; relatório do comitê todo mês.
6. Segurança e LGPD (cartões com ícone): cada empresa só vê os próprios dados · permissões por perfil definidas
   pelo Admin · histórico de quem alterou o quê · o site mostra só o ID do cliente, sem CPF nem telefone ·
   motor na nuvem em São Paulo, com backup diário.
7. Integração: "Importe bases, dispare mailings para os seus fornecedores e receba os retornos por API." com o
   selo "em breve".
8. Contato "Fale com a gente": Nome*, Empresa, E-mail*, Telefone, Mensagem e a caixa obrigatória "Concordo que o
   MotorCob use estes dados para retornar o meu contato." → insert em public.contatos_site (nome, empresa, email,
   telefone, mensagem, consentimento: true, origem: 'home'). Use insert SEM .select() (o visitante não pode ler
   a tabela). Sucesso: "Recebemos! Retornamos em até 1 dia útil." Erro: mostre a mensagem em português.
   Campo escondido anti-robô (honeypot): se vier preenchido, não envie.
9. Rodapé: logo, "© 2026 MotorCob", links Entrar · Contato · Política de privacidade (página /privacidade com
   texto simples: quais dados o formulário coleta, para quê, e como pedir exclusão pelo e-mail de contato).

## SEO
<title>MotorCob · Gestão de contatos para cobrança</title>; meta description com a frase do hero; Open Graph com a
imagem 02-visao-operacao.jpg; página em pt-BR.
```
