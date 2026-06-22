# Technical Design Document — Discovery & CMDB

**ServiceNow ITOM — Desenho Técnico da Solução**

**Classificação:** Confidencial

| Campo | Valor |
|---|---|
| Cliente | 〔nome do cliente〕 |
| Projeto / SOW | 〔identificação〕 |
| Release-alvo da plataforma | 〔ex.: Zurich / Yokohama / Xanadu〕 |
| Autora | 〔consultora responsável〕 |

---

## Controle de Versão e Aprovações

| Versão | Data | Autor(a) | Descrição da alteração | Status |
|---|---|---|---|---|
| 0.1 | 〔dd/mm/aaaa〕 | 〔autor〕 | Versão inicial — draft | Em elaboração |
|  |  |  |  |  |
|  |  |  |  |  |

### Aprovadores

| Papel | Nome | Organização | Data / Assinatura |
|---|---|---|---|
| Sponsor do projeto |  |  |  |
| Architecture Review Board / CTO Office |  |  |  |
| Process Owner — Configuration Management |  |  |  |
| Líder técnico ITOM |  |  |  |

---

## 1. Introdução

### 1.1 Propósito

Este documento descreve o desenho técnico da solução de Discovery e CMDB no ServiceNow para o cliente, estabelecendo a arquitetura-alvo, as decisões de modelagem de dados, a estratégia de identificação/reconciliação e os controles de governança que sustentam a qualidade da CMDB ao longo do ciclo de vida. Serve como referência técnica de implementação e como baseline para revisões de arquitetura e auditoria.

### 1.2 Escopo

O escopo é definido por capability ITOM e por família (Visibility, Health, Optimization). Cada linha é marcada como em escopo ou não, com a observação correspondente.

| Capability ITOM | Família | Em escopo? | Observações |
|---|---|---|---|
| Discovery (horizontal, vertical, cloud) | Visibility | 〔Sim/Não〕 | Servidores, network, storage, apps e recursos cloud |
| Service Mapping (top-down / bottom-up) | Visibility | 〔Sim/Não〕 | Serviços de negócio e técnicos |
| CMDB / CSDM (Foundation) | Visibility | Sim | Pré-requisito transversal de todas as demais |
| IRE — Identification & Reconciliation | Visibility | Sim | Identificação, reconciliação e dedup |
| Service Graph Connectors (SGC) | Visibility | 〔Sim/Não〕 | Ingestão agentless de datasources externos |
| Certificate Inventory & Management | Visibility | 〔Sim/Não〕 | Descoberta e ciclo de vida de certificados |
| Firewall Audit & Reporting | Visibility | 〔Sim/Não〕 | Mapeamento de regras de firewall |
| Event Management | Health | 〔Sim/Não〕 | Ingestão, dedup, correlação e supressão de eventos |
| Health Log Analytics (HLA) | Health | 〔Sim/Não〕 | Ingestão de logs + anomaly detection (ML) |
| Metric Intelligence / AIOps | Health | 〔Sim/Não〕 | Baseline de métricas, alert grouping, RCA |
| Service Operations Workspace (SOW) | Health | 〔Sim/Não〕 | Alert-to-incident, playbooks, mapa de saúde |
| Cloud Observability | Health | 〔Sim/Não〕 | Telemetria de ambientes cloud |
| Cloud Provisioning & Governance (CMP) | Optimization | 〔Sim/Não〕 | Provisionamento e governança multi-cloud |
| Cloud Cost / Insights & Tagging | Optimization | 〔Sim/Não〕 | Otimização de custo e governança de tags |

> **▸ Orientação.** Defina o escopo por capability e família, não por "tudo de ITOM". Escopo difuso é a causa raiz nº 1 de CMDB suja. CMDB/CSDM e IRE são pré-requisitos transversais — mantenha-os em escopo mesmo em projetos focados em Health/Optimization. Amarre cada item a um outcome mensurável (seção 2.2).

