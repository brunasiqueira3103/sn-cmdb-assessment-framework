# CMDB Baseline Diagnostic — Guia do Administrador da Plataforma

**ITOM · DISCOVERY · CMDB · CSDM**

Script de assessment (Background Script) + Console de análise (HTML)

> Documento de referência funcional e técnica. Descreve o que o diagnóstico executa na instância ServiceNow, quais dados ele lê, como o resultado é classificado e como interpretar a leitura apresentada pelo console de análise.

---

## 1. Visão geral

O CMDB Baseline Diagnostic é um framework de avaliação objetiva da maturidade e da confiabilidade do CMDB como base para evolução de ITOM (Discovery, Service Mapping, Event Management, etc.). Ele produz um veredito padronizado **GO / NO-GO** por domínio técnico, alinhado às boas práticas da ServiceNow e ao CSDM, sem depender de percepção subjetiva nem de customizações locais.

A entrega é composta por dois componentes que trabalham em conjunto:

| Componente | Função |
|---|---|
| `CMDBBaselineDiagnostic_v4.js` | Script de diagnóstico. É colado e executado em **Scripts – Background** (escopo Global) na instância ServiceNow. Lê dados de configuração e qualidade do CMDB e imprime um log estruturado com o resultado de cada domínio avaliado. |
| `cmdb_assessment_console_v2.html` | Console de análise (app). Arquivo único HTML, **100% offline**, aberto em qualquer navegador. Recebe o log do script colado pelo usuário, interpreta o conteúdo e apresenta veredito, score, maturidade, riscos, plano de correção e evidências. Exporta relatório em PDF, Word e Excel. |

**Fluxo de uso:** (1) executar o script na instância → (2) copiar o output do painel do Background Script → (3) colar o output no console HTML e clicar **Analisar** → (4) interpretar/exportar o resultado.

---

## 2. Princípios e garantias de execução

- **Somente leitura.** O script usa exclusivamente `GlideRecord` e `GlideAggregate` para consulta. Ele não cria, não altera e não exclui nenhum registro na instância — nem no CMDB, nem em qualquer outra tabela.
- **Nenhum dado sai da instância.** O script não faz chamadas externas (REST/HTTP). Toda a saída vai para o painel do Background Script e para o System Log. O console HTML também é offline: o log é processado localmente no navegador, sem envio a servidor.
- **Seguro para instâncias grandes.** Tabelas volumosas (`cmdb_ci`, `discovery_log`) são consultadas por agregação, nunca linha a linha; consultas de erro de credencial têm limite de 5.000 registros; a varredura de CIs órfãos vem desabilitada por padrão. Isso evita transaction timeout.
- **Isolamento de falha.** Cada seção roda dentro de `try/catch`. Uma exceção em um domínio não interrompe os demais; o domínio que falhou na execução é marcado como **FAIL** (o framework nunca afirma PASS sem ter conseguido medir).
- **Detecção de schema em runtime.** Nomes de tabelas e campos que variam por release (Health, reconciliation, identificadores do IRE) são detectados automaticamente no dicionário da instância. O script informa no log qual tabela/campo encontrou.
- **Honestidade epistêmica.** Quando não existe fonte de dados para medir algo (ex.: uso de credencial sem `discovery_log.credential`), o item é classificado como **INDETERMINADO** — nunca como aprovado ou reprovado sem evidência.

---

## 3. Como executar o diagnóstico

1. Acesse **System Definition > Scripts – Background** com perfil admin.
2. Selecione o escopo **Global**.
3. Cole o conteúdo integral do arquivo `CMDBBaselineDiagnostic_v4.js`. O arquivo é auto-executável (a última linha instancia e roda o diagnóstico).
4. Execute. O runner moderno ecoa cada linha do log no painel com o prefixo `*** Script:`.
5. Selecione e copie todo o output do painel.
6. Abra `cmdb_assessment_console_v2.html` no navegador, cole o output no campo **Execução base** e clique **Analisar**.

**Recomendações:** execute fora de janela de pico em instâncias muito grandes (o script é agregado, mas Health e write control varrem o CMDB por agregação). A execução completa é tipicamente de segundos a poucos minutos. Para reavaliar após uma remediação, basta rodar novamente e usar o campo comparativo do console (seção 8).

---

## 4. Contrato de decisão (regra de ouro)

