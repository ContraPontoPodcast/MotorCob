# Prompt Horizons — 62: Jornada · Momentos e fases e Mensagens por momento (substitui a seção 6 do prompt 24)

Rode depois do prompt 61 e dos prompts 35 (etapas) e 41 (barra da Orquestração). Protótipo aprovado em 15/10/2026:
`docs/homologacao/jornada-prototipo.html` (telas "Momentos e fases" e "Mensagens por momento").

```text
Plataforma do cliente, produto Jornada (MotorCli). NÃO crie, altere ou apague tabelas, views ou políticas.

## 1. Momentos e fases (/jornada/momentos)
- Mesma barra da Orquestração (prompt 41): vistas Desenho · Momentos e fases · Travas · Visão geral, "Alterações não
  salvas: N", "Copiar de outra carteira", Salvar (PainelEdicao do prompt 49 com o resumo de → para).
- Estratégia da carteira = credores.estrategia_id (vazia = a padrão da frente motorcli). rpc carteiras_da_estrategia(
  estrategia) com mais de uma carteira → faixa âmbar "Estratégia compartilhada. "{nome}" também vale para {outras}.
  Mudar aqui muda todas." + "Separar só para esta carteira" (rpc separar_estrategia_jornada(credor)) e "Editar para
  todas". "Copiar de outra carteira": lista das carteiras da Jornada → rpc copiar_estrategia_jornada(credor, origem)
  (sempre cópia independente). Quem pode: pode('editar_orquestracao'); os outros veem somente leitura com cadeado.
- Um bloco por momento, na ordem da prioridade (definicao.hierarquia; sem ela: Pré-vencimento, Boas-vindas, Ativação,
  Retenção, Reativação), com ▲▼ e a pílula "1º, 2º…". Nota: "Quando o cliente está em dois momentos no mesmo dia,
  vale o de cima." Salva definicao.hierarquia com os cinco, cada um uma vez.
- Chave Ligado/Desligado (momentos.<m>.ativo). Passos: dia em texto ("5 dias antes do vencimento", com o código
  pequeno embaixo), canal ("Melhor canal" mostra as opções e "escolhe pelo resultado do momento"), senão e a
  mensagem: seletor das frases do momento e do canal (frases com estagio = o momento e o canal) → frase_id na ação;
  "Template padrão do canal" = sem frase_id. Mostre o começo do texto com as variáveis em destaque.
- "Orçamento por dia": por canal, número ou "sem limite" → momentos.<m>.orcamento {canal: quantidade}. Nota: "Passou
  do limite no dia, o cliente concorre de novo amanhã."
- Dias permitidos e padrão como no prompt 24. Salvar grava a definicao inteira (sem apagar etapas, travas e
  recencia_horas).

## 2. Mensagens por momento (/jornada/mensagens; item novo no menu de Configuração)
- Abas por momento com a contagem. Lista de frases (empresa, estagio = momento): Nome · Canal · Usada em (passos e
  carteiras cuja estratégia usa o frase_id) · Resultado (rpc resultado_frases(credor, de, ate) da carteira do topo,
  últimos 30 dias: "{taxa}% {frase do resultado}"; sem dado: "—"). "Nova mensagem" e "Editar" no PainelEdicao.
- Edição: Nome, Canal, Texto. SMS: contador de caracteres e partes (160 por parte). Variáveis em botões vindas das
  colunas extras da última carga de clientes ({primeiro_nome}, {valor}, {vencimento}, {link}…); sem a coluna, a
  variável não aparece. RCS e WhatsApp: escolha o template aprovado da Mensageria (codigo_template), não texto livre.
  Lembre embaixo: "Responda SAIR para não receber" no SMS. Nunca grave dado pessoal no texto.
- Apagar só se nenhum passo usar a frase (senão: "Usada em {n} passos: troque antes de apagar").

Confira em 1440 e 390 px, claro e escuro.
```
