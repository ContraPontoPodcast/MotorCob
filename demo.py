"""Demo ponta a ponta com carteira sintética.

Como a carteira é simulada, sabemos a "verdade" (qual contato é do cliente) e
medimos três coisas:
1. a certificação acerta a titularidade?
2. a trava do WhatsApp barra quem não é o cliente?
3. o funil projetado bate com o que acontece quando o plano é executado?

Uso: python demo.py
"""
import csv
import random
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

from motor.certificacao import Evento, afinidade_canal, certificar_contatos, hit_rate_por_canal
from motor.priorizacao import funil_projetado, planejar
from motor.taxonomia import Nivel, classificar

HOJE = date(2026, 9, 25)
CUSTOS = {"discador": 0.35, "agente_voz": 0.12, "sms": 0.07, "whatsapp": 0.30, "rcs": 0.12, "email": 0.01}
PREF_BASE = {"discador": .25, "agente_voz": .15, "sms": .08, "whatsapp": .35, "rcs": .20, "email": .10}
SAIDA = Path("saida")


def gerar_carteira(rng, n_historico=500, n_novos=100):
    clientes, contatos = [], []
    for i in range(n_historico + n_novos):
        cpf = f"{i:011d}"  # CPF fictício
        pref = {c: min(0.9, p * rng.uniform(0.3, 1.7)) for c, p in PREF_BASE.items()}
        n_tel = rng.randint(1, 4)
        idx_titular = rng.randrange(n_tel) if rng.random() < 0.8 else None
        for t in range(n_tel):
            titular = t == idx_titular
            contatos.append({
                "cpf": cpf, "contato": f"119{rng.randint(10_000_000, 99_999_999)}", "tipo": "telefone",
                "titular": titular, "existe": titular or rng.random() > 0.15,
                "whatsapp": rng.random() < (0.75 if titular else 0.6),
            })
        for j in range(rng.randint(0, 2)):
            valido = rng.random() < 0.6
            contatos.append({"cpf": cpf, "contato": f"cliente{i}_{j}@exemplo.com", "tipo": "email",
                             "titular": valido, "existe": valido, "whatsapp": False})
        clientes.append({"cpf": cpf, "pref": pref, "novo": i >= n_historico})
    return clientes, contatos


def simular_resultado(rng, canal, c, pref):
    r = rng.random
    if canal in ("discador", "agente_voz"):
        if not c["existe"]:
            return "numero_inexistente"
        if r() > 0.35:
            return "nao_atendida"
        if c["titular"]:
            if r() < min(0.8, pref * 2.5):
                return "identidade_confirmada" if canal == "agente_voz" else "cpc"
            return "atendida_sem_cpc"
        return "atendida_terceiro_desconhece" if r() < 0.6 else "atendida_sem_cpc"
    if canal in ("sms", "rcs"):
        if not c["existe"]:
            return "nao_entregue"
        if c["titular"] and r() < pref:
            if canal == "rcs":
                return "identidade_confirmada" if r() < 0.3 else "interacao"
            return "acesso_portal_autenticado" if r() < 0.3 else "clique_link"
        return "entregue"
    if canal == "whatsapp":
        if not c["whatsapp"]:
            return "sem_conta"
        if not c["titular"]:
            x = r()
            return "desconhece" if x < 0.1 else "bloqueio" if x < 0.18 else "lido" if x < 0.4 else "entregue"
        if r() < pref:
            return "identidade_confirmada" if r() < 0.4 else "resposta"
        return "bloqueio" if r() < 0.02 else ("lido" if r() < 0.5 else "entregue")
    if canal == "email":
        if not c["existe"]:
            return "hard_bounce"
        if r() < 0.05:
            return "soft_bounce"
        if r() < pref:
            return "acesso_portal_autenticado" if r() < 0.1 else ("clique" if r() < 0.3 else "abertura")
        return "entregue"
    raise ValueError(f"canal desconhecido: {canal}")


def gerar_historico(rng, clientes, contatos):
    """Histórico 'pulverizado': canal e contato escolhidos sem critério, como hoje."""
    por_cpf = {}
    for c in contatos:
        por_cpf.setdefault(c["cpf"], []).append(c)
    eventos, seq = [], 0
    for cli in clientes:
        if cli["novo"]:
            continue
        for _ in range(rng.randint(3, 15)):
            c = rng.choice(por_cpf[cli["cpf"]])
            canal = rng.choice(["discador", "agente_voz", "sms", "whatsapp", "rcs"]) if c["tipo"] == "telefone" else "email"
            seq += 1
            eventos.append(Evento(cli["cpf"], c["contato"], c["tipo"], canal,
                                  simular_resultado(rng, canal, c, cli["pref"][canal]),
                                  HOJE - timedelta(days=rng.randint(1, 60)), CUSTOS[canal],
                                  fornecedor=f"forn_{canal}", id_externo=str(seq)))
    return eventos


