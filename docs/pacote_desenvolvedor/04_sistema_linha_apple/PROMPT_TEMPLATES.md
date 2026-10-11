# Prompt Horizons — Template no WhatsApp e RCS; sem frase no discador, e-mail e bureau
Rode o SQL `01_banco/03_templates_canais.sql` antes. Cole no Horizons e publique:

```text
Mude como cada canal escolhe a mensagem. Não mude tabelas, políticas, rotas nem o restante das telas.

REGRA POR CANAL (vale na Orquestração, no canal do CPC e na tela Canais e frases)
- WhatsApp e RCS: TEMPLATE (não "frase"). Template = linha da tabela frases do mesmo canal com codigo_template
  preenchido (nome do template aprovado no provedor). Ícone: documento com linhas (Lucide "FileText").
- SMS e Agente virtual: FRASE, como hoje. Ícone: balão (Lucide "MessageCircle").
- Discador, E-mail e Enriquecimento (bureau): SEM mensagem. Não mostre bolinha, campo nem botão de frase.

ORQUESTRAÇÃO (pílulas coloridas dos canais nos dias)
Dentro da pílula, à direita, bolinha 18px só para WhatsApp, RCS, SMS e Agente virtual:
- com template/frase escolhido: bolinha branca cheia com o ícone na cor do canal; tooltip "Template: {codigo}" ou
  "Frase: {nome}";
- sem: só contorno branco 70%; tooltip "Sem template" ou "Sem frase";
- frase/template desativado: bolinha vermelha #C62828.
Clicar abre um painel (modal branco, raio 16, até 520px, fecha com X, Esc ou clique fora):
- título "Escolher template" (ou "Escolher frase"), subtítulo "{canal} · templates aprovados no provedor"
  (ou "{canal} · frases da empresa");
- campo de busca no topo ("Buscar por nome ou código do template"), filtrando enquanto digita por nome,
  codigo_template e texto: from('frases').select('id,nome,texto,codigo_template').eq('empresa_id', empresa)
  .eq('canal', canal).eq('ativo', true) (para template: .not('codigo_template','is',null));
- lista: nome (15px 600), código do template (12px cinza) e prévia do texto (13px cinza, 1 linha); o escolhido
  com ✓; vazio: "Nenhum resultado para “{busca}”.";
- rodapé: botão secundário "Sem template" (ou "Sem frase") que limpa a escolha.
Grava como hoje na ação do dia: mensagem = { frase_id: id }. Para Discador e E-mail nunca grave mensagem (se
houver uma antiga, remova ao salvar).
"Como vai funcionar": conte "N sem template" e "N sem frase" separados; discador e e-mail não entram na conta.

CANAL DO CPC (faixa "Deu CPC"): a escolha por estágio (CPC A / CPC B) segue a mesma regra e o mesmo painel.

CANAIS E FRASES (tela de cadastro)
- Abas por canal só para WhatsApp, RCS, SMS e Agente virtual. Discador e E-mail não têm aba de frases.
- WhatsApp e RCS: a aba se chama "Templates"; o formulário tem Nome, "Código do template no provedor"
  (obrigatório, até 200 caracteres, sem espaços nas pontas; grava em codigo_template) e "Prévia do texto"
  (grava em texto). Lista com busca por nome ou código.
- SMS e Agente virtual: "Frases", como hoje.
- "Começar do playbook": não crie frases de discador nem de e-mail; para WhatsApp/RCS crie como template só se o
  código existir, senão pule e avise "Cadastre o código do template no provedor".
Textos: nunca "frase" para WhatsApp/RCS; nunca mostrar campo de mensagem para Discador, E-mail ou Enriquecimento.
```