**Exclusões explícitas:** 〔liste o que está fora — ex.: integrações SaaS específicas, módulos de outra licença, ambientes/legados não cobertos nesta fase.〕

### 1.3 Audiência

Arquitetos de plataforma, administradores ServiceNow, equipes de infraestrutura/cloud, donos de processo de Configuration Management e stakeholders de auditoria/segurança.

### 1.4 Referências

- **CSDM White Paper** (versão corrente — atualmente com 7 domínios: Foundation, Ideation & Strategy, Design & Planning, Build & Integration, Service Delivery, Service Consumption, Manage Portfolios) — ServiceNow Community / Best Practices.
- **Product Documentation** — docs.servicenow.com (Discovery, CMDB, IRE, Service Mapping da release-alvo).
- **ServiceNow Best Practices** site (sucessor do Now Create desde 05/12/2025) — Success Packs e Process Guides.
- **CMDB Data Foundations / CMDB Health** — guias de governança e KPIs.

### 1.5 Glossário

| Termo | Definição |
|---|---|
| CI | Configuration Item — registro em `cmdb_ci` ou classe filha. |
| CSDM | Common Service Data Model — padrão prescritivo de modelagem da CMDB (não é SKU). |
| IRE | Identification & Reconciliation Engine — motor de identificação e reconciliação de payloads. |
| MID Server | Management, Instrumentation and Discovery Server — agente de borda para Discovery/integrações. |
| SGC | Service Graph Connector — integração agentless que popula a CMDB via IRE. |
| Authoritative datasource | Fonte declarada dona de um atributo; sobrescreve as demais na reconciliação. |

---

## 2. Visão Geral da Solução

### 2.1 Situação atual (As-Is)

> **▸ Orientação.** Descreva fontes de dados atuais da CMDB, nível de automação, sintomas de saúde (duplicatas, staleness, completeness baixa) e dores relatadas. Em projetos de remodelagem, anexe um diagnóstico quantitativo do CMDB Health Dashboard como baseline.

〔Descrição do ambiente atual, ferramentas legadas, integrações existentes e principais lacunas.〕

### 2.2 Objetivos de negócio e outcomes mensuráveis

| Outcome de negócio | Métrica / KPI | Baseline | Meta |
|---|---|---|---|
| Confiabilidade da CMDB para ITSM/ITOM | CMDB Health Score (completeness/correctness/compliance) | 〔%〕 | 〔%〕 |
| Redução de duplicatas | Nº de CIs duplicados (`cmdb_dedup_task`) | 〔n〕 | 〔n〕 |
| Cobertura de Discovery | % de CIs ativos com `last_discovered` < threshold | 〔%〕 | 〔%〕 |
| Qualidade de impacto em incidentes | % de incidentes com CI/serviço corretamente associado | 〔%〕 | 〔%〕 |
| Redução de MTTR | Tempo médio de resolução de incidentes de infra | 〔min〕 | 〔min〕 |
| Redução de ruído de alertas | Taxa de compressão evento→alerta (correlação/dedup) | 〔ratio〕 | 〔ratio〕 |
| Automação alert-to-incident | % de alertas que geram incidente automaticamente (SOW) | 〔%〕 | 〔%〕 |
| Visibilidade de serviço | Nº de Business Services com mapa de saúde ativo | 〔n〕 | 〔n〕 |
| Otimização de custo cloud | Economia identificada / recursos ociosos (Optimization) | 〔R$/%〕 | 〔R$/%〕 |
| Agilidade de onboarding de fontes | Lead time para integrar novo datasource à CMDB | 〔dias〕 | 〔dias〕 |

### 2.3 Arquitetura-alvo (To-Be)

> **▸ Orientação.** Insira aqui o diagrama de arquitetura (instância ServiceNow ↔ MID Servers ↔ redes/datacenters/cloud ↔ datasources externos).

