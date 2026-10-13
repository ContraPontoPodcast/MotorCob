# Prompt Horizons — Workspace 33: Console › Faturamento (emissão em lote e automática, envio, cobranças e nota)

Rode depois do **SQL 23 e 25** e das funções do passo 50. Protótipos aprovados:
https://claude.ai/artifact/AcLDqpcZvDM5qSmNgoe38k (emissão e envio) e
https://claude.ai/artifact/3aaVmpHLMGL5K2hZSqtqhK (aba "Console · Faturamento").

```text
CONSOLE MotorCX › FATURAMENTO (equipe com ver_faturamento; botões de ação só com emitir_faturas). Não mude
tabelas nem políticas. Textos e layout dos protótipos. Erros do banco na faixa vermelha, sem derrubar a tela.

1. ABA "FATURAS DO CICLO": três cartões no topo explicando "Uma a uma", "Em lote" e "Automática" (textos do
   protótipo). Tabela de faturas_painel do ciclo escolhido (seletor de mês no topo): caixa de seleção (só nos
   rascunhos), Empresa, Ciclo (ciclo_de), Emissão (select "Automática"/"Revisar antes" que grava
   ciclo_empresa.emissao = 'automatica'|'revisar' com upsert onConflict empresa_id), Valor, Situação (Rascunho
   cinza · "Sai sozinha em dd/mm" amarelo quando rascunho de empresa automática · Emitida verde · Paga · Vencida)
   e Envio:
   - envio 'enviado' → selo verde "E-mail enviado · demonstrativo · boleto" (title: enviada_para e enviada_em);
   - 'pendente'/'enviando' → "Enviando…" cinza; 'erro' → selo vermelho com envio_motivo e o botão
     "Enviar de novo" → rpc('reenviar_fatura', { fatura: id }).
   - Botões no topo: "Gerar rascunhos" (rpc('gerar_rascunhos', { competencia }), só Master, como hoje) e
     "Emitir selecionadas (N)" → rpc('emitir_faturas', { faturas: [ids] }); sucesso: "N faturas emitidas.
     Demonstrativo, boleto e e-mail a caminho." Caixa no cabeçalho marca todos os rascunhos.
   - Abrir uma fatura continua mostrando o rascunho com ajustes e o botão "Emitir" de hoje; nas emitidas, os
     links "Demonstrativo (PDF)" (invoke('cobranca', { body: { acao: 'demonstrativo', fatura } }) → data.url) e
     "Boleto (PDF)" (boleto_pdf).
   - Texto abaixo da tabela: "Ao emitir: o demonstrativo em PDF é gerado, o boleto é criado no Stripe (PDF
     separado) e o e-mail vai para os contatos financeiros da empresa. Se algo falhar, a fatura continua emitida e
     o envio aparece com o motivo e o botão Enviar de novo."

2. ABA "COBRANÇAS": cobrancas (com empresas.nome) das empresas do alcance, mais recentes primeiro: Empresa ·
   Origem ("Fatura {id}" ou "Recarga {id}" + " · automática") · Forma · Valor · Situação (Pendente · vence
   dd/mm amarelo / Paga dd/mm hh:mm verde / Venceu sem pagamento cinza / Recusado: {motivo} vermelho /
   Cancelada). Recarga pendente sem cobrança paga: o "Marcar como paga" do prompt 31 continua, com a frase
   "Marcar como paga continua para o pagamento recebido por fora do Stripe; ao marcar, o boleto ou Pix pendente
   daquela recarga deixa de valer."

3. ABA "NOTAS FISCAIS": notas_fiscais (com empresas.nome): Empresa · Origem · Valor · Situação (Processando
   cinza / Autorizada nº {numero} verde com link "PDF" (link_pdf) / Erro: {mensagem} vermelho com "Emitir de
   novo" → invoke('cobranca', { body: { acao: 'emitir_nf', fatura|recarga } }) / Cancelada).

4. ABA "CONFIGURAÇÃO DA NOTA" (só Master edita; os outros veem só leitura): formulário de nf_config (id = 1) com
   os campos e rótulos do protótipo: Emitir nota (ativo), Ambiente (Homologação/Produção, com o selo amarelo
   "Homologação (teste)" ou verde "Produção"), Quando emitir a nota da fatura (pagamento/emissao), Razão social
   do prestador, CNPJ do prestador (só números), Endereço do prestador, E-mail do financeiro (remetente das
   faturas), Inscrição municipal, Município emissor e Município da prestação (código IBGE, 7 dígitos), Código de
   tributação nacional do ISS (6 dígitos), Código de tributação municipal (3), Código NBS (9), Simples Nacional
   (1 Não optante · 2 MEI · 3 ME/EPP) e, se 3, Regime de apuração (1 · 2 · 3, textos do protótipo), Regime
   especial (0 Nenhum · 3 Microempresa municipal · 6 Sociedade de profissionais · 9 Outros), Retenção do ISS
   (1 Não retido · 2 Retido pelo tomador), Alíquota do ISS (%), Descrição na nota da fatura e da recarga.
   "Salvar" → update em nf_config. Ligar a nota com campo faltando: "Para ligar a nota, falta: …".
   Texto: "Preencha com o contador. Enquanto estiver em Homologação, as notas são de teste e não valem para a
   Receita."

5. CONTRATAÇÃO (prompt 31), seção Cobrança: acrescente o seletor "Emissão da fatura": "Revisar antes (a equipe
   emite)" / "Automática no fim do ciclo", gravando ciclo_empresa.emissao. Só aparece no Pós-pago.

Confira em 1440 e 390px: marque duas empresas em rascunho e emita em lote; veja o envio mudar para "E-mail
enviado"; deixe uma empresa sem contato financeiro e veja o erro com "Enviar de novo".
```
