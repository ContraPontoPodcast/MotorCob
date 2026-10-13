# Prompt Horizons — Site motorcli.online (parte B): cuidado, plataforma, segurança, perguntas, contato e rodapé

Cole depois da parte A e de conectar o Supabase no projeto (veja o LEIA desta pasta).

```text
Continuação do site do MotorCli, depois de "Como funciona". Mesmo estilo da parte A. Continua sem login.

1. CUIDADO COM O CLIENTE (#cuidado, fundo branco): olho "Cuidado com o cliente", "Mais resultado" + cinza "com
   menos mensagem." 8 itens em 4 colunas (1 no celular), cada um com linha fina em cima, título 15px 600 e
   texto 14px cinza: Uma conversa por dia (No máximo uma ação por cliente por dia, no momento mais
   importante.) · 48 horas de respiro (Espera entre ações; o lembrete de vencimento é a única exceção.) · Um
   passo por vez (Domingo ou feriado não perde o passo: ele sai no próximo dia útil.) · Quem sai, sai
   (Descadastro e número inválido saem sozinhos de todos os momentos.) · WhatsApp com cuidado (Só em número
   confirmado, para não arriscar o seu canal.) · Melhor canal com evidência (O canal muda quando o resultado da
   sua base mostra, não por palpite.) · Sem oferta para quem deve (Cliente em atraso sai da jornada e vai para
   a cobrança.) · Você no controle (Ligue, desligue e ajuste cada momento na plataforma.)

2. PLATAFORMA (#plataforma, seção preta): olho "Plataforma MotorCX", "Uma plataforma, duas frentes." + cinza
   "O MotorCli com as telas da jornada." 6 cartões #1C1C1E (3 colunas): Início da jornada (Quantos clientes em
   cada momento hoje e quem ficou de fora, por motivo.) · Lista do dia (ID do cliente, momento, passo e canal.
   Um arquivo por canal para baixar.) · Momentos da jornada (Liga, desliga e muda dias, canais e o "senão" de
   cada passo.) · Mensageria (SMS, RCS e e-mail saindo da plataforma, com funil e respostas.) · Assistente
   MotorCX (Pergunte como fazer qualquer coisa: ele explica e leva à tela certa.) · Uma conta, duas frentes
   (Quem usa o MotorCob e o MotorCli escolhe a frente no login.)

3. SEGURANÇA E LGPD (#seguranca): "Feito para dado sensível" + cinza "desde a primeira linha." 4 itens: Telas
   sem dado pessoal (Só o ID do cliente; nunca CPF ou nome.) · Isolamento por empresa (Cada empresa só enxerga
   a própria base.) · IA sem dado pessoal (CPF, telefone e e-mail são apagados antes.) · Permissões e auditoria
   (Perfis por frente e o histórico de quem mudou o quê.)

4. PERGUNTAS FREQUENTES (abre e fecha, um por vez, "+" à direita): O que é o MotorCli? (A frente de Jornada do
   Cliente do MotorCX: decide a conversa de cada cliente nos momentos de boas-vindas, ativação,
   pré-vencimento, retenção e reativação.) · Qual a diferença para o MotorCob? (O MotorCob cuida de quem está
   em atraso; o MotorCli, de quem está em dia. A inteligência, a plataforma e a segurança são as mesmas, e a
   mesma conta acessa as duas frentes.) · Preciso da Mensageria? (Não. A Lista do dia sai em um arquivo por
   canal para o fornecedor que você já usa. Com a Mensageria, os envios saem da própria plataforma.) · Que
   dados preciso enviar? (Dois arquivos: clientes — data de contratação, próximo vencimento, se pagou, se
   ativou e a última atividade — e contatos. A tela oferece um modelo pronto.) · Posso mudar os momentos e os
   passos? (Sim. Cada momento pode ser ligado ou desligado, e os dias, canais e o "senão" de cada passo são
   ajustáveis na plataforma.)

5. CONTATO (#contato, fundo cinza claro, 2 colunas): "Mostre a sua base." + cinza "A gente mostra as conversas
   que faltam nela." e "Retornamos em até 1 dia útil." Formulário: Nome* · E-mail corporativo* · Empresa ·
   Telefone · Área (CX e relacionamento, Crédito, Marketing, Outra) · caixa obrigatória "Concordo em ser
   contatado sobre o MotorCli". Enviar: supabase.from('contatos_site').insert({ nome, empresa, email, telefone,
   mensagem: 'MotorCli · Área: ' + area, consentimento: true, origem: 'motorcli' }) SEM .select().
   Sucesso: "Recebemos. Retornamos em até 1 dia útil." e limpa. Erro: "Não foi possível enviar agora. Tente
   de novo em alguns minutos." Valide nome (2+ letras) e e-mail antes de enviar; botão desabilitado enquanto envia.
   Use SOMENTE a chave pública (anon) do Supabase.

6. ENTRAR: todos os links "Entrar" e "Entrar na plataforma" abrem
   https://motorcob.online/login?frente=motorcli na mesma aba. Guarde esse endereço numa constante só
   (URL_PLATAFORMA), porque ele vai mudar quando o domínio do MotorCX existir.

7. RODAPÉ (#1D1D1F, 4 colunas): MotorCli — "Jornada do Cliente. Uma frente do MotorCX." © 2026 · MotorCli
   (Momentos, Como funciona, Plataforma) · MotorCX (MotorCob · Cobrança → https://motorcob.online, Entrar na
   plataforma) · Empresa (Segurança e LGPD, Contato).

8. SEO: meta description "MotorCli, a frente de Jornada do Cliente do MotorCX: boas-vindas, ativação,
   pré-vencimento, retenção e reativação no canal e no momento certos." Open Graph com o mesmo título e texto.
   NÃO mostre logos de clientes, números de resultado reais ou depoimentos.

Confira em 1440, 1024 e 390px: sem rolagem lateral; o formulário grava e mostra a mensagem de sucesso.
```
