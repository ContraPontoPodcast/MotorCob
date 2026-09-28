-- Dado gravado antes da migração multiempresa (para testar que ele vai para a empresa 'legado').
insert into auth.users (email) values ('antigo@x.com');
update public.perfis set papel = 'admin' where email = 'antigo@x.com';
insert into public.estado_cliente (id_cliente,tag,safra,cluster_origem,cluster_atual,estado,canal)
    values ('L1','S260801-A1-LOC-ND-L0','2026-08-01','A1','A1','LOC','ND');
insert into public.execucoes (data_ref, status) values ('2026-09-20', 'ok');
