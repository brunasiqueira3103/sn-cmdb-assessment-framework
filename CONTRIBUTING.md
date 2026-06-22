# Como Contribuir

Obrigado pelo interesse em contribuir com o **ServiceNow CMDB Baseline Diagnostic**!

## Processo de Contribuição

1. Faça um **Fork** deste repositório
2. Crie uma branch a partir da `main` seguindo o padrão de nomenclatura
3. Faça suas alterações
4. Envie um **Pull Request** para a branch `main`

---

## Padrão de Nomenclatura

### Branches
- `feature/nome-da-funcionalidade`
- `bugfix/descricao-do-bug`
- `enhancement/melhoria`
- `docs/atualizacao-documentacao`
- `hotfix/nome-do-problema`

**Exemplos:**
- `feature/ire-suporte-heranca`
- `bugfix/health-deteccao-tabela`

### Commits
Utilizamos o padrão **Conventional Commits** (veja tabela abaixo).

---

## Fluxo de Revisão Obrigatório

**Todo Pull Request deve passar por revisão antes de ser mergeado.**

### Etapas Obrigatórias:

1. **Criação do PR**
   - Título deve seguir o padrão Conventional Commits (`feat:`, `fix:`, `docs:`, etc.)
   - Descrição clara com:
     - Motivo da mudança
     - O que foi alterado
     - Como testar
     - Screenshots (se afetar interface)

2. **Validações Automáticas** (quando configurado)
   - Testes (se existirem)
   - Lint do código JavaScript
   - Markdown válido

3. **Revisão Humana Obrigatória**
   - Todo PR deve ser revisado por **pelo menos 1 revisor aprovado**
   - O mantenedor principal (*@brunasiqueira*) é o revisor final e responsável pela aprovação
   - Revisores devem verificar:
     - Qualidade do código
     - Fidelidade ao objetivo do framework
     - Não introdução de regressões
     - Documentação atualizada (se aplicável)
     - Testes manuais na console

4. **Aprovação e Merge**
   - Somente o mantenedor principal pode aprovar e realizar o merge
   - Merge só será feito após:
     - Todas as conversas resolvidas
     - Aprovação explícita (`Approved`)
     - Testes manuais bem-sucedidos (quando aplicável)

---

## Quem Aprova?

- **Mantenedor Principal**: **[@brunasiqueira]**  
  → Responsável final por todas as aprovações e merges na branch `main`.

Você pode adicionar co-maintainers no futuro.

---

## Padrão de Commits (Conventional Commits)

| Tipo         | Uso                                      | Exemplo |
|--------------|------------------------------------------|--------|
| `feat`       | Nova funcionalidade                      | `feat(ire): suporte a herança de classes` |
| `fix`        | Correção de bug                          | `fix(credentials): classificação de indeterminadas` |
| `docs`       | Alterações na documentação               | `docs: atualizar guia do administrador` |
| `refactor`   | Refatoração sem mudança de comportamento | `refactor(parser): melhorar normLine` |
| `style`      | Formatação e estilo                      | `style: padronizar indentação` |
| `test`       | Adição/correção de testes                | `test: adicionar caso de sensor legado` |
| `chore`      | Manutenção                               | `chore: atualizar changelog` |

---

## Dúvidas ou Sugestões?

- Abra uma **[Issue](https://github.com/brunasiqueira3103/sn-cmdb-assessment-framework/issues)** antes de começar a trabalhar em algo grande.
- Participe das discussões existentes.

---

**Agradecemos sua contribuição!** 🚀