Todo domínio avaliado termina em exatamente um de três estados. O significado é fixo e orienta a decisão de evolução do ITOM:

| Estado | Significado |
|---|---|
| **FAIL** | **Bloqueia evolução.** Existe um defeito estrutural que torna o CMDB não confiável como base; novas capacidades não devem ser implantadas antes da correção. |
| **WARN** | **Permite evolução com contenção.** O ambiente opera, mas há risco identificado que exige plano de correção paralelo à evolução. |
| **PASS** | **Pode seguir.** Nenhum risco material detectado no domínio. |

**Duas propriedades importantes:** (a) um FAIL registrado nunca é rebaixado por verificações posteriores do mesmo domínio; (b) o piso de qualidade é a **pior dimensão**, não a média — a média esconde exatamente o defeito que torna a base não confiável.

---

## 5. O que o script verifica e coleta, por domínio

O diagnóstico percorre nove domínios na ordem abaixo e fecha com um plano de correção priorizado e o veredito final consolidado. Para cada domínio estão descritos o objetivo, as tabelas/campos lidos e o critério que define o resultado.

### 5.1 Probes legados (Discovery)

**O que verifica.** Existência de Probes ativos — modelo de coleta anterior a Patterns. Probe ativo indica coleta fora do pipeline atual (Pattern/IRE).

**Dados lidos.** `discovery_probe` (registros com `active=true`). Se a tabela não existir na instância, o domínio é aprovado.

**Critério de resultado.**
- **WARN** — há probes legados ativos.
- **PASS** — tabela inexistente ou nenhum probe ativo.

### 5.2 Sensors legados (Discovery)

**O que verifica.** Sensors legados escrevem direto no CMDB sem passar pela identificação/reconciliação do IRE — bypass que gera duplicatas e identidade não confiável. O script conta os sensors ativos.

**Dados lidos.** `discovery_sensor` (contagem de `active=true`).

**Critério de resultado.**
- **WARN** — um ou mais sensors ativos (a quantidade é logada e exibida no console).
- **PASS** — nenhum sensor ativo ou tabela inexistente.

### 5.3 Controle de escrita no CMDB (carga manual / bypass de IRE)

**O que verifica.** Mede quanto da base de CIs entra por canal governado (Discovery/Service Mapping) versus carga manual, origem vazia, Transform Maps direto em `cmdb_ci` e contas de integração (Table API/REST). Tudo que escreve fora do pipeline governado compromete o CMDB como fonte de verdade.

**Dados lidos.** `cmdb_ci` agregado por `discovery_source` (excluindo CIs retirados, `install_status=7`) e por `sys_created_by`; `sys_transform_map` ativos com destino `cmdb_ci*`; `sys_user` para identificar contas `web_service_access_only`. São logados os volumes por fonte e os nomes de usuário de contas de integração que criaram CIs.

**Critério de resultado.**
- **FAIL** — carga manual real (origem 'ServiceNow') ≥ 30% dos CIs ativos.
- **WARN** — manual real ≥ 15%, ou origem vazia ≥ 20%, ou qualquer Transform Map ativo em `cmdb_ci`, ou qualquer CI criado por conta de integração.
- **PASS** — escrita sob controle do IRE/Discovery.

### 5.4 Discovery Schedules

**O que verifica.** Verifica se existem schedules ativos e se houve execução recente — schedule ativo sem execução é efetividade não comprovada; sem schedule, a atualização do CMDB para (staleness garantido).

**Dados lidos.** `discovery_schedule` (ativos) e `discovery_status` (execuções nos últimos 7 dias).

**Critério de resultado.**
- **FAIL** — nenhum schedule ativo.
- **WARN** — schedules ativos sem nenhuma execução nos últimos 7 dias.
- **PASS** — schedules ativos com execução recente.

### 5.5 Credenciais de Discovery

**O que verifica.** Inventaria as credenciais ativas e classifica cada uma como **VIVA** (usada sem erro), **MORTA** (sem uso registrado), **PERIGOSA** (uso com falha de autenticação/autorização) ou **INDETERMINADA** (instância sem fonte de uso avaliável). Falhas são detectadas por frases reais de erro (`authentication fail`, `access denied`, `invalid credential` etc.), nunca por correspondência genérica que geraria falso positivo.

**Dados lidos.** `discovery_credentials` (nome das credenciais ativas) e `discovery_log` — uso por agregação no campo `credential` e erros por busca limitada a 5.000 registros. Importante: o script lê e loga apenas o **NOME** das credenciais; nenhuma senha ou segredo é acessado.