〔Diagrama de arquitetura-alvo.〕

### 2.4 Premissas, restrições e dependências

#### 2.4.1 Premissas

- Portas de Discovery liberadas entre MID Servers e alvos conforme matriz de comunicação (SNMP/WMI/SSH/JDBC/HTTPS).
- Contas de serviço e credenciais providas pelo cliente e armazenadas em cofre (CyberArk / Key Vault / Secrets Manager).
- VMs de MID Server dimensionadas e provisionadas pelo cliente antes do início da fase de Discovery.
- Acesso a APIs/roles das contas cloud (AWS/Azure/GCP) para Cloud Discovery e Optimization.
- Ferramentas de monitoração/observabilidade do cliente disponibilizam conectores ou endpoints para Event Management/HLA.

#### 2.4.2 Restrições

- Janelas de varredura acordadas para ambientes sensíveis/produtivos.
- Segmentação de rede e regras de firewall que exigem MID Server por zona isolada.
- Requisitos de compliance/regulatórios (LGPD, segregação de dados, retenção de logs).
- Release-alvo da plataforma fixa o conjunto de features disponíveis (ex.: credential-less cloud, CI Class Manager v2).

#### 2.4.3 Dependências

- Provisionamento de VMs de MID Server e conectividade às subnets-alvo.
- Aprovação e implementação de regras de firewall pelas áreas de Segurança/Redes.
- Definição de fontes autoritativas por atributo em conjunto com os donos de cada sistema.
- Disponibilidade dos donos de aplicação para validar Business Apps e dependências (Service Mapping).

#### 2.4.4 Esforço e responsabilidades do cliente

> **● Dependência colaborativa.** Este projeto tem forte dependência de ação colaborativa com áreas técnicas e de negócio do cliente — em especial Infraestrutura, Segurança e Observabilidade. O cronograma e a qualidade dos entregáveis dependem diretamente da disponibilidade dessas equipes para liberação de acessos, aprovação de regras, fornecimento de credenciais e validação de dados. Atrasos nessas frentes impactam marcos do projeto e devem ser tratados como risco de cronograma compartilhado, com pontos focais nomeados por área.

| Área do cliente | Contribuição esperada | Criticidade | Impacto se ausente |
|---|---|---|---|
| Infraestrutura | Liberação de portas, contas de serviço, inventário de credenciais e validação de CIs descobertos | Alta | Discovery incompleto; CMDB com lacunas |
| Segurança / SecOps | Aprovação de regras de firewall, política de credenciais/cofre e exceções de scanning | Alta | Bloqueio de varredura; atraso de cronograma |
| Observabilidade / Monitoração | Integração das ferramentas (Dynatrace, Datadog, Splunk, Zabbix etc.) para Event Management/HLA | Alta | Event Management sem fonte; AIOps sem dados |
| Redes | Mapa de subnets, ACLs e definição de posicionamento dos MID Servers | Média/Alta | MID mal posicionado; affinity incorreta |
| Cloud / FinOps | Credenciais/roles cloud, estratégia de tags e acesso a billing | Média | Cloud Discovery/Optimization limitado |
| Donos de aplicação | Validação de Business Apps, entry points e dependências de serviço | Média | Service Mapping impreciso |
| Identidade / IAM | Provisionamento de contas de serviço, SSO e roles na plataforma | Média | Atraso na liberação de acessos |

---

## 3. Estratégia de CMDB e Alinhamento CSDM

### 3.1 Princípios de governança

- Configuração sobre customização: estender a classe mais específica possível; nunca estender `cmdb_ci` diretamente.
- CMDB precede workflow: a acurácia da CMDB é pré-requisito (ou paralela) à configuração de processos, não tarefa pós-go-live.
- Toda classe em escopo tem fonte autoritativa declarada e owner de dados nomeado.
- Adoção do CSDM por estágios — crawl, walk, run, fly — nunca todos os domínios de uma vez.

