## Criação Framework

     Avaliar de forma objetiva, padronizada a maturidade e a confiabilidade do CMDB como base para
     evolução de ITOM, aplicando critérios técnicos claros de GO / NO-GO, alinhados às boas práticas
     da ServiceNow e ao CSDM, sem dependência de percepção subjetiva ou customizações locais.

### [v2] — adiciona: controle de escrita (carga manual / bypass de IRE), Health profundo
(pior dimensão + staleness + duplicates + orphans + classe genérica) e governança de Reconciliation (precedência / autoritativo).

### [v3] — correções de fidelidade (não estouram; corrigem veredito errado por tabela/campo):
- Reconciliation: detecção da tabela entre candidatos (cmdb_reconciliation_rule / mdb_data_source_for_attribute / cmdb_reconciliation_definition) + guarda de 'active'.
- Staleness: usa last_discovered como sinal de descoberta (fallback sys_updated_on),
    pois sys_updated_on é tocado por qualquer Business Rule e mascara o stale.
- IRE: cobertura medida em cmdb_ci_server / cmdb_ci_appl / cmdb_ci_service_discovered
    (classes com identidade técnica), não em business/application service.
- Write control: exclui retirados (install_status=7) e separa origem vazia de manual real
    (ServiceNow); só manual real (>=30%) dispara FAIL — evita falso-positivo por source vazio.
     VALIDAR no dicionário da instância: nomes de tabela de reconciliation e existência de
     last_discovered nas classes-alvo.

### [v4] — robustez de execução em Background Script (sem virar Script Include):
- runAll com isolamento de falha (try/catch por seção): exceção numa seção não aborta as
       demais; falha de execução marca o domínio como FAIL (não afirma PASS sem ter rodado).
       Corrige o sintoma "Health não rodou" (era vítima de throw/timeout upstream).
- runCredentials: troca o full scan de discovery_log por GlideAggregate (used) + query
       limitada para erros de auth — elimina a causa nº1 de transaction timeout.
- runCMDBWriteControl: pré-carrega contas web_service_access_only uma vez (sem sys_user.get
       por criador).
- info/warn/error espelham em gs.print -> output visível no painel do Background Script
       (antes só ia para syslog). Protegido para não quebrar se rodar in-scope.
- Footer de execução no fim do arquivo: new CMDBBaselineDiagnostic().runAll();
     EXECUTAR em escopo GLOBAL.

### [v5] correções a partir do log real (gruponcdev):
- Removido o gs.print mirror do v4: o runner moderno (sys.scripts.modern.do) JÁ ecoa
       gs.info/warn/error no painel -> mirror duplicava 100% da saída. Agora 1 linha por evento.
- Health: probe AUTO-DESCOBERTO de tabela/campo (cmdb_health_score [Xanadu+] /
       cmdb_health_result / cmdb_health_metric), com detecção de tabela VAZIA (= CMDB Health
       Dashboard Jobs desativados/nunca executados) e SCHEMA DUMP de campos numéricos para
       travar o nome de campo por instância. Corrige o "dimensão NÃO medida".

### [v6] auditoria completa de fidelidade do veredito (corrige falso-WARN/falso-FAIL):
- CSDM: classes corrigidas. cmdb_ci_business_service/cmdb_ci_application_service NÃO existem OOB
       (geravam "MODELO AUSENTE" eterno). Reais: cmdb_ci_business_app, cmdb_ci_service_discovered/
       _auto/_by_tags; genérico medido no base cmdb_ci_service. Detecta existência+uso real.
- IRE: cobertura por HERANÇA (classChain via sys_db_object.super_class). O identifier OOB de
       cmdb_ci_hardware cobre cmdb_ci_server por herança; match exato dava falso "SEM REGRA".
       Campo de classe do identifier auto-detectado (applies_to/ci_type/table).
- Reconciliation: campo autoritativo auto-detectado (authoritative/is_authoritative); só
       acusa "sem autoritativo" se o campo existir e estiver zerado (senão é indeterminado).
- Credenciais: filtro de erro por FRASES de falha reais (não 'LIKE auth', que casava
       "authentication successful" -> falso PERIGOSA/FAIL).
- RESULT movido para initialize() (por instância; antes era objeto compartilhado no prototype).
-  Staleness: flag opcional COUNT_NULL_AS_STALE (default false) para CIs nunca descobertos.
