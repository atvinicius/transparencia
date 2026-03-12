import type { CamaraDeputyData } from "../sources/camara.js";
import type { CandidateProfile, Fact, VotingSummary, Proposal, Source } from "../schemas/index.js";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function normalizeCamaraDeputy(data: CamaraDeputyData): CandidateProfile {
  const now = new Date().toISOString();
  const source: Source = data.source;
  const facts: Fact[] = [];

  // --- Voting facts ---
  const { total, present, absent, abstained } = data.votingSummary;

  if (total > 0) {
    facts.push({
      id: `camara-votacao-presenca-${data.id}`,
      label: "Presença em votações (amostra recente)",
      value: present,
      context: `de ${total} votações analisadas`,
      source,
      dimension: "historico",
      category: "Votações",
    });

    facts.push({
      id: `camara-votacao-ausencia-${data.id}`,
      label: "Ausências em votações (amostra recente)",
      value: absent,
      context: `de ${total} votações analisadas`,
      source,
      dimension: "historico",
      category: "Votações",
    });

    if (abstained > 0) {
      facts.push({
        id: `camara-votacao-abstencao-${data.id}`,
        label: "Abstenções em votações (amostra recente)",
        value: abstained,
        context: `de ${total} votações analisadas`,
        source,
        dimension: "historico",
        category: "Votações",
      });
    }

    const presenceRate = total > 0 ? Math.round((present / total) * 100) : 0;
    facts.push({
      id: `camara-votacao-taxa-${data.id}`,
      label: "Taxa de presença em votações",
      value: `${presenceRate}%`,
      context: `baseado em ${total} votações analisadas`,
      source,
      dimension: "historico",
      category: "Votações",
    });
  }

  // --- Proposal facts ---
  facts.push({
    id: `camara-proposicoes-total-${data.id}`,
    label: "Proposições legislativas apresentadas",
    value: data.proposals.length,
    context: "como autor(a) principal",
    source,
    dimension: "historico",
    category: "Produção Legislativa",
  });

  const approved = data.proposals.filter(
    (p) => p.status.toLowerCase().includes("aprovad") || p.status.toLowerCase().includes("lei"),
  );
  if (approved.length > 0) {
    facts.push({
      id: `camara-proposicoes-aprovadas-${data.id}`,
      label: "Proposições aprovadas/transformadas em lei",
      value: approved.length,
      context: `de ${data.proposals.length} apresentadas`,
      source,
      dimension: "historico",
      category: "Produção Legislativa",
    });
  }

  // --- Biographical facts ---
  if (data.education) {
    facts.push({
      id: `camara-escolaridade-${data.id}`,
      label: "Escolaridade",
      value: data.education,
      source,
      dimension: "historico",
      category: "Informações Pessoais",
    });
  }

  // --- Build voting summaries ---
  const votingSummaries: VotingSummary[] = [];
  if (total > 0) {
    votingSummaries.push({
      legislature: `57ª Legislatura (2023-2027)`,
      totalVotes: total,
      present,
      absent,
      abstained,
      source,
    });
  }

  // --- Build proposals list ---
  const normalizedProposals: Proposal[] = data.proposals.map((p) => ({
    id: `camara-prop-${p.id}`,
    type: p.type,
    number: p.number,
    year: p.year,
    summary: p.summary,
    status: p.status,
    theme: p.keywords[0],
    url: p.url,
    source,
  }));

  // --- Themes from proposals ---
  const themes = new Set<string>();
  for (const p of data.proposals) {
    for (const k of p.keywords) {
      themes.add(k);
    }
  }

  return {
    slug: slugify(data.shortName),
    name: data.name,
    shortName: data.shortName,
    photoUrl: data.photoUrl,
    currentParty: data.party,
    state: data.state,
    birthDate: data.birthDate,
    education: data.education,
    occupation: undefined,

    officesHeld: [
      {
        role: "Deputado(a) Federal",
        location: data.state,
        startYear: 2023,
        party: data.party,
        elected: true,
        source,
      },
    ],
    votingSummaries,
    proposals: normalizedProposals,

    governmentPlanUrl: undefined,
    legislativeThemes: [...themes],

    assetDeclarations: [],
    campaignFinances: [],

    partyHistory: [],

    facts,
    lastUpdated: now,
    sources: ["Câmara dos Deputados - Dados Abertos"],
  };
}