### 3.2 Domínios CSDM em escopo

| Domínio CSDM | Em escopo? | Classes/objetos-chave | Observações |
|---|---|---|---|
| Foundation | 〔Sim/Não〕 | `cmdb_ci_*`, `cmn_location`, `cmn_department`, `sys_user_group` | Base referencial; pré-requisito dos demais. |
| Manage Technical Services | 〔Sim/Não〕 | `cmdb_ci_service_discovered`, `cmdb_ci_appl` | Serviços técnicos descobertos. |
| Service Delivery / Design | 〔Sim/Não〕 | `cmdb_ci_business_app`, `service_offering` | Mapeamento de aplicação de negócio. |

> **▸ Orientação.** A nomenclatura/contagem de domínios varia por versão do white paper CSDM (a versão corrente trabalha com 7 domínios). Confirme contra o white paper vigente e ajuste a tabela.

### 3.3 Estratégia de classes de CI

| Classe (`cmdb_ci_*`) | Fonte autoritativa | Método de população | Owner de dados | Camada CSDM |
|---|---|---|---|---|
| `cmdb_ci_linux_server` | Discovery | Horizontal (SSH) + pattern | 〔time infra〕 | Foundation |
| `cmdb_ci_win_server` | Discovery | Horizontal (WMI) + pattern | 〔time infra〕 | Foundation |
| `cmdb_ci_vm_instance` | Cloud (API) | Cloud Discovery / SGC | 〔time cloud〕 | Foundation |
| `cmdb_ci_business_app` | Manual / APM | CSDM wizard | 〔dono de app〕 | Design |

### 3.4 Política de extensão de classe

Extensões via CI Class Manager (recomendado Tokyo+). Atributos novos em `sys_dictionary` vinculados à classe específica. Extensão sem alinhamento CSDM quebra KPIs de CMDB Health e relatórios de compliance — toda extensão passa por revisão de arquitetura.

### 3.5 Modelo de relacionamentos

| Relacionamento (parent::child) | rel_type | Uso | Reconhecido por Service Mapping? |
|---|---|---|---|
| Runs on::Runs | Aplicação → Host | App roda em servidor | Sim |
| Hosted on::Hosts | VM → Hypervisor | Hospedagem | Sim |
| Depends on::Used by | Serviço → Serviço | Dependência lógica | Sim |
| 〔customizado〕 | 〔definir descriptors〕 |  |  |

> **▸ Orientação.** Relacionamentos duplicados vindos de múltiplos datasources sem reconciliação são fonte comum de ruído — popule o campo `source` em `cmdb_rel_ci` e governe por datasource.

### 3.6 Separação Asset × CI (touchpoint ITAM)

Ativo (`alm_asset`) rastreia dados financeiros/contratuais — compra, garantia, custo, ciclo de vida. CI (`cmdb_ci`) rastreia características técnicas e relacionamentos — OS, software instalado, dependências. Cada ativo de interesse referencia o CI correspondente. Manter os domínios separados conserva ambos os conjuntos limpos e auditáveis e é pré-requisito para SAM/HAM.

---

## 4. Arquitetura de Discovery

### 4.1 Tipos de Discovery em escopo

| Tipo | Protocolo / mecanismo | Escopo-alvo | Em escopo? |
|---|---|---|---|
| Horizontal | SNMP, WMI, SSH, JDBC | Servidores, network, storage | 〔Sim/Não〕 |
| Vertical (app) | WMI/SSH + patterns | Apps sobre CIs já conhecidos | 〔Sim/Não〕 |
| Cloud | APIs nativas (AWS/Azure/GCP) | VMs, instâncias, recursos cloud | 〔Sim/Não〕 |
| Agentless (SGC) | REST/GraphQL → IRE | Datasources externos | 〔Sim/Não〕 |
| Agent-based | ServiceNow Agent | Endpoints offline-friendly | 〔Sim/Não〕 |