**Critério de resultado.**
- **FAIL** — existe credencial perigosa (em uso com falha de auth).
- **WARN** — existem credenciais mortas, ou o uso não é avaliável na instância (todas viram INDETERMINADAS).
- **PASS** — todas as credenciais ativas vivas.

### 5.6 IRE — identidade de CI

**O que verifica.** O IRE é o portão de identidade do CMDB. O script confirma a disponibilidade do motor, conta as regras de identificação ativas e verifica a cobertura das classes técnicas críticas (`cmdb_ci_server`, `cmdb_ci_appl`, `cmdb_ci_service_discovered`) considerando herança — uma regra na classe-mãe (ex.: `cmdb_ci_hardware`) cobre as filhas. Também aponta identifier entries que permitem match com atributo nulo, causa direta de duplicata.

**Dados lidos.** `cmdb_identifier` (regras ativas; o campo que aponta a classe é auto-detectado entre `applies_to`/`ci_type`/`table`), `sys_db_object` (cadeia de herança via `super_class`) e `cmdb_identifier_entry` (`allow_null_attribute=true`).

**Critério de resultado.**
- **FAIL** — IRE indisponível na instância.
- **WARN** — classe crítica sem regra de identificação (própria ou herdada).
- **PASS** — cobertura adequada nas classes críticas.

### 5.7 Reconciliation — precedência de fontes

**O que verifica.** Com múltiplas fontes escrevendo o mesmo atributo sem precedência/datasource autoritativo, vale last-write-wins: uma fonte sobrescreve a outra de forma descontrolada. O script detecta a tabela de reconciliation da release, conta regras ativas e autoritativos, e mede quantas fontes distintas escrevem no CMDB.

**Dados lidos.** Tabela auto-detectada entre `cmdb_reconciliation_rule`, `cmdb_data_source_for_attribute` e `cmdb_reconciliation_definition`; campo autoritativo auto-detectado; nº de fontes via agregação de `cmdb_ci.discovery_source`.

**Critério de resultado.**
- **FAIL** — múltiplas fontes escrevendo sem nenhuma regra de reconciliation.
- **WARN** — multi-source sem datasource autoritativo definido (quando o campo existe), ou ausência de regras/tabela de reconciliation.
- **PASS** — reconciliation governada.

### 5.8 CMDB Health profundo

**O que verifica.** Vai além do score médio do dashboard: identifica a pior dimensão de Health (completeness/correctness/compliance), mede staleness por classe crítica, duplicatas pendentes e CIs parados em classe genérica. O staleness usa `last_discovered` (não `sys_updated_on`, que é tocado por qualquer Business Rule e mascara o problema). A varredura de órfãos é cara e vem desabilitada por padrão — recomenda-se o KPI nativo Orphan CIs.

**Dados lidos.** Tabela de Health auto-detectada entre `cmdb_health_score`, `cmdb_health_result` e `cmdb_health_metric` (campos de score/dimensão também auto-detectados; se as tabelas estiverem vazias, o script alerta que os CMDB Health Dashboard Jobs nunca rodaram e indica onde ativá-los); staleness em `cmdb_ci_server` (>45d), `cmdb_ci_appl` (>30d) e `cmdb_ci_database` (>30d); duplicatas na tabela detectada entre `reconcile_duplicate_task` / `cmdb_duplicate_task` / `cmdb_dedup_task`; classe genérica = CIs com `sys_class_name` exatamente `cmdb_ci` ou `cmdb_ci_hardware`.

**Critério de resultado.**
- **FAIL** — pior dimensão de Health abaixo de 70%.
- **WARN** — pior dimensão entre 70% e 85%, ou presença de stale/duplicata/genérico, ou dimensão não mensurável (jobs de Health inativos).
- **PASS** — qualidade profunda adequada.

### 5.9 CSDM — modelo e uso real

**O que verifica.** Valida se as classes do CSDM existem e estão de fato em uso (modelo presente mas vazio é adoção só no papel) e detecta serviços parados na classe-base genérica `cmdb_ci_service` — sinal de serviços fora das classes corretas, o que quebra Service Mapping, KPIs de Health e relatórios.