def salvar_csv(nome, linhas):
    if not linhas:
        return
    SAIDA.mkdir(exist_ok=True)
    with open(SAIDA / nome, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(linhas[0].keys()))
        w.writeheader()
        w.writerows(linhas)


def main(seed=42, verbose=True):
    rng = random.Random(seed)
    out = print if verbose else (lambda *a, **k: None)
    clientes, contatos = gerar_carteira(rng)
    eventos = gerar_historico(rng, clientes, contatos)
    # Simula o mesmo arquivo de retorno importado duas vezes: o motor deduplica.
    eventos_importados = eventos + rng.sample(eventos, len(eventos) // 10)
    n_novos = sum(c["novo"] for c in clientes)
    out(f"Carteira: {len(clientes)} clientes ({n_novos} novos, sem histórico) | "
        f"{len(contatos)} contatos | {len(eventos)} eventos "
        f"(+{len(eventos_importados) - len(eventos)} duplicados na importação, descartados)\n")

    certs = certificar_contatos(eventos_importados, HOJE, contatos)
    hr = hit_rate_por_canal(eventos_importados)
    plano, bloqueios = planejar(certs, afinidade_canal(eventos_importados, hr, certs), CUSTOS)

    out("1. HIT RATE DA CARTEIRA (base do cold start)")
    for canal, r in sorted(hr.items(), key=lambda kv: -kv[1]["hit_rate"]):
        cpe = f"R$ {r['custo_por_engajado']:.2f}" if r["custo_por_engajado"] else "-"
        out(f"   {canal:<11} tentativas {r['tentativas']:>4} | hit rate {r['hit_rate']:>6.1%} "
            f"| certificação {r['taxa_certificacao']:>5.1%} | custo/engajado {cpe}")

    verdade = {(c["cpf"], c["contato"]): c for c in contatos}
    out("\n2. QUALIDADE DA CERTIFICAÇÃO (vs. verdade simulada)")
    qualidade = {}
    for status in ("CERTIFICADO", "PROVAVEL", "NAO_CONFIRMADO", "CONTESTADO", "INVALIDO", "DESCONHECIDO"):
        grupo = [k for k, v in certs.items() if v.status == status]
        if grupo:
            acerto = sum(verdade[k]["titular"] for k in grupo) / len(grupo)
            qualidade[status] = acerto
            out(f"   {status:<15} {len(grupo):>4} contatos | {acerto:>4.0%} realmente do cliente")

    zap = [b for b in bloqueios if b[2] == "whatsapp" and b[3].startswith("risco de banimento")]
    zap_ok = [a for a in plano if a["canal"] == "whatsapp"]
    fora_zap = sum(not verdade[(b[0], b[1])]["titular"] for b in zap) / len(zap) if zap else 0
    erro_zap = sum(not verdade[(a["cpf"], a["contato"])]["titular"] for a in zap_ok)
    out(f"\n3. TRAVA DO WHATSAPP\n   barrados por risco de banimento: {len(zap)} "
        f"({fora_zap:.0%} de fato NÃO eram do cliente)\n"
        f"   liberados: {len(zap_ok)} | desses, não eram do cliente: {erro_zap}")

    funil = funil_projetado(plano, len(clientes))
    out("\n4. FUNIL PROJETADO (1ª ação por cliente)")
    for k, v in funil.items():
        out(f"   {k}: {v}")

    # Executa a 1ª ação de cada cliente contra a verdade e compara com a projeção.
    prefs = {c["cpf"]: c["pref"] for c in clientes}
    real = Counter()
    for a in (a for a in plano if a["ordem"] == 1):
        res = simular_resultado(rng, a["canal"], verdade[(a["cpf"], a["contato"])], prefs[a["cpf"]][a["canal"]])
        nivel = classificar(a["canal"], res).nivel
        real["engajou"] += nivel >= Nivel.ENGAJADO
        real["certificou"] += nivel == Nivel.CERTIFICADO
    out(f"\n5. PROJETADO x REALIZADO (1ª ação executada na carteira simulada)\n"
        f"   contatos: projetado {funil['contatos_esperados']} | realizado {real['engajou']}\n"
        f"   certificações (CPC/identidade/portal): realizado {real['certificou']} "
        f"| CPC projetado {funil['cpc_esperado']}")

    salvar_csv("certificacao_contatos.csv", [
        {"cpf": c.cpf, "contato": c.contato, "tipo": c.tipo, "status": c.status, "score": c.score,
         "tentativas": c.tentativas, "restricoes": ";".join(sorted(c.restricoes))} for c in certs.values()])
    salvar_csv("hit_rate_carteira.csv", [{"canal": k, **v} for k, v in hr.items()])
    salvar_csv("plano_acionamento.csv", plano)
    salvar_csv("bloqueios.csv", [dict(zip(("cpf", "contato", "canal", "motivo"), b)) for b in bloqueios])
    out(f"\nArquivos gerados em ./{SAIDA}/")
    return {"qualidade": qualidade, "funil": funil, "real": real, "whatsapp_erro": erro_zap}


if __name__ == "__main__":
    main()