### 4.2 Arquitetura de MID Server

- Regra base: um MID Server por subnet isolada por firewall.
- HA: par Ativo/Passivo com mesmo `name` (failover automático); `mid.cluster.node.name` distinto por nó.
- Affinity (`mid.affinity`) por IP range ou Classification — impede MID errado de atender CI crítico.
- Sizing/tuning: `max.threads` (default 25) e `glide.discovery.max_concurrent_probes` conforme volume.

| MID Server | Datacenter / Subnet | Modo (Active/HA) | Affinity | VM (vCPU/RAM) |
|---|---|---|---|---|
| mid-〔dc1〕-01 | 〔10.x.0.0/24〕 | Active | 〔range〕 | 〔4/8〕 |
| mid-〔dc1〕-02 | 〔10.x.0.0/24〕 | Passive (HA) | 〔range〕 | 〔4/8〕 |

### 4.3 Gestão de credenciais

Credenciais em `discovery_credentials` por tipo (SSH, WMI, SNMP v1/v2/v3, VMware, AWS, etc.), com `credential_affinity` por CI ou IP range. Para CIs cloud, preferir credential-less (Xanadu+) via Instance Role / Managed Identity, eliminando segredos estáticos. Integração com cofre externo: 〔ex.: CyberArk / Azure Key Vault〕.

### 4.4 Discovery Schedules

| Schedule | Tipo | Range / fonte | Frequência | Behavior on conflict |
|---|---|---|---|---|
| DS-Infra-Linux | Horizontal | 〔range〕 | Diária 〔hh:mm〕 | Merge |
| DS-Cloud-AWS | Cloud | 〔conta/região〕 | 〔4h〕 | Merge |

> **▸ Orientação.** Use Merge (não Replace) e habilite `include_active_cls` para que CIs ativos não sejam removidos por scope vazio. Documente Quick Discovery para validação pós-deploy.

### 4.5 Patterns e customizações

Patterns em Pattern Designer (`sa_pattern`): Entry Point → Operations (Find/Parse/Collect/Identify) → output vars → CI payload. Scripted operations em Jython 2.7. Override de sensor OOTB: clonar pattern, desabilitar original, ativar clone. Debug via Pattern Tester contra IP real. Patterns verticais exigem CI já existente com IP populado.

| Pattern | Tipo | Customização? | Justificativa |
|---|---|---|---|
| 〔nome〕 | Horizontal/Vertical | OOTB / Clonado | 〔motivo〕 |
|  |  |  |  |

---

## 5. Identification & Reconciliation (IRE)

### 5.1 Fluxo IRE

Payload (Discovery / SGC / Import Set / REST) → Identification Rules por classe → lookup de CI existente → se match: Reconciliation Rules (quem atualiza o quê); se no-match: criação do CI (se datasource autorizado).

### 5.2 Identification Rules por classe

Regras em `cmdb_identifier_entry`. A ordem importa — a primeira regra com match vence. Tipos: Independent (atributos do próprio CI) e Dependent (exige CI pai identificado antes). Atributo de identidade nulo gera match parcial e duplicatas — usar `independent_identifier_qualifier` para excluir nulos.

| Classe | Atributos de identidade (ordem) | Tipo | Qualifier (exclui nulos) |
|---|---|---|---|
| `cmdb_ci_hardware` | serial_number → name+ip_address | Independent | `serial_number != ''` |
| `cmdb_ci_appl` | CI pai (host) + name + port | Dependent | `name != ''` |
| 〔classe〕 | 〔atributos〕 | 〔Ind/Dep〕 | 〔qualifier〕 |

### 5.3 Reconciliation Rules e datasources autoritativos

Reconciliation em `cmdb_reconciliation_rule`: o datasource com maior `precedence` vence o atributo disputado. `authoritative` torna o datasource dono absoluto; `authoritative_overwrite_on_empty` permite limpar o campo mesmo com valor vazio. Mapeamento atributo→datasource em `cmdb_data_source_for_attribute`.