**Dados lidos.** Business Application em `cmdb_ci_business_app`; Application Service em `cmdb_ci_service_discovered` / `cmdb_ci_service_auto` / `cmdb_ci_service_by_tags` (basta uma existir e estar em uso); uso genérico medido por match exato na base `cmdb_ci_service`.

**Critério de resultado.**
- **WARN** — modelo ausente, modelo existente sem registros, ou uso genérico detectado.
- **PASS** — modelo CSDM adotado e em uso.

### 5.10 Plano de correção e veredito final

Ao final, o script deriva automaticamente um backlog priorizado a partir dos resultados — **FAIL = P0** (estabilização imediata), **WARN em domínio estrutural = P1**, **WARN operacional = P2** — e imprime o bloco **VEREDITO FINAL** com o estado consolidado de cada domínio (ex.: `SENSORS = WARN`). É esse bloco que o console usa como fonte primária do veredito.

---

## 6. Dados sensíveis e privacidade

- O script lê e loga **nomes** de credenciais e nomes de usuário de contas de integração que criaram CIs. Nenhuma senha, chave ou segredo é acessado em momento algum.
- Não são lidos dados de usuários finais, incidentes ou conteúdo de negócio — apenas metadados de configuração e contagens agregadas do CMDB/Discovery.
- Nos painéis de indicadores e nas exportações Word/Excel do console, os nomes de credenciais são deliberadamente omitidos (apenas quantidades). Os nomes permanecem disponíveis na seção Evidências (log bruto) para uso interno da equipe técnica.
- O console roda inteiramente no navegador local. Nenhum dado do log é transmitido a qualquer serviço.

---

## 7. O console de análise (app): como usar

Abra o arquivo HTML em um navegador moderno. A tela de entrada tem dois campos: **Execução base** (obrigatório — o output completo do script) e **Execução comparativa** (opcional — uma segunda execução, por exemplo pós-remediação, para visualizar o delta antes→depois). O parser é tolerante aos prefixos do Background Script (`*** Script:`) e de syslog; basta colar o texto como copiado.

**Botões:** **Analisar** processa o log; **Carregar exemplo** preenche um cenário sintético de demonstração; **PDF (imprimir)** gera o relatório via diálogo de impressão do navegador (salvar como PDF); **Word (.doc)** e **Excel (.xls)** baixam o relatório executivo e as planilhas de apoio — ambos abrem nativamente em MS Office e LibreOffice.

O painel **Metodologia & pesos** permite ajustar o peso de cada domínio e o modo de consolidação do veredito (seção 9) por engajamento, com recálculo imediato.

---

## 8. Como interpretar os resultados do console

### 8.1 O gate (veredito principal)

| Veredito | Leitura |
|---|---|
| **GO** | Todos os domínios em PASS. O ambiente está apto a evoluir capacidades ITOM. |
| **GO-RESTRITO** | Existe ao menos um WARN. A operação atual pode continuar, mas a expansão de capacidades deve ser acompanhada do plano de contenção/correção. |
| **NO-GO** | Existe ao menos um FAIL. Não avançar com novas capacidades antes da estabilização estrutural dos domínios reprovados. |

### 8.2 Score ponderado

Indicador de progresso (0–100%): cada domínio vale PASS=1, WARN=0,5, FAIL=0, ponderado pelo peso do domínio (pesos padrão refletem a criticidade: Sensors e Controle de Escrita pesam 3,0; IRE, Health e CSDM 2,5; Reconciliation 2,0; Schedules e Credenciais 1,5; Probes 1,0). O score serve para medir evolução entre execuções — **ele não substitui o gate**: um único FAIL mantém NO-GO mesmo com score alto.

### 8.3 Maturidade (1–5)

Banda derivada do score e rebaixada por deficiências em domínios **estruturais** (Sensors, Controle de Escrita, IRE, Reconciliation, Health e CSDM — os que sustentam a confiabilidade da base): 2 ou mais deficiências estruturais rebaixam um nível; 4 ou mais levam ao nível 1; qualquer FAIL limita o teto. A leitura prática: o número de deficiências estruturais indica o quanto da fundação precisa ser corrigida antes de escalar.

### 8.4 Cards por domínio e indicadores

Cada card mostra o status do domínio, sua criticidade/peso, a métrica-chave extraída do log (ex.: nº de sensors, % de escrita manual, credenciais mortas, gaps de IRE, pior dimensão de Health) e uma leitura consolidada em uma frase. Abaixo, quatro painéis detalham: higiene de credenciais (vivas/mortas/perigosas/indeterminadas), cobertura de identidade do IRE e adoção do CSDM, governança de escrita (governada/a revisar/manual) com reconciliation multi-source, e as dimensões de CMDB Health com os contadores de stale, duplicatas, órfãos e classe genérica.

