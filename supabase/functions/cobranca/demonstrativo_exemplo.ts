// Demonstrativo de exemplo (dados fictícios), usado nos testes e para conferir o desenho do PDF.
import type { Dados } from "./demonstrativo.ts";

export const EXEMPLO: Dados = {
  fatura: { id: 1042, situacao: "aberta", competencia: "2026-10-01", ciclo_inicio: "2026-09-21", ciclo_fim: "2026-10-20",
            emitida_em: "2026-10-21T09:00:00Z", vencimento: "2026-10-25", valor_total: 4812.40 },
  prestador: { razao_social: "MotorCX Tecnologia Ltda (exemplo)", cnpj: "11444777000161", endereco: "São Paulo · SP", email: null },
  cliente: { razao_social: "Alfa Serviços de Cobrança Ltda", cnpj: "11222333000181",
             endereco: "Av. Paulista, 1000 · Bela Vista · São Paulo · SP · 01310-100" },
  frentes: ["motorcli", "motorcob"],
  itens: [
    { ordem: 1, item: "orquestracao", descricao: "Orquestração · contratos no ciclo", quantidade: 12500, preco: 0.24836, valor: 3104.50,
      grupo: "motor", modelo: "progressivo", minimo: 0, faixas: [{ ate: 10000, preco: 0.26 }, { ate: null, preco: 0.2018 }] },
    { ordem: 2, item: "jornada", descricao: "Jornada · clientes acionados no ciclo", quantidade: 1236, preco: 0.5, valor: 618,
      grupo: "motor", modelo: "flat", minimo: 0, faixas: null },
    { ordem: 10, item: "sms", descricao: "SMS · 14591 envios + 311 respostas", quantidade: 14902, preco: 0.068, valor: 1013.34,
      grupo: "mensageria", modelo: "faixa", minimo: 0, faixas: [{ ate: 10000, preco: 0.075 }, { ate: 50000, preco: 0.068 }, { ate: null, preco: 0.06 }] },
    { ordem: 11, item: "rcs_basic", descricao: "RCS Basic", quantidade: 2140, preco: 0.09, valor: 192.6, grupo: "mensageria", modelo: "flat", minimo: 0 },
    { ordem: 12, item: "rcs_single", descricao: "RCS Single", quantidade: 410, preco: 0.16, valor: 65.6, grupo: "mensageria", modelo: "flat", minimo: 0 },
    { ordem: 13, item: "email", descricao: "E-mail", quantidade: 3820, preco: 0.009, valor: 34.38, grupo: "mensageria", modelo: "flat", minimo: 50 },
    { ordem: 1013, item: "email_minimo", descricao: "E-mail · complemento do mínimo mensal", quantidade: 1, preco: 15.62, valor: 15.62,
      grupo: "mensageria", modelo: "flat", minimo: 50 },
  ],
  ajustes: [
    { tipo: "desconto", valor: 250, motivo: "implantação (combinado na contratação)" },
    { tipo: "credito", valor: 18.36, motivo: "instabilidade do SMS em 02/10" },
    { tipo: "cobranca_extra", valor: 36.72, motivo: "carga emergencial fora do horário" },
  ],
  carteiras: [
    { carteira: "Banco X", frente: "motorcob", contratos: 3598, clientes: 0, dias: 22 },
    { carteira: "Principal", frente: "motorcob", contratos: 8902, clientes: 0, dias: 26 },
    { carteira: "Relacionamento", frente: "motorcli", contratos: 0, clientes: 1236, dias: 30 },
  ],
  canais: [
    { canal: "email", disparadas: 3820, entregues: 3611, falhas: 209, respostas: 0 },
    { canal: "rcs", disparadas: 2550, entregues: 2433, falhas: 117, respostas: 96 },
    { canal: "sms", disparadas: 14591, entregues: 13902, falhas: 689, respostas: 311 },
  ],
  campanhas: [
    { origem: "Lista do dia (Orquestração)", canal: "sms", disparadas: 11208 },
    { origem: "Lista do dia (Orquestração)", canal: "rcs", disparadas: 1902 },
    { origem: "Lista do dia (Orquestração)", canal: "email", disparadas: 3120 },
    { origem: "Renegocia Outubro", canal: "sms", disparadas: 3383 },
    { origem: "Renegocia Outubro", canal: "rcs", disparadas: 648 },
    { origem: "Renegocia Outubro", canal: "email", disparadas: 700 },
  ],
};