| Atributo | Datasources concorrentes | Datasource autoritativo | Precedence | Overwrite on empty? |
|---|---|---|---|---|
| os / os_version | Discovery, SCCM | Discovery | Alta | Não |
| assigned_to | SCCM, Import HR | Import HR | Alta | Não |
| serial_number | Discovery, SGC | Discovery | Alta | Não |

### 5.4 Estratégia de deduplicação

Job CMDB Deduplication (`cmdb_dedup`): Master CI absorve duplicatas e os relacionamentos migram automaticamente. Tarefas em `cmdb_dedup_task` — revisar antes de executar em produção. Dedup agressivo sem corrigir as IR rules recria duplicatas no próximo Discovery: a correção da regra precede a deduplicação.

### 5.5 Tratamento de stale CIs

Config em `cmdb_stale_ci_config` por classe (threshold em dias + ação). Discovery atualiza `last_discovered` a cada run bem-sucedido; fontes externas dependem de `last_seen_by_datasource`. Distinguir retire (`install_status=7`, permanece em `cmdb_ci`) de delete.

| Classe | Threshold (dias) | Ação | Origem do last_seen |
|---|---|---|---|
| `cmdb_ci_server` | 〔45〕 | Mark stale → retire | Discovery |
| `cmdb_ci_vm_instance` | 〔7〕 | Retire | Cloud API |

---

## 6. Service Mapping

> **▸ Orientação.** Inclua esta seção apenas se Service Mapping estiver em escopo. Caso contrário, marque como N/A e mantenha para versões futuras.

### 6.1 Abordagem

| Critério | Top-Down | Bottom-Up |
|---|---|---|
| Entrada | Business Service + Entry Point (IP:porta) | CI já existente na CMDB |
| Fluxo | Segue conexões de rede a partir do entry point | Infere serviço a partir do CI |
| Uso ideal | Mapear serviços de negócio | Completar lacunas de CMDB existente |
| Dependência | MID com acesso pleno à rede | CIs bem preenchidos |

### 6.2 Entry points e patterns de mapeamento

Entry points em `sa_entry_point` (IP, porta, protocolo); patterns de mapeamento em `sa_pattern_mapping`. Traffic-based discovery usa conexões ativas/netflow para dependências reais. Entry point sobre VIP de load balancer mascara backends — usar VIP awareness. Controlar loops com `max_depth` no schedule (default 10).

---

## 7. CMDB Health e Governança Contínua

### 7.1 KPIs de saúde

| Métrica | Definição | Fonte (tabela/módulo) | Meta |
|---|---|---|---|
| Completeness | % de atributos obrigatórios preenchidos | `cmdb_health_result` | 〔%〕 |
| Correctness | Atributos com valor válido (formato/lista) | `cmdb_health_result` | 〔%〕 |
| Compliance | CIs aderentes às políticas definidas | `cmdb_health_kpi_defn` | 〔%〕 |
| Staleness | CIs além do threshold de atualização | `cmdb_stale_ci_config` | 〔%〕 |
| Duplicates | CIs com mesma identidade | `cmdb_dedup_task` | 〔n〕 |

> **▸ Orientação.** Health score baixo costuma vir de classes sem KPI definitions configuradas — verifique `cmdb_health_kpi_defn` por classe antes de concluir que o dado está ruim.

### 7.2 Dashboards e cadência de revisão

CMDB Health Dashboard revisado em cadência 〔semanal/mensal〕 pelo Configuration Manager. Tendência por classe e por domínio CSDM. Gatilhos de remediação quando KPI cai abaixo da meta.

### 7.3 Ownership e RACI

