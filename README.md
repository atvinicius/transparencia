# Transparência

Plataforma de transparência com dados factuais sobre representantes e candidatos às eleições brasileiras.

**[Ver o site](https://atvinicius.github.io/transparencia/)**

## O que é

O Transparência coleta automaticamente dados de APIs oficiais do governo brasileiro e apresenta informações verificáveis sobre políticos — sem opiniões, sem rankings, apenas fatos com citação da fonte.

### Dimensões de avaliação

- **Histórico e Experiência** — Cargos ocupados, presença em votações, projetos de lei
- **Propostas e Posições** — Planos de governo, áreas de atuação legislativa
- **Integridade e Situação Legal** — Declaração de bens, contas de campanha, sanções, processos
- **Compromissos e Coerência** — Histórico partidário, coligações

### Fontes de dados

| Fonte | Tipo | Auth |
|-------|------|------|
| [Câmara dos Deputados](https://dadosabertos.camara.leg.br) | Deputados, votações, proposições | Não |
| [Senado Federal](https://legis.senado.leg.br/dadosabertos) | Senadores, votações, matérias | Não |
| [TSE — DivulgaCandContas](https://divulgacandcontas.tse.jus.br) | Candidaturas, bens, finanças | Não |
| [Portal da Transparência](https://portaldatransparencia.gov.br) | Sanções (CEIS/CNEP/CEAF) | API key |
| [CNJ DataJud](https://www.cnj.jus.br/sistemas/datajud) | Processos judiciais | API key |

## Stack

- **Monorepo**: pnpm workspaces
- **Pipeline de dados**: TypeScript + tsx + Zod
- **Site estático**: Astro + Tailwind CSS v3
- **CI/CD**: GitHub Actions → GitHub Pages

## Começando

```bash
# Instalar dependências
pnpm install

# Executar pipeline de dados (busca 5 candidatos por fonte)
pnpm pipeline --limit 5

# Iniciar servidor de desenvolvimento
pnpm dev

# Build do site estático
pnpm build
```

### Fontes com API key

Para habilitar Portal da Transparência e CNJ DataJud, crie um arquivo `.env`:

```bash
cp .env.example .env
# Edite .env com suas chaves
```

### Comandos do pipeline

```bash
pnpm pipeline                    # Todas as fontes
pnpm pipeline --limit 10        # Limitar candidatos por fonte
pnpm pipeline --source camara   # Apenas Câmara
pnpm pipeline --source senado   # Apenas Senado
```

## Estrutura do projeto

```
packages/
├── data/                  # Pipeline de dados
│   ├── src/
│   │   ├── sources/       # Fetchers por API (camara, senado, tse, etc.)
│   │   ├── normalizers/   # Transformam dados brutos → perfil unificado
│   │   ├── schemas/       # Schemas Zod
│   │   ├── utils/         # HTTP client, rate limiter
│   │   └── pipeline.ts    # Orquestrador
│   └── output/            # JSON gerado (consumido pelo site)
└── web/                   # Site Astro
    └── src/
        ├── pages/         # Rotas (index, candidato, comparar, etc.)
        ├── components/    # Componentes reutilizáveis
        └── layouts/       # Layout base
```

## Princípios

1. **Cada fato tem citação** — nenhum dado sem fonte verificável
2. **Sem opiniões** — fatos para o eleitor decidir
3. **Automatizado** — `pnpm pipeline` regenera todos os dados
4. **Código aberto** — auditável por qualquer pessoa

## Licença

MIT
