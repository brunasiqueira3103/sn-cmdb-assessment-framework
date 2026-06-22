var CMDBBaselineDiagnostic = Class.create();
CMDBBaselineDiagnostic.prototype = {

    initialize: function() {
        // v6: RESULT por INSTÂNCIA (antes era objeto no prototype -> estado compartilhado
        // entre instâncias/execuções na mesma transação). Reset garantido a cada new.
        this.RESULT = {
            probes: 'PASS',
            sensors: 'PASS',
            writecontrol: 'PASS',
            schedules: 'PASS',
            credentials: 'PASS',
            ire: 'PASS',
            reconciliation: 'PASS',
            health: 'PASS',
            csdm: 'PASS'
        };
    },

    /***********************************************************
     REGRA DE OURO DO FRAMEWORK:
     FAIL = bloqueia evolução
     WARN = permite evolução com contenção
     PASS = pode seguir

     Avaliar de forma objetiva, padronizada a maturidade e a confiabilidade do CMDB como base para
     evolução de ITOM, aplicando critérios técnicos claros de GO / NO-GO, alinhados às boas práticas
     da ServiceNow e ao CSDM, sem dependência de percepção subjetiva ou customizações locais.

     v2 — adiciona: controle de escrita (carga manual / bypass de IRE), Health profundo
     (pior dimensão + staleness + duplicates + orphans + classe genérica) e governança de
     Reconciliation (precedência / autoritativo).

     v3 — correções de fidelidade (não estouram; corrigem veredito errado por tabela/campo):
     - Reconciliation: detecção da tabela entre candidatos (cmdb_reconciliation_rule /
       cmdb_data_source_for_attribute / cmdb_reconciliation_definition) + guarda de 'active'.
     - Staleness: usa last_discovered como sinal de descoberta (fallback sys_updated_on),
       pois sys_updated_on é tocado por qualquer Business Rule e mascara o stale.
     - IRE: cobertura medida em cmdb_ci_server / cmdb_ci_appl / cmdb_ci_service_discovered
       (classes com identidade técnica), não em business/application service.
     - Write control: exclui retirados (install_status=7) e separa origem vazia de manual real
       (ServiceNow); só manual real (>=30%) dispara FAIL — evita falso-positivo por source vazio.
     VALIDAR no dicionário da instância: nomes de tabela de reconciliation e existência de
     last_discovered nas classes-alvo.

     v4 — robustez de execução em Background Script (sem virar Script Include):
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

     v5 — correções a partir do log real (gruponcdev):
     - Removido o gs.print mirror do v4: o runner moderno (sys.scripts.modern.do) JÁ ecoa
       gs.info/warn/error no painel -> mirror duplicava 100% da saída. Agora 1 linha por evento.
     - Health: probe AUTO-DESCOBERTO de tabela/campo (cmdb_health_score [Xanadu+] /
       cmdb_health_result / cmdb_health_metric), com detecção de tabela VAZIA (= CMDB Health
       Dashboard Jobs desativados/nunca executados) e SCHEMA DUMP de campos numéricos para
       travar o nome de campo por instância. Corrige o "dimensão NÃO medida".

     v6 — auditoria completa de fidelidade do veredito (corrige falso-WARN/falso-FAIL):
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
     - Staleness: flag opcional COUNT_NULL_AS_STALE (default false) para CIs nunca descobertos.
    ************************************************************/

    rule: 'FAIL bloqueia evolução | WARN permite evolução com contenção | PASS pode seguir',

    /* =========================================================
       UTILITÁRIOS PADRÃO
       ========================================================= */
    // v5: SEM gs.print mirror. O runner moderno (sys.scripts.modern.do) já ecoa
    // gs.info/warn/error no painel como "*** Script:". Espelhar duplicava cada linha.
    info: function(msg) {
        gs.info('[INFO] ' + msg);
    },
    warn: function(msg) {
        gs.warn('[WARN] ' + msg);
    },
    error: function(msg) {
        gs.error('[FAIL] ' + msg);
    },

    section: function(title) {
        this.info('===================================================');
        this.info('>>> ' + title);
        this.info('===================================================');
    },

    // FALTAVA no original — runCredentials/runIRE/etc chamavam this.subsection sem definição.
    subsection: function(title) {
        this.info('--- ' + title + ' ---');
    },

    tableExists: function(table) {
        return new GlideRecord(table).isValid();
    },

    fieldExists: function(table, field) {
        var gr = new GlideRecord(table);
        return gr.isValid() && gr.isValidField(field);
    },

    /* =========================================================
       RESULTADOS CONSOLIDADOS (CONTRATO DE DECISÃO)
       RESULT é inicializado por instância em initialize() (v6).
       ========================================================= */
    setResult: function(area, status) {
        if (this.RESULT[area] !== 'FAIL') {
            this.RESULT[area] = status;
        }
    },

    // v6: cadeia de herança de uma classe (a própria + ancestrais até cmdb_ci/raiz),
    // via sys_db_object.super_class. Usado para avaliar cobertura herdada (IRE).
    classChain: function(table) {
        var chain = [];
        var name = table, guard = 0;
        while (name && guard++ < 40) {
            chain.push(name);
            var o = new GlideRecord('sys_db_object');
            if (!o.get('name', name)) break;
            var sup = o.getValue('super_class'); // sys_id -> sys_db_object
            if (!sup) break;
            var p = new GlideRecord('sys_db_object');
            if (!p.get(sup)) break;
            name = p.getValue('name');
        }
        return chain;
    },

    // v6: detecta o primeiro campo existente entre candidatos (evita hardcode frágil por release).
    firstField: function(table, candidates) {
        for (var i = 0; i < candidates.length; i++) {
            if (this.fieldExists(table, candidates[i])) return candidates[i];
        }
        return null;
    },

    /* =========================================================
       1) DISCOVERY | PROBES (LEGADO)
       COMO: GlideRecord em discovery_probe (active=true), se a tabela existir.
       POR QUÊ: probe/sensor é o modelo de coleta pré-pattern; probe ativo indica
       coleta fora do pipeline atual (Pattern/IRE) — sinal de legado a aposentar.
       ========================================================= */
    runProbes: function() {
        this.section('DISCOVERY | PROBES (LEGADO)');
        this.info(this.rule);

        if (!this.tableExists('discovery_probe')) {
            this.info('PASS: Probes legados não existem.');
            return;
        }

        var gr = new GlideRecord('discovery_probe');
        gr.addQuery('active', true);
        gr.query();

        if (gr.hasNext()) {
            this.warn('WARN: Probes legados ativos detectados.');
            this.setResult('probes', 'WARN');
        } else {
            this.info('PASS: Nenhum Probe legado ativo.');
        }
    },

    /* =========================================================
       2) DISCOVERY | SENSORS (LEGADO)
       COMO: conta discovery_sensor active=true (getRowCount).
       POR QUÊ: sensor legado escreve direto no CMDB sem passar pelo IRE — bypass de
       identificação/reconciliação que gera duplicatas e identidade não confiável.
       ========================================================= */
    runSensors: function() {
        this.section('DISCOVERY | SENSORS (LEGADO)');
        this.info(this.rule);

        if (!this.tableExists('discovery_sensor')) {
            this.info('PASS: Sensors legados não existem.');
            return;
        }

        var gr = new GlideRecord('discovery_sensor');
        gr.addQuery('active', true);
        gr.query();

        var count = gr.getRowCount();
        if (count > 0) {
            this.warn('WARN: Sensors ativos escrevendo direto no CMDB (' + count + ').');
            this.setResult('sensors', 'WARN');
        } else {
            this.info('PASS: Nenhum Sensor legado ativo.');
        }
    },

    /* =========================================================
       3) CMDB | CONTROLE DE ESCRITA (CARGA MANUAL / BYPASS DE IRE)   [NOVO]
       COMO: GlideAggregate de cmdb_ci por discovery_source (exclui install_status=7),
       separando governada (Discovery/SM), manual (ServiceNow), sem origem (vazio) e a
       revisar; cruza com sys_transform_map->cmdb_ci e contas web_service_access_only.
       POR QUÊ: tudo que escreve fora de Discovery/IRE compromete a CMDB como fonte de
       verdade; mede o quanto da base entra sem identificação/reconciliação governada.
       ========================================================= */
    runCMDBWriteControl: function() {
        this.section('CMDB | CONTROLE DE ESCRITA | FONTES & CARGA MANUAL');
        this.info(this.rule);

        // fontes governadas legítimas — AJUSTE por ambiente (inclua seus SGC aqui)
        var GOVERNED = { 'Discovery': true, 'Service Mapping': true };

        this.subsection('1) Origem de escrita dos CIs (discovery_source) — exclui retirados (install_status=7)');

        var total = 0, manualSN = 0, emptySrc = 0, governed = 0, ungoverned = 0;
        var ga = new GlideAggregate('cmdb_ci');
        ga.addQuery('install_status', '!=', 7);
        ga.addAggregate('COUNT');
        ga.groupBy('discovery_source');
        ga.query();

        while (ga.next()) {
            var src = ga.getValue('discovery_source') || '';
            var c = parseInt(ga.getAggregate('COUNT'), 10);
            total += c;
            if (src === '') {
                emptySrc += c;
                this.warn('SEM ORIGEM | (vazio) = ' + c);
            } else if (src === 'ServiceNow') {
                manualSN += c;
                this.warn('MANUAL (UI/import) | ServiceNow = ' + c);
            } else if (GOVERNED[src]) {
                governed += c;
                this.info('GOVERNED | ' + src + ' = ' + c);
            } else {
                ungoverned += c;
                this.info('REVISAR FONTE | ' + src + ' = ' + c);
            }
        }

        // 'manuais' (linha de resumo) = manual real (ServiceNow) + sem origem — string consumida pelo console
        var manual = manualSN + emptySrc;
        var pctManual = total > 0 ? Math.round(manual / total * 100) : 0;
        var pctManualHard = total > 0 ? Math.round(manualSN / total * 100) : 0; // só ServiceNow pesa no FAIL
        var pctEmpty = total > 0 ? Math.round(emptySrc / total * 100) : 0;
        this.info('CIs totais: ' + total + ' | manuais: ' + manual + ' (' + pctManual + '%) | fontes a revisar: ' + ungoverned);
        this.info('Detalhe origem: vazia ' + emptySrc + ' (' + pctEmpty + '%) | ServiceNow/manual ' + manualSN + ' (' + pctManualHard + '%) | governada ' + governed);

        this.subsection('2) Transform Maps escrevendo direto em cmdb_ci (bypass potencial de IRE)');

        var tmList = [];
        if (this.tableExists('sys_transform_map')) {
            var tm = new GlideRecord('sys_transform_map');
            tm.addQuery('target_table', 'STARTSWITH', 'cmdb_ci');
            tm.addQuery('active', true);
            tm.query();
            while (tm.next()) {
                tmList.push(tm.getValue('name') + ' -> ' + tm.getValue('target_table'));
            }
        }
        this.info('Transform Maps ativos em cmdb_ci: ' + tmList.length);
        for (var i = 0; i < tmList.length; i++) {
            this.warn('TM BYPASS? | ' + tmList[i]);
        }

        this.subsection('3) Escrita por contas de integração (Table API / REST)');

        var creators = {};
        var gac = new GlideAggregate('cmdb_ci');
        gac.addAggregate('COUNT');
        gac.groupBy('sys_created_by');
        gac.query();
        while (gac.next()) {
            creators[gac.getValue('sys_created_by')] = parseInt(gac.getAggregate('COUNT'), 10);
        }

        // v4: pré-carrega contas de integração UMA vez (evita sys_user.get por criador)
        var wsa = {};
        var wu = new GlideRecord('sys_user');
        wu.addQuery('web_service_access_only', true);
        wu.query();
        while (wu.next()) wsa[wu.getValue('user_name')] = true;

        var intWrites = 0;
        for (var user in creators) {
            if (!user || user === 'system' || user === 'guest') continue;
            if (wsa[user]) {
                intWrites += creators[user];
                this.warn('INTEGRACAO ESCREVEU | ' + user + ' = ' + creators[user] + ' CIs');
            }
        }
        this.info('CIs criados por contas de integração: ' + intWrites);

        this.subsection('4) Resultado do bloco');

        if (pctManualHard >= 30) {
            this.error('Resultado: FAIL - carga manual real (ServiceNow) dominante (' + pctManualHard + '%) na CMDB');
            this.setResult('writecontrol', 'FAIL');
        } else if (pctManualHard >= 15 || pctEmpty >= 20 || tmList.length > 0 || intWrites > 0) {
            this.warn('Resultado: WARN - escrita fora do pipeline governado (manual ' + pctManualHard + '% / sem-origem ' + pctEmpty + '% / TM ' + tmList.length + ' / integração ' + intWrites + ')');
            this.setResult('writecontrol', 'WARN');
        } else {
            this.info('Resultado: PASS - escrita sob controle do IRE/Discovery');
        }
    },

    /* =========================================================
       4) DISCOVERY | SCHEDULES
       COMO: conta discovery_schedule ativos e cruza efetividade com discovery_status
       (execuções nos últimos 7 dias via gs.daysAgoStart).
       POR QUÊ: sem schedule ativo a CMDB não se atualiza (staleness garantido);
       schedule ativo sem execução recente é efetividade não comprovada (WARN).
       ========================================================= */
    runDiscoverySchedules: function() {
        this.section('DISCOVERY | SCHEDULES');
        this.info(this.rule);

        var gr = new GlideRecord('discovery_schedule');
        gr.addActiveQuery();
        gr.query();

        var count = gr.getRowCount();
        if (count === 0) {
            this.error('FAIL: Nenhum Discovery Schedule ativo.');
            this.setResult('schedules', 'FAIL');
            return;
        }
        this.info('PASS: Discovery Schedules ativos (' + count + ').');

        // reforço opcional: cruzar efetividade com discovery_status (últimos 7 dias)
        if (this.tableExists('discovery_status')) {
            var ds = new GlideRecord('discovery_status');
            ds.addQuery('sys_created_on', '>', gs.daysAgoStart(7));
            ds.query();
            this.info('Execuções de Discovery nos últimos 7 dias: ' + ds.getRowCount());
            if (ds.getRowCount() === 0) {
                this.warn('WARN: Schedules ativos sem execução recente (efetividade não comprovada).');
                this.setResult('schedules', 'WARN');
            }
        }
    },

    /* =========================================================
       5) DISCOVERY | CREDENCIAIS (INVENTÁRIO + CLASSIFICAÇÃO)
       COMO: inventaria discovery_credentials active=true e cruza uso real com
       discovery_log.credential (se o campo existir); marca erro quando a mensagem
       contém auth/denied. Sem fonte de uso, classifica como INDETERMINADA (honesto).
       POR QUÊ: credencial morta = ruído operacional; credencial com auth failure =
       risco de segurança e de coleta. Não afirmar viva/morta sem evidência evita
       falso-positivo/negativo (bug histórico de uso não avaliável).
       ========================================================= */
    runCredentials: function() {
        this.section('DISCOVERY | CREDENCIAIS | CLASSIFICAÇÃO');
        this.info(this.rule);

        this.subsection('1) Inventário de credenciais ativas');

        var creds = {};
        var stats = { total: 0, alive: 0, dead: 0, dangerous: 0, indeterminate: 0 };
        var lists = { alive: [], dead: [], dangerous: [], indeterminate: [] };

        var cgr = new GlideRecord('discovery_credentials');
        cgr.addQuery('active', true);
        cgr.query();

        while (cgr.next()) {
            stats.total++;
            creds[cgr.sys_id.toString()] = {
                name: cgr.getValue('name'),
                used: false,
                error: false
            };
        }

        this.info('Credenciais ativas encontradas: ' + stats.total);

        this.subsection('2) Análise de uso real em Discovery');

        // -----------------------------------------------------------------
        // BUG HISTÓRICO (corrigido): a classificação depende da flag 'used'.
        //  - init used:true  -> nada vira MORTA (não há código que zere) => TUDO VIVO (falso-positivo)
        //  - init used:false -> só vira VIVA quem aparece no discovery_log
        // Mas se discovery_log.credential NÃO existe (caso desta instância),
        // o loop abaixo nem roda => TUDO viraria MORTA (falso-negativo espelhado).
        // Solução: só classificamos viva/morta quando há FONTE DE USO.
        // Sem fonte, o estado honesto é INDETERMINADA (não dá para provar uso).
        // -----------------------------------------------------------------
        var usageAssessable = this.fieldExists('discovery_log', 'credential');

        if (usageAssessable) {
            // v4: 'used' por agregação (não itera o discovery_log inteiro -> evita timeout)
            var lg = new GlideAggregate('discovery_log');
            lg.addNotNullQuery('credential');
            lg.addAggregate('COUNT');
            lg.groupBy('credential');
            lg.query();
            while (lg.next()) {
                var cidU = lg.getValue('credential');
                if (creds[cidU]) creds[cidU].used = true;
            }

            // v6: erro de auth por FRASES DE FALHA reais (não 'LIKE auth', que casava
            // "authentication successful"/"authorized" -> falso PERIGOSA). addOrCondition
            // mantém o grupo OR agrupado e ANDado com credentialISNOTEMPTY (sem OR-escape).
            var elg = new GlideRecord('discovery_log');
            elg.addNotNullQuery('credential');
            var oc = elg.addQuery('message', 'CONTAINS', 'authentication fail');
            oc.addOrCondition('message', 'CONTAINS', 'authorization fail');
            oc.addOrCondition('message', 'CONTAINS', 'permission denied');
            oc.addOrCondition('message', 'CONTAINS', 'access denied');
            oc.addOrCondition('message', 'CONTAINS', 'login fail');
            oc.addOrCondition('message', 'CONTAINS', 'invalid credential');
            oc.addOrCondition('message', 'CONTAINS', 'bad credential');
            oc.addOrCondition('message', 'CONTAINS', 'auth failed');
            elg.setLimit(5000);
            elg.query();
            while (elg.next()) {
                var cidE = elg.getValue('credential');
                if (creds[cidE]) creds[cidE].error = true;
            }
        } else {
            this.warn('AVISO: discovery_log.credential inexistente - uso de credencial NÃO avaliável nesta instância.');
            this.warn('AVISO: credenciais serão marcadas como INDETERMINADAS (nem vivas nem mortas) - usar discovery_credentials_affinity como fonte alternativa.');
        }

        this.subsection('3) Consolidação completa');

        for (var id in creds) {
            var c = creds[id];
            if (!usageAssessable) {
                // sem fonte de uso: não afirmar viva nem morta
                stats.indeterminate++;
                lists.indeterminate.push(c.name);
            } else if (!c.used) {
                stats.dead++;
                lists.dead.push(c.name);
            } else if (c.error) {
                stats.dangerous++;
                lists.dangerous.push(c.name);
            } else {
                stats.alive++;
                lists.alive.push(c.name);
            }
        }

        this.subsection('4) Resumo quantitativo');
        this.info('Resumo de credenciais:');
        this.info('- Total ativas: ' + stats.total);
        this.info('- Vivas: ' + stats.alive);
        this.info('- Mortas: ' + stats.dead);
        this.info('- Perigosas: ' + stats.dangerous);
        this.info('- Indeterminadas: ' + stats.indeterminate);

        this.subsection('5) Listagem completa por categoria');

        this.info('Credenciais VIVAS:');
        if (lists.alive.length === 0) {
            this.info('(nenhuma)');
        } else {
            for (var i = 0; i < lists.alive.length; i++) this.info('VIVA | ' + lists.alive[i]);
        }

        this.warn('Credenciais MORTAS:');
        if (lists.dead.length === 0) {
            this.warn('(nenhuma)');
        } else {
            for (var j = 0; j < lists.dead.length; j++) this.warn('MORTA | ' + lists.dead[j]);
        }

        if (lists.dangerous.length > 0) {
            this.error('Credenciais PERIGOSAS:');
            for (var k = 0; k < lists.dangerous.length; k++) this.error('PERIGOSA | ' + lists.dangerous[k]);
        } else {
            this.info('Credenciais PERIGOSAS: (nenhuma)');
        }

        if (lists.indeterminate.length > 0) {
            this.warn('Credenciais INDETERMINADAS:');
            for (var n = 0; n < lists.indeterminate.length; n++) this.warn('INDETERMINADA | ' + lists.indeterminate[n]);
        }

        this.subsection('6) Resultado do bloco');

        if (stats.dangerous > 0) {
            this.error('Resultado: FAIL - credenciais perigosas em uso');
            this.setResult('credentials', 'FAIL');
        } else if (stats.dead > 0) {
            this.warn('Resultado: WARN - credenciais mortas detectadas');
            this.setResult('credentials', 'WARN');
        } else if (!usageAssessable) {
            this.warn('Resultado: WARN - uso não avaliável (sem fonte de uso de credencial nesta instância)');
            this.setResult('credentials', 'WARN');
        } else {
            this.info('Resultado: PASS - credenciais sob controle');
        }
    },

    /* =========================================================
       6) CMDB | IRE (IDENTIDADE DE CI)
       COMO: verifica disponibilidade (cmdb_identifier), coleta identifiers active=true
       indexando por applies_to e checa cobertura nas classes técnicas críticas
       (server/appl/service_discovered); sinaliza entries com match em atributo nulo.
       POR QUÊ: IRE é o portão de identidade — sem identifier na classe, CIs entram
       duplicados ou sem reconciliação; match em nulo é causa direta de duplicata.
       ========================================================= */
    runIRE: function() {
        this.section('CMDB | IRE | IDENTIDADE DE CI');
        this.info(this.rule);

        this.subsection('1) Verificação de disponibilidade do IRE');

        if (!this.tableExists('cmdb_identifier')) {
            this.error('FAIL: IRE não disponível na instância.');
            this.setResult('ire', 'FAIL');
            return;
        }
        this.info('IRE disponível.');

        this.subsection('2) Coleta de regras de identificação ativas');

        // v6: o campo que aponta a classe varia por release/modelo. Detecta entre candidatos.
        var classField = this.firstField('cmdb_identifier', ['applies_to', 'ci_type', 'table']);
        if (!classField) {
            this.warn('AVISO: cmdb_identifier sem campo de classe reconhecível (applies_to/ci_type/table). Validar dicionário.');
        } else {
            this.info('Campo de classe do identifier: ' + classField);
        }

        var rules = {};
        var gr = new GlideRecord('cmdb_identifier');
        gr.addQuery('active', true);
        gr.query();

        var ruleCount = 0;
        while (gr.next()) {
            if (classField) {
                var v = gr.getValue(classField);
                if (v) rules[v] = true;
            }
            ruleCount++;
        }
        this.info('Regras IRE ativas encontradas: ' + ruleCount);

        this.subsection('3) Análise de cobertura por classes críticas (HERANÇA incluída)');

        // classes onde IRE independente é crítico de fato (identidade técnica).
        // v6: cobertura por HERANÇA — o identifier OOB de cmdb_ci_hardware cobre cmdb_ci_server
        // e demais extensões. Match exato gerava falso "SEM REGRA" (corrigido).
        var critical = ['cmdb_ci_server', 'cmdb_ci_appl', 'cmdb_ci_service_discovered'];
        var gaps = [];

        for (var i = 0; i < critical.length; i++) {
            var chain = this.classChain(critical[i]);
            var via = '';
            for (var ch = 0; ch < chain.length; ch++) {
                if (rules[chain[ch]]) { via = chain[ch]; break; }
            }
            if (via) {
                this.info('COM REGRA IRE | ' + critical[i] + (via !== critical[i] ? ' (herdada de ' + via + ')' : ''));
            } else {
                this.warn('SEM REGRA IRE | ' + critical[i] + ' (nem na própria classe nem em ancestrais)');
                gaps.push(critical[i]);
            }
        }

        this.subsection('4) Identifier entries permitindo match em nulo (causa de duplicata)');

        // Pitfall: entry com allow_null_attribute=true aceita match mesmo com o atributo vazio -> duplicatas
        if (this.fieldExists('cmdb_identifier_entry', 'allow_null_attribute')) {
            var ie = new GlideRecord('cmdb_identifier_entry');
            ie.addQuery('active', true);
            ie.addQuery('allow_null_attribute', true);
            ie.query();
            var nullRisk = ie.getRowCount();
            this.info('Identifier entries com allow_null_attribute=true: ' + nullRisk);
            if (nullRisk > 0) this.warn('WARN: entries permitindo match em atributo nulo (risco de duplicata).');
        }

        this.subsection('5) Resultado do bloco');

        if (gaps.length > 0) {
            this.warn('Resultado: WARN - classes críticas sem regra de identificação (' + gaps.length + ')');
            this.setResult('ire', 'WARN');
        } else {
            this.info('Resultado: PASS - cobertura de identificação adequada');
        }
    },

    /* =========================================================
       7) CMDB | RECONCILIATION (PRECEDÊNCIA / AUTORITATIVO)   [NOVO]
       COMO: detecta a tabela de reconciliation entre candidatos, conta regras ativas e
       datasources autoritativos, e mede nº de discovery_source distintos (multi-source).
       POR QUÊ: com múltiplas fontes escrevendo o mesmo atributo sem precedência/
       autoritativo definido, vale last-write-wins — uma fonte sobrescreve a outra de
       forma descontrolada. Multi-source sem regra é o cenário de maior risco.
       ========================================================= */
    runReconciliationGovernance: function() {
        this.section('CMDB | RECONCILIATION | PRECEDÊNCIA DE FONTES');
        this.info(this.rule);

        this.subsection('1) Disponibilidade de regras de reconciliation');

        // A tabela de reconciliation varia por release/configuração; detecta entre candidatos
        // (espelha o padrão usado no bloco de dedup). VALIDAR no dicionário da instância.
        var reconCandidates = ['cmdb_reconciliation_rule', 'cmdb_data_source_for_attribute', 'cmdb_reconciliation_definition'];
        var RECON_TBL = null;
        for (var rci = 0; rci < reconCandidates.length; rci++) {
            if (this.tableExists(reconCandidates[rci])) { RECON_TBL = reconCandidates[rci]; break; }
        }
        if (!RECON_TBL) {
            this.warn('WARN: nenhuma tabela de reconciliation encontrada (' + reconCandidates.join(', ') + ') - escrita pode estar em last-write-wins.');
            this.setResult('reconciliation', 'WARN');
            return;
        }
        this.info('Tabela de reconciliation detectada: ' + RECON_TBL);

        var hasActive = this.fieldExists(RECON_TBL, 'active');
        var rr = new GlideRecord(RECON_TBL);
        if (hasActive) rr.addActiveQuery();
        rr.query();
        var ruleCount = rr.getRowCount();
        this.info('Regras de reconciliation ativas: ' + ruleCount);

        this.subsection('2) Datasources autoritativos definidos');

        var authCount = 0;
        var authField = this.firstField(RECON_TBL, ['authoritative', 'is_authoritative', 'authoritative_source']);
        if (authField) {
            var auth = new GlideRecord(RECON_TBL);
            if (hasActive) auth.addActiveQuery();
            auth.addQuery(authField, true);
            auth.query();
            authCount = auth.getRowCount();
            this.info('Datasources autoritativos (' + authField + '): ' + authCount);
        } else {
            this.info('Datasources autoritativos: n/d (sem campo authoritative/is_authoritative - precedência via data source precedence rules)');
        }

        this.subsection('3) Fontes distintas escrevendo na CMDB');

        // nº de discovery_source distintos = potencial de conflito multi-source
        var sources = {};
        var ga = new GlideAggregate('cmdb_ci');
        ga.addAggregate('COUNT');
        ga.groupBy('discovery_source');
        ga.query();
        while (ga.next()) {
            var s = ga.getValue('discovery_source') || '(vazio)';
            sources[s] = true;
        }
        var srcCount = Object.keys(sources).length;
        this.info('Fontes distintas escrevendo: ' + srcCount);

        this.subsection('4) Resultado do bloco');

        // multi-source sem precedência/autoritativo = risco de sobrescrita descontrolada
        // v6: só acusa "sem autoritativo" quando o campo EXISTE e está zerado (senão é indeterminado, não WARN).
        if (ruleCount === 0 && srcCount > 1) {
            this.error('Resultado: FAIL - múltiplas fontes sem nenhuma regra de reconciliation');
            this.setResult('reconciliation', 'FAIL');
        } else if (authField && authCount === 0 && srcCount > 1) {
            this.warn('Resultado: WARN - múltiplas fontes sem datasource autoritativo definido');
            this.setResult('reconciliation', 'WARN');
        } else if (ruleCount === 0) {
            this.warn('Resultado: WARN - sem regras de reconciliation (revisar quando houver multi-source)');
            this.setResult('reconciliation', 'WARN');
        } else {
            this.info('Resultado: PASS - reconciliation governada');
        }
    },

    /* =========================================================
       8) CMDB | HEALTH PROFUNDO (DIMENSÃO/STALE/DUP/ORPHAN/GENÉRICO)   [NOVO]
       COMO: agrega a pior dimensão de Health (cmdb_health_result, com fallback à média
       de cmdb_health_metric); mede staleness por classe via last_discovered (fallback
       sys_updated_on), duplicates pendentes (tabela detectada entre candidatos), órfãos
       (opt-in) e CIs parados em classe genérica.
       POR QUÊ: o score de Health sozinho esconde a pior dimensão; stale/dup/orphan/
       genérico são os defeitos que tornam a base não confiável para evolução. O piso de
       qualidade é a pior dimensão, não a média.
       ========================================================= */
    runCMDBHealthDeep: function() {
        this.section('CMDB | HEALTH | PROFUNDO (DIMENSÃO/STALE/DUP/ORPHAN)');
        this.info(this.rule);
        var degrade = false;
        var dimMeasured = false;

        this.subsection('1) Pior dimensão de Health');

        // v5: probe AUTO-DESCOBERTO. O modelo de Health muda por release:
        //  - Xanadu+ (CMDB Workspace): score agregado em cmdb_health_score; falhas por CI em cmdb_health_result.
        //  - Legado: cmdb_health_result / cmdb_health_metric.
        // Em vez de hardcode de campo (que caía em "não medida"), detecta tabela+campos por dicionário.
        var HEALTH_CANDIDATES = ['cmdb_health_score', 'cmdb_health_result', 'cmdb_health_metric'];
        var SCORE_FIELDS = ['score', 'value', 'health_score', 'percentage', 'percent', 'metric_score', 'kpi_score'];
        var DIM_FIELDS   = ['metric', 'metric_type', 'kpi', 'kpi_name', 'dimension', 'type', 'health_scorecard', 'scorecard', 'name'];

        var H = { tbl: null, score: null, dim: null, rows: 0 };
        for (var hc = 0; hc < HEALTH_CANDIDATES.length && !H.tbl; hc++) {
            var t = HEALTH_CANDIDATES[hc];
            if (!this.tableExists(t)) continue;

            var sf = null;
            for (var sfi = 0; sfi < SCORE_FIELDS.length && !sf; sfi++)
                if (this.fieldExists(t, SCORE_FIELDS[sfi])) sf = SCORE_FIELDS[sfi];
            if (!sf) { this.info('HEALTH | ' + t + ' existe mas sem campo de score reconhecível (verificar dicionário).'); continue; }

            var df = null;
            for (var dfi = 0; dfi < DIM_FIELDS.length && !df; dfi++)
                if (this.fieldExists(t, DIM_FIELDS[dfi])) df = DIM_FIELDS[dfi];

            var rc = new GlideAggregate(t);
            rc.addAggregate('COUNT');
            rc.query();
            var rows = rc.next() ? parseInt(rc.getAggregate('COUNT'), 10) : 0;

            H = { tbl: t, score: sf, dim: df, rows: rows };
        }

        if (!H.tbl) {
            this.warn('AVISO: nenhuma tabela de Health reconhecida (' + HEALTH_CANDIDATES.join(', ') + '). Validar modelo desta release.');
        } else {
            this.info('HEALTH | tabela=' + H.tbl + ' | score=' + H.score + ' | dimensao=' + (H.dim || 'n/d') + ' | linhas=' + H.rows);

            if (H.rows === 0) {
                // causa clássica em dev: CMDB Health Dashboard Jobs vêm DESATIVADOS por padrão.
                this.warn('AVISO: ' + H.tbl + ' está VAZIA - jobs de CMDB Health provavelmente nunca rodaram.');
                this.warn('ACAO: Configuration > CMDB Dashboard > CMDB View > CMDB Health Dashboard Jobs -> ativar/Execute Now (Completeness/Correctness/Compliance).');
            } else {
                try {
                    var worst = 101, worstDim = '';
                    var hr = new GlideAggregate(H.tbl);
                    hr.addAggregate('AVG', H.score);
                    if (H.dim) hr.groupBy(H.dim);
                    hr.query();
                    while (hr.next()) {
                        var dim = H.dim ? (hr.getValue(H.dim) || 'n/d') : 'GERAL';
                        var avg = Math.round(parseFloat(hr.getAggregate('AVG', H.score)));
                        if (isNaN(avg)) continue;
                        this.info('DIMENSAO | ' + dim + ' = ' + avg + '%');
                        if (avg < worst) { worst = avg; worstDim = dim; }
                    }
                    if (worst <= 100) {
                        dimMeasured = true;
                        this.info('Pior dimensão: ' + worstDim + ' (' + worst + '%)');
                        if (worst < 70) { this.error('FAIL: dimensão crítica abaixo de 70%'); this.setResult('health', 'FAIL'); degrade = true; }
                        else if (worst < 85) { this.warn('WARN: dimensão abaixo do ideal'); degrade = true; }
                    }
                } catch (e) {
                    this.warn('AVISO: falha ao agregar ' + H.tbl + '.' + H.score + ' (' + e + '). Pode ser database view - validar campo numérico real.');
                }
            }
        }

        // Dump de schema (ground truth): campos numéricos das tabelas de Health desta instância.
        // Use a saída para travar SCORE_FIELDS/DIM_FIELDS caso a detecção acima não baste.
        if (!dimMeasured) {
            this.info('SCHEMA DUMP (campos numéricos das tabelas de Health desta instância):');
            var dict = new GlideRecord('sys_dictionary');
            dict.addQuery('name', 'IN', HEALTH_CANDIDATES.join(','));
            dict.addQuery('internal_type', 'IN', 'integer,decimal,float,longint,percent_complete');
            dict.addNotNullQuery('element');
            dict.query();
            var dumped = 0;
            while (dict.next() && dumped < 60) {
                this.info('  ' + dict.getValue('name') + '.' + dict.getValue('element') + ' [' + dict.getValue('internal_type') + ']');
                dumped++;
            }
            if (dumped === 0) this.info('  (nenhum campo numérico encontrado nas tabelas candidatas)');
            this.warn('AVISO: dimensão de Health NÃO medida. Conferir SCHEMA DUMP acima e ajustar SCORE_FIELDS/DIM_FIELDS, ou rodar os jobs de Health.');
        }

        this.subsection('2) Staleness por classe crítica (herança incluída)');

        // v6: NULL em last_discovered = CI nunca descoberto com sucesso (forte sinal de stale,
        // mas também atinge CIs manuais legítimos). Default conservador = NÃO conta NULL como stale,
        // para não dobrar com o bloco de write control. Ligue se quiser visão pessimista.
        var COUNT_NULL_AS_STALE = false;
        var staleCfg = [
            { cls: 'cmdb_ci_server', days: 45 },
            { cls: 'cmdb_ci_appl', days: 30 },
            { cls: 'cmdb_ci_database', days: 30 }
        ];
        var staleTotal = 0;
        for (var s = 0; s < staleCfg.length; s++) {
            var cls = staleCfg[s].cls;
            if (!this.tableExists(cls)) { this.info('STALE | ' + cls + ' = tabela inexistente'); continue; }
            // sinal de descoberta real: last_discovered. sys_updated_on só como fallback,
            // pois qualquer Business Rule/integração toca sys_updated_on e mascara o stale (falso "fresco").
            var staleField = this.fieldExists(cls, 'last_discovered') ? 'last_discovered' : 'sys_updated_on';
            // consulta a TABELA DA CLASSE (inclui subclasses por herança), não sys_class_name exato
            var sg = new GlideAggregate(cls);
            sg.addQuery('install_status', '!=', 7);
            var sc = sg.addQuery(staleField, '<', gs.daysAgoStart(staleCfg[s].days));
            if (COUNT_NULL_AS_STALE && staleField === 'last_discovered') {
                sc.addOrCondition(staleField, '', ''); // ISEMPTY
            }
            sg.addAggregate('COUNT');
            sg.query();
            var cnt = sg.next() ? parseInt(sg.getAggregate('COUNT'), 10) : 0;
            staleTotal += cnt;
            this.info('STALE | ' + cls + ' (>' + staleCfg[s].days + 'd por ' + staleField +
                      (COUNT_NULL_AS_STALE ? '+null' : '') + ', c/ filhas) = ' + cnt);
        }
        this.info('CIs stale (total): ' + staleTotal);
        if (staleTotal > 0) { this.warn('WARN: CIs stale detectados.'); degrade = true; }

        this.subsection('3) Duplicates pendentes');

        var dupCandidates = ['reconcile_duplicate_task', 'cmdb_duplicate_task', 'cmdb_dedup_task'];
        var dupTbl = null;
        for (var dc = 0; dc < dupCandidates.length; dc++) {
            if (this.tableExists(dupCandidates[dc])) { dupTbl = dupCandidates[dc]; break; }
        }
        if (dupTbl) {
            var dg = new GlideAggregate(dupTbl);
            if (this.fieldExists(dupTbl, 'active')) dg.addQuery('active', true); // só abertas, se houver o campo
            dg.addAggregate('COUNT');
            dg.query();
            var dcnt = dg.next() ? parseInt(dg.getAggregate('COUNT'), 10) : 0;
            this.info('Duplicate tasks abertas (' + dupTbl + '): ' + dcnt);
            if (dcnt > 0) { this.warn('WARN: duplicatas pendentes de remediação.'); degrade = true; }
        } else {
            this.info('Tabela de dedup não encontrada (validar nome via sys_db_object nameLIKEduplicate).');
        }

        this.subsection('4) Orphans (CIs sem relacionamento)');

        // Em CMDB grande, varredura de órfãos é cara e propensa a falso-positivo.
        // Desabilitado por padrão; usar a KPI nativa "Orphan CIs" do CMDB Health.
        var ENABLE_ORPHAN_SCAN = false;
        var ORPHAN_CLASS = 'cmdb_ci_server';
        var ORPHAN_MAX = 5000; // só varre se a classe tiver poucos CIs
        if (!ENABLE_ORPHAN_SCAN) {
            this.info('Varredura de órfãos DESABILITADA por padrão (usar KPI nativo Orphan CIs em CMDB grande).');
        } else if (this.tableExists(ORPHAN_CLASS)) {
            var ca = new GlideAggregate(ORPHAN_CLASS);
            ca.addQuery('install_status', '!=', 7);
            ca.addAggregate('COUNT');
            ca.query();
            var classCount = ca.next() ? parseInt(ca.getAggregate('COUNT'), 10) : 0;
            if (classCount > ORPHAN_MAX) {
                this.warn('Órfãos: ' + ORPHAN_CLASS + ' tem ' + classCount + ' CIs (> ' + ORPHAN_MAX + ') - varredura ignorada para não inflar falso-positivo.');
            } else {
                var orphanCnt = 0;
                var og = new GlideRecord(ORPHAN_CLASS); // inclui subclasses
                og.addQuery('install_status', '!=', 7);
                og.query();
                while (og.next()) {
                    var sid = og.getUniqueValue();
                    var rc = new GlideAggregate('cmdb_rel_ci');
                    rc.addEncodedQuery('parent=' + sid + '^ORchild=' + sid);
                    rc.addAggregate('COUNT');
                    rc.query();
                    var has = rc.next() ? parseInt(rc.getAggregate('COUNT'), 10) : 0;
                    if (has === 0) orphanCnt++;
                }
                this.info(ORPHAN_CLASS + ' órfãos (sem relacionamento): ' + orphanCnt);
                if (orphanCnt > 0) { this.warn('WARN: CIs sem dependência mapeada.'); degrade = true; }
            }
        }

        this.subsection('5) Uso de classe genérica');

        // só classes realmente genéricas; cmdb_ci_computer é classe legítima -> fora da lista
        var generics = ['cmdb_ci', 'cmdb_ci_hardware'];
        var genTotal = 0;
        for (var g = 0; g < generics.length; g++) {
            var gg = new GlideAggregate(generics[g]);
            gg.addQuery('sys_class_name', generics[g]); // match EXATO (intencional): CI parado na classe-base
            gg.addAggregate('COUNT');
            gg.query();
            var gc = gg.next() ? parseInt(gg.getAggregate('COUNT'), 10) : 0;
            genTotal += gc;
            if (gc > 0) this.warn('GENERICO | ' + generics[g] + ' = ' + gc);
        }
        this.info('CIs em classe genérica (total): ' + genTotal);
        if (genTotal > 0) degrade = true;

        this.subsection('6) Resultado do bloco');

        if (this.RESULT.health === 'FAIL') {
            this.error('Resultado: FAIL - qualidade crítica (dimensão < 70%)');
        } else if (degrade) {
            this.warn('Resultado: WARN - stale/dup/orphan/genérico ou dimensão < 85%' + (dimMeasured ? '' : ' (dimensão NÃO medida)'));
            this.setResult('health', 'WARN');
        } else if (!dimMeasured) {
            this.warn('Resultado: WARN - não foi possível medir a dimensão de Health (tabela/KPI a confirmar).');
            this.setResult('health', 'WARN');
        } else {
            this.info('Resultado: PASS - qualidade profunda adequada');
        }
    },

    /* =========================================================
       9) CMDB | CSDM (MODELO E USO REAL)
       COMO: valida existência das classes CSDM (sys_db_object) e uso real (registros em
       cmdb_ci por sys_class_name); detecta uso da classe genérica cmdb_ci_service.
       POR QUÊ: modelo CSDM presente mas vazio = adoção só no papel; uso de
       cmdb_ci_service genérico indica serviços fora das classes corretas, quebrando
       Service Mapping, KPIs de Health e relatórios de compliance.
       ========================================================= */
    runCSDMClassCheck: function() {
        this.section('CMDB | CSDM | MODELO E USO REAL');
        this.info(this.rule);

        this.subsection('1) Modelo e uso real das classes CSDM');

        // v6: nomes de classe CORRETOS por CSDM. cmdb_ci_business_service / cmdb_ci_application_service
        // NÃO são tabelas OOB (bug v5 -> WARN eterno). Reais:
        //  - Business Application : cmdb_ci_business_app
        //  - Application Service  : cmdb_ci_service_discovered (mapeada) e cmdb_ci_service_auto (calc/tag)
        //  - Business/Technical Service vivem no base cmdb_ci_service (classificados)
        // Cada classe pode ter >1 tabela aceitável; basta UMA existir+em uso.
        var csdm = [
            { label: 'Business Application', tables: ['cmdb_ci_business_app'] },
            { label: 'Application Service',  tables: ['cmdb_ci_service_discovered', 'cmdb_ci_service_auto', 'cmdb_ci_service_by_tags'] }
        ];

        var hasWarn = false;

        for (var i = 0; i < csdm.length; i++) {
            var item = csdm[i];

            // existência do modelo: alguma das tabelas aceitáveis existe?
            var presentTbl = null;
            for (var t = 0; t < item.tables.length; t++) {
                if (this.tableExists(item.tables[t])) { presentTbl = item.tables[t]; break; }
            }
            if (!presentTbl) {
                this.warn('MODELO AUSENTE | ' + item.label + ' (' + item.tables.join(' / ') + ')');
                hasWarn = true;
                continue;
            }
            this.info('MODELO OK | ' + item.label + ' -> ' + presentTbl);

            // uso real: registros em QUALQUER das tabelas aceitáveis (via sys_class_name nas filhas de cmdb_ci)
            var used = 0;
            for (var u = 0; u < item.tables.length; u++) {
                if (!this.tableExists(item.tables[u])) continue;
                var cu = new GlideAggregate(item.tables[u]);
                cu.addAggregate('COUNT');
                cu.query();
                if (cu.next()) used += parseInt(cu.getAggregate('COUNT'), 10);
            }
            if (used === 0) {
                this.warn('SEM REGISTROS | ' + item.label + ' (modelo existe mas vazio = adoção só no papel)');
                hasWarn = true;
            } else {
                this.info('EM USO | ' + item.label + ' = ' + used + ' registros');
            }
        }

        this.subsection('2) Uso genérico de serviço (cmdb_ci_service base)');

        // CIs parados EXATAMENTE na classe base de serviço = serviço fora das classes CSDM corretas.
        var generic = new GlideAggregate('cmdb_ci_service');
        generic.addQuery('sys_class_name', 'cmdb_ci_service'); // match EXATO na classe-base
        generic.addAggregate('COUNT');
        generic.query();
        var genSvc = generic.next() ? parseInt(generic.getAggregate('COUNT'), 10) : 0;
        if (genSvc > 0) {
            this.warn('USO GENÉRICO | cmdb_ci_service (base) = ' + genSvc + ' - serviços fora das classes CSDM');
            hasWarn = true;
        } else {
            this.info('Uso genérico de serviço (classe-base) não detectado.');
        }

        this.subsection('3) Resultado do bloco');

        if (hasWarn) {
            this.warn('Resultado: WARN - adoção parcial ou inexistente do CSDM');
            this.setResult('csdm', 'WARN');
        } else {
            this.info('Resultado: PASS - modelo CSDM adotado');
        }
    },

    /* =========================================================
       10) PLANO DE CORREÇÃO (DERIVADO DO CONTRATO)
       COMO: percorre RESULT e, por domínio em WARN/FAIL, deriva prioridade (FAIL=P0,
       WARN estrutural=P1, WARN operacional=P2) e ação a partir do mapa meta.
       POR QUÊ: traduz o veredito por domínio num backlog priorizado e determinístico —
       estrutural antes de operacional, sem depender de percepção subjetiva.
       ========================================================= */
    generateCorrectionPlan: function() {
        this.section('PLANO DE CORREÇÃO | PRIORIZADO');

        // estrutural = peso alto na maturidade; FAIL=P0, WARN estrutural=P1, WARN não-estrutural=P2
        var meta = {
            probes:        { struct: false, act: 'Aposentar probes legados remanescentes' },
            sensors:       { struct: true,  act: 'Racionalizar/desativar sensors legados; rotear escrita pelo IRE' },
            writecontrol:  { struct: true,  act: 'Bloquear carga manual/bypass; rotear toda escrita via IRE' },
            schedules:     { struct: false, act: 'Ativar/validar Discovery Schedules (discovery_status)' },
            credentials:   { struct: false, act: 'Higienizar credenciais mortas/perigosas; rastreabilidade' },
            ire:           { struct: true,  act: 'Criar regras de identificação para classes críticas' },
            reconciliation:{ struct: true,  act: 'Definir precedência/datasource autoritativo' },
            health:        { struct: true,  act: 'Remediar pior dimensão + stale/dup/orphan; baseline de qualidade' },
            csdm:          { struct: true,  act: 'Eliminar uso genérico; alinhar classes ao CSDM' }
        };

        var plan = [];
        for (var area in this.RESULT) {
            var st = this.RESULT[area];
            var m = meta[area];
            if (!m || st === 'PASS') continue;
            var p = (st === 'FAIL') ? 0 : (m.struct ? 1 : 2);
            plan.push({ p: p, area: area, st: st, act: m.act });
        }
        plan.sort(function(a, b) { return a.p - b.p; });

        if (plan.length === 0) {
            this.info('Sem ações pendentes - ambiente estável.');
            return;
        }
        for (var i = 0; i < plan.length; i++) {
            var it = plan[i];
            var line = 'PRIORIDADE ' + it.p + ': [' + it.area.toUpperCase() + '/' + it.st + '] ' + it.act;
            if (it.p === 0) this.error(line);
            else this.warn(line);
        }
    },

    /* =========================================================
       ORQUESTRAÇÃO FINAL
       ========================================================= */
    runAll: function() {
        // v4: isolamento de falha — uma seção que estoura NÃO derruba o resto.
        // Falha de execução vira FAIL (não se pode afirmar PASS sem ter rodado).
        var steps = [
            ['probes',         this.runProbes],
            ['sensors',        this.runSensors],
            ['writecontrol',   this.runCMDBWriteControl],
            ['schedules',      this.runDiscoverySchedules],
            ['credentials',    this.runCredentials],
            ['ire',            this.runIRE],
            ['reconciliation', this.runReconciliationGovernance],
            ['health',         this.runCMDBHealthDeep],
            ['csdm',           this.runCSDMClassCheck]
        ];
        for (var i = 0; i < steps.length; i++) {
            var area = steps[i][0];
            try {
                steps[i][1].call(this);
            } catch (e) {
                this.error('EXCEÇÃO em ' + area + ': ' + e + (e.stack ? ' | ' + e.stack : ''));
                this.setResult(area, 'FAIL');
            }
        }
        this.generateCorrectionPlan();
        this.finalVerdict();
    },

    finalVerdict: function() {
        this.section('VEREDITO FINAL');
        for (var k in this.RESULT) {
            this.info(k.toUpperCase() + ' = ' + this.RESULT[k]);
        }
    },

    type: 'CMDBBaselineDiagnostic'
};

/* =========================================================
   EXECUÇÃO (BACKGROUND SCRIPT) — escopo GLOBAL
   Cole o arquivo inteiro em Scripts - Background e rode.
   Saída: painel do Background Script (eco automático de gs.info/warn/error como "*** Script:")
          + System Log (System Log > All). NÃO usar gs.print (duplicaria no runner moderno).
   ========================================================= */
new CMDBBaselineDiagnostic().runAll();
