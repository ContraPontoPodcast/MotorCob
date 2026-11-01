"""Importador das gravações do discador do cliente (SQL 64).

  voz/importador/manifesto.py   leitura e validação estrita do manifesto (CSV ou JSON), chave da importação e as
                                regras de dado pessoal (CPF, telefone, e-mail, nome)
  voz/importador/fontes.py      de onde vêm os arquivos: envio pelo site (bucket gravacoes-discador), SFTP do
                                discador e HTTPS (lista de URLs); conferência do áudio
  voz/importador/rotina.py      a rodada do timer da VM: fontes pendentes → manifesto → par com a chamada do MotorCX
                                → bucket da empresa → voz_gravacoes → fila do Whisper; registro por arquivo

Funciona nos dois acessos da VM (voz/acesso.py): as mesmas RPCs pela chave do servidor ou pelas funções de voz_vm.
Credenciais só do Secret Manager, pela referência (segredo_ref). Rede e SFTP (paramiko) só na hora do uso.
"""
