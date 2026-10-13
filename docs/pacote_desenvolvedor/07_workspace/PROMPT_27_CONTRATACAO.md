# Prompt Horizons — Workspace 27: Contratação (motor, módulos, preços e ciclo de uso) num lugar só

Rode depois do **SQL 19** (`01_banco/19_contratacao_ciclo.sql`) e dos prompts 40 a 42. Substitui a janela antiga
"Nova empresa" (que só tinha o "Modelo da Orquestração") e a edição de preço espalhada em Empresa › Faturamento.
Protótipo aprovado: https://claude.ai/artifact/9hMzuq91REmNbhBT7yVA5o

```text
Console: CONTRATAÇÃO num componente só (ContratacaoEmpresa), usado em DOIS lugares: a janela "Nova empresa"
(Console › Empresas) e a aba nova "Contratação" de Console › Empresas › (empresa). Só a equipe Master edita
(perfis.equipe e papel admin); os outros não veem a aba. Não mude tabelas nem políticas.

1. NOVA EMPRESA: mantenha o que já cria a empresa e convida o Admin (nome, CNPJ, e-mail do Admin, função
   admin-usuarios). APAGUE da janela o bloco "Modelo da Orquestração" (Por contrato / Mensalidade fixa, preço,
   mínimo e vencimento) e os checkboxes de módulos: tudo isso passa a vir das seções abaixo. Não grave mais em
   planos_empresa. Layout do protótipo: seções numeradas à esquerda e, à direita (embaixo no celular), os
   cartões "Ciclo atual" e "Resumo" com o botão "Criar empresa" (ou "Salvar" na aba).

2. MOTOR CONTRATADO: dois botões grandes, MotorCob (quadrado #C9A35A "COB", "Cobrança") e MotorCli (quadrado
   #8E8E93 "CLI", "Jornada do Cliente"), marcáveis juntos. Pelo menos um ("A empresa precisa de pelo menos um
   motor."). Abaixo, a frase do login: só MotorCob → "No login, todos entram direto no MotorCob. O MotorCli fica
   fechado para esta empresa." (e o contrário); os dois → "No login, os usuários escolhem entre MotorCob e
   MotorCli". Salvar: rpc('salvar_frentes', { empresa, frentes: ['motorcob', ...] }). Ao abrir: empresa_frentes.

3. MÓDULOS: linhas com chave (switch) Mensageria, API e Enriquecimento; com a Mensageria ligada, chips SMS, RCS,
   E-mail, WhatsApp. Salvar: upsert em empresa_modulos (empresa_id, modulo, ativo, canais) onConflict
   "empresa_id,modulo". O motor de decisão ("orquestracao") é ligado pelo salvar_frentes; não mostre chave dele.

4. PREÇOS: lista só com os itens contratados (cobranca_itens sem preco_de, na ordem de "ordem"): grupo MOTOR
   com "contratos" (Orquestração, por contrato no ciclo; só com MotorCob) e "jornada_clientes" (Jornada, por
   cliente acionado no ciclo; só com MotorCli); grupo MENSAGERIA com os itens dos canais ligados (sms, email,
   rcs_*, whatsapp_*). Cada linha: nome, "por <unidade>" e o resumo do preço atual (precos_empresa vigente),
   ou "Sem preço" em vermelho. Tocar abre o editor embaixo (um aberto por vez):
   - Modelo em controle segmentado: Flat · Escalonado por faixa · Escalonado progressivo · Mensalidade (só nos
     itens do grupo MOTOR). Frase de ajuda de cada um (textos do protótipo).
   - Flat: "Preço por unidade (R$)" e "Mínimo por ciclo (R$)". Mensalidade: "Valor por ciclo (R$)".
   - Escalonado: lista de faixas "Até (quantidade)" + "Preço (R$)"; a última é "Acima de N" sem limite;
     "+ Faixa" e "×" para tirar (mínimo 2 faixas); limites crescentes; e o mínimo por ciclo.
   - "Simular volume no ciclo": calcula na tela o valor (faixa: o preço da faixa do volume × volume;
     progressivo: soma de cada faixa; aplica o mínimo) e mostra "R$ total · média R$ x".
   - Aceite vírgula ou ponto como decimal. Salvar: rpc('salvar_preco', { empresa, item, modelo, preco, minimo,
     faixas: [{ate, preco}, ..., {ate: null, preco}], vigente_desde }) com vigente_desde =
     rpc('competencia_de', { empresa, dia: hoje }) (o preço vale a partir do ciclo atual).
   O link "Histórico" de cada item continua mostrando as vigências (precos_empresa por item).

5. CICLO DE USO: "Dia de corte" (1 a 28; o 1 aparece como "Dia 1 (mês fechado)") e "Dia de vencimento" (1 a 28).
   Texto: "O uso conta do dia de corte até a véspera do corte no mês seguinte. A fatura fecha no fim do ciclo."
   Salvar: upsert em ciclo_empresa (empresa_id, dia_corte, vencimento_dia). Cartão "Ciclo atual":
   rpc('ciclo_atual', { empresa }) → Competência (mês por extenso), Uso (inicio a fim), Fatura fecha (fecha_em),
   Vence (vence_em), datas dd/mm/aaaa. Na janela Nova empresa (sem id ainda), calcule na tela com a mesma regra.

6. SALVAR / CRIAR: na ordem: (criar a empresa, se nova) → salvar_frentes → empresa_modulos → ciclo_empresa →
   salvar_preco de cada item alterado. Se algum item contratado ficar sem preço, não salve e mostre "Falta preço
   em: SMS, RCS Single." Sucesso: "Empresa criada. Convite enviado ao Admin da empresa." (ou "Contratação
   salva."). Erro do banco: mostre a mensagem e mantenha o que foi digitado.

7. EMPRESA › FATURAMENTO (cliente e equipe): a lista "Preços" vira só leitura com o link "Editar na Contratação"
   (só Master), e a prévia do mês passa a dizer "Ciclo de 21/09 a 20/10" (de ciclo_atual) em vez de "mês".

Confira em 1440 e 390px: criar empresa só MotorCli com SMS escalonado e corte 21; o login dela entra direto no
MotorCli; Faturamento mostra o ciclo 21 a 20; nenhum lugar fala mais em "Modelo da Orquestração".
```