| Atividade | Process Owner | Data Steward | Time técnico | Sponsor |
|---|---|---|---|---|
| Definição de políticas de dados | A | R | C | I |
| Correção de duplicatas/staleness | A | C | R | I |
| Aprovação de extensão de classe | A | C | R | I |
| Revisão de Health KPIs | R | R | C | I |

*Legenda: R = Responsável · A = Aprovador · C = Consultado · I = Informado.*

---

## 8. Segurança, Acessos e Integrações

### 8.1 Roles e ACLs

| Função | Role ServiceNow | Escopo de acesso |
|---|---|---|
| Administração de Discovery | `discovery_admin` | Schedules, MID, patterns |
| Gestão de CMDB | `itil` / `cmdb_admin` | CIs e relacionamentos |
| Leitura de CMDB | `snc_read_only` / custom | Consulta |

### 8.2 Datasources externos (integrações)

| Datasource | Método | Atributos contribuídos | Autoritativo p/ | Frequência |
|---|---|---|---|---|
| SCCM/Intune | SGC | OS, software, assigned_to | assigned_to | Diária |
| 〔CMDB legada〕 | Import Set → IRE | 〔atributos〕 | 〔—〕 | 〔—〕 |

---

## 9. Plano de Implementação Faseado

Adoção incremental alinhada ao princípio crawl-walk-run-fly do CSDM. Cada fase entrega valor mensurável e estabiliza a CMDB antes da próxima.

| Fase | Conteúdo | Critério de saída | Janela |
|---|---|---|---|
| Crawl | Foundation + Discovery horizontal core; IR rules base | Health > 〔meta〕 nas classes-core | 〔sprint〕 |
| Walk | Cloud Discovery + SGC; reconciliation multi-source | Dedup < 〔meta〕; precedence definida | 〔sprint〕 |
| Run | Vertical/app discovery; relacionamentos | Cobertura de apps 〔%〕 | 〔sprint〕 |
| Fly | Service Mapping; governança contínua | Serviços mapeados 〔n〕 | 〔sprint〕 |

---

## 10. Critérios de Aceite e Testes

| ID | Cenário | Critério de aceite | Resultado |
|---|---|---|---|
| T-01 | Discovery horizontal Linux | CI criado com classe, OS, IP, serial corretos; sem duplicata | 〔Pass/Fail〕 |
| T-02 | Reconciliação multi-source | Atributo autoritativo prevalece conforme precedence | 〔Pass/Fail〕 |
| T-03 | Dedup | Master absorve duplicata; relacionamentos migrados | 〔Pass/Fail〕 |
| T-04 | Stale CI | CI além do threshold marcado/retired conforme política | 〔Pass/Fail〕 |

---

## 11. Riscos e Mitigações

| Risco | Impacto | Prob. | Mitigação |
|---|---|---|---|
| Escopo difuso de Discovery | CMDB suja, retrabalho | Alta | Escopo por capability + outcome; fases crawl-walk-run |
| IR rules com atributo nulo | Duplicatas em massa | Média | Qualifiers excluindo nulos; revisão pré-prod |
| MID sem affinity | CI crítico atendido por MID errado | Média | `mid.affinity` por range/classification |
| Extensão de classe fora do CSDM | Quebra de Health KPIs/relatórios | Média | Revisão de arquitetura obrigatória |

---

## Anexo A — Inventário consolidado de classes de CI

> **▸ Orientação.** Tabela viva — mantenha sincronizada com a seção 3.3. Em projetos de remodelagem, gere a partir de um export de `sys_db_object` filtrado por `super_class = cmdb_ci`.

| Classe | Label | Estende | Fonte autoritativa | Em escopo |
|---|---|---|---|---|
|  |  |  |  |  |
|  |  |  |  |  |
|  |  |  |  |  |

## Anexo B — Matriz de reconciliação por atributo

| Atributo | Tabela | Datasource autoritativo | Demais fontes | Regra |
|---|---|---|---|---|
|  |  |  |  |  |
|  |  |  |  |  |
