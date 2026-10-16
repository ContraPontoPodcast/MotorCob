# Auditorias de UX (14/10) — resumo para o bloco 5

## Transversal (P1)
- (i) só existe em mensageria-painel e campanha-detalhe (componente info-button só com métricas de funil). Transformar em glossário geral.
- Estados com 3–4 nomes: LOC (Cliente novo/Localização/Não localizado/Novo), NCP (Não CPC/Giro/"Não localizado"!), CPA (CPC A/Negociação), CPB (CPC B/Tentativas), PRE, COL (Colchão), QBR, BLQ. Proposta: Cliente novo · Não CPC · CPC A · CPC B · Acordo: antes do vencimento · Acordo em dia · Acordo: parcela vencida · Quitado · Bloqueado.
- Cluster × Segmento; Fase × Etapa × Estágio × Momento × Faixa; Credor × Carteira; HOT/Hot → "Principal"; Lista do dia × Fila × Ações de hoje; Agente virtual × voz; Fallback × senão; Templates × Modelos × Frases; Lotes do dia × de hoje; Não entregues × Falhas; Membros × Usuários da empresa; marca MotorCob × MotorCX × MotorCli; regras de senha divergentes em 3 telas; CPC com 3 sentidos (Docs diz "clicou no link de pagamento").
- Formatos: Credores aceita CSV/TXT/XLSX, Envios só CSV. Separador ";" (Personas) × "," (Clusters).
- Códigos crus: G-dia3, RE, TAG da linha do tempo do cliente (CPA…), status de envio (pendente/processado/erro), motivos de retirada (quitacao: 12), motivos de lote do fornecedor, A1…B3, "fim_janela", id da etapa, prefixos de alerta "BANCO:", "MAPEAMENTO:".
- Mensagens técnicas ao cliente: Reenquadrar "confira se o Mac está ligado e a vigia ativa (scripts/diagnostico.sh)"; erros crus do banco na Contratação; relatorio.erro em Envios.
- Gírias: "oxigenados", "Colchão", "estoque", "base bruta", "playbook", "raia", "Rich card", "Slug", "Workspace", "frente" (login).

## Por tela (principais)
Início: CPC sem (i); legenda HOT/INVÁLIDO em caixa alta; economia por rodada só em title.
Mapa: esteira/etapa/canal da vez sem (i); RE cru; reserva; safra.
Lista do dia: motivos curtos ("sem ação na raia", "só bureau"); "Lista anterior à separação por estratégia".
Orquestração: segmento/raia/faixa/público geral/Demais clientes/playbook sem (i); selos "Sua"/"off" → Personalizada/Desligada; "Fase do motor" → "Fase da cobrança"; carência/baixa/estoque.
Estratégia: score/certificação; Sempre/Junto/Senão/Reserva no resumo.
Clusters: A1…B3 sem legenda; form "Cluster" com botão "Excluir segmento".
Personas: ★/☆, maturidade, Digital/Analógico.
Canais/Credor: DLR, bounce, UNDELIV/REJECTD/DELIVRD, suspensão escalonada.
Clientes: TAG crua; "Cliente" × "Extrato do cliente".
Envios: status enum cru; tipo "Base".
Mensageria: Simulação × Envio real sem (i); "Confirme o layout" → "Confira as colunas"; fallback → "SMS se o RCS não chegar"; Rastrear links; Centro de custo; categorias de template; Radar, IA/Regras, Assumir; categorias de resposta; "Favoritos" → "Números de teste e da equipe"; exemplo com palavrão.
Workspace: COB/CLI sem legenda; menu com jargão (dar subtítulo); perfis sem descrição.
Empresa: Flat/Escalonado/Competência/Dia de corte → Preço único/Preço por faixa/Mês de referência/Dia de fechamento; links para abas que não existem.
Conta: Escopos/Revogar; link "Usuários e permissões" inexistente.
Login: "Escolha a frente" → "Escolha a área"; erro do segundo fator.

## Glossário (termos): CPC, CPC A/B, Não CPC, Cliente novo, Preventivo, Quebra, Carência, Quitado, Bloqueado, Principal (Hot), Credor/carteira, Carga (geral/incremental/retirada/baixa/ocorrência), Rotina, Lista do dia, Esteira, Fase, Régua, Segmento (cluster), Segmento padrão (valor × atraso), Demais clientes, Persona, Raia, Público geral, Estratégia, Playbook, Canal da vez/Junto/Senão/Reserva, Enriquecimento, Reenquadrar, Travas, Não Perturbe, Freio do WhatsApp, Orçamento do canal, Safra, D-n/D0/D+n, Lote, Campanha, Higienização, Disparado/Enviado/Entregue, Confirmação de entrega (DLR), Bounce, Descadastro, Template, Radar, CPC Negócio, Centro de custo, Simulação/Envio real, Área (Cobrança/Jornada), RCS (Basic/Single/Conversacional), Token/Escopo, Ciclo/Recarga, Plano de rota, Produto.