### 8.5 Composição do score, riscos e plano

**Composição do Score** ranqueia onde a maturidade está sendo perdida — quantos pontos ponderados cada domínio em WARN/FAIL subtrai do total (domínios estruturais marcados com ◆). É o guia de priorização por impacto. **Principais Riscos** traduz cada status em risco e impacto operacional. **Plano de Correção Priorizado** consolida as ações recomendadas por prioridade P0/P1/P2 (mesma regra do script). **Estimativa de Esforço** apresenta bandas de duração/sprints/complexidade por frente — as células são editáveis na tela para ajuste antes da exportação.

### 8.6 Evidências

Seção expansível com o log bruto parseado por domínio, preservando o nível de cada linha (INFO/WARN/FAIL). É a trilha de auditoria do veredito: qualquer número exibido nos painéis pode ser conferido aqui na linha original do script, incluindo as listas nominais (credenciais, classes sem regra IRE, Transform Maps).

### 8.7 Comparativo de execuções (antes → depois)

Com uma segunda execução colada no campo comparativo, o console mostra a variação de score, gate e maturidade, o delta de status por domínio (melhora/regressão/sem mudança) e o delta das métricas quantitativas — útil para capturar progresso dentro do mesmo status (ex.: credenciais mortas caíram de 5 para 2, mas o domínio segue WARN). Use para evidenciar o resultado de cada onda de remediação.

---

## 9. Modos de consolidação do veredito

O mesmo conjunto de status pode ser consolidado de quatro formas, selecionáveis em **Metodologia & pesos**. O padrão do framework é o gate estrito; os demais são leituras alternativas para contextos específicos de engajamento:

| Modo | Regra |
|---|---|
| **Gate estrito (padrão)** | Qualquer FAIL → NO-GO; qualquer WARN → GO-RESTRITO; tudo PASS → GO. |
| **Piso estrutural** | Somente domínios estruturais limitam o gate; pendências operacionais descontam score mas não bloqueiam (impedem apenas o GO limpo). |
| **Ponderado puro** | Veredito por faixa de score: ≥90% GO; 60–89% GO-RESTRITO; <60% NO-GO. Ignora o gate binário. |
| **Crítico-ponderado** | Gate estrito, com domínios de criticidade Muito Alta pesando 1,5× no cálculo do score. |

---

## 10. Situações esperadas e como lê-las

| Situação no resultado | Interpretação / ação |
|---|---|
| Card com status **N/D** (domínio não detectado) | O bloco correspondente não apareceu no log colado — normalmente colagem parcial do output. Recopiar o painel inteiro e reanalisar. |
| Credenciais **INDETERMINADAS** | A instância não possui o campo `discovery_log.credential`; o uso real não é avaliável. Não significa credencial morta. Fonte alternativa: `discovery_credentials_affinity`. |
| Dimensão de Health **não medida** | As tabelas de Health estão vazias — os CMDB Health Dashboard Jobs vêm desativados por padrão. Ativar em **Configuration > CMDB Dashboard > CMDB Health Dashboard Jobs** e executar; o script imprime um SCHEMA DUMP dos campos numéricos para apoiar a validação por release. |
| Linha `EXCEÇÃO em <domínio>` no log | A seção falhou em runtime (ex.: timeout pontual ou ACL). O domínio é marcado FAIL por não ter sido medido. Investigar a exceção logada e reexecutar. |
| Mensagens `REVISAR FONTE │ <nome>` | Fontes de escrita não classificadas como governadas. Se forem SGCs legítimos do ambiente, podem ser adicionados à lista GOVERNED no topo do bloco de controle de escrita. |
| WARN persistente em Reconciliation com poucas fontes | Ausência de regras é apontada como atenção mesmo sem multi-source ativo — preparo para quando houver. Vira risco real (FAIL) apenas com múltiplas fontes e zero regras. |

**Suporte e evolução:** o script é versionado no cabeçalho do próprio arquivo, com changelog descrevendo cada correção e a razão. Ajustes de thresholds, classes críticas e fontes governadas são parametrizáveis sem alterar a lógica de decisão.
