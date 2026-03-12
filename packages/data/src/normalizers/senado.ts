import type { SenadoSenadorData } from "../sources/senado.js";
import type { CandidateProfile, Fact, VotingSummary, Proposal, Source } from "../schemas/index.js";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function normalizeSenador(data: SenadoSenadorData): CandidateProfile {
  const now = new Date().toISOString();
  const source: Source = data.source;
  const facts: Fact[] = [];

  // --- Voting facts ---
  const { total, present, absent, abstained } = data.votingSummary;

  if (total > 0) {
    facts.push({
      id: `senado-votacao-presenca-${data.codigo}`,
      label: "Presença em votações",
      value: present,
      context: `de ${total} votações registradas`,
      source,
      dimension: "historico",
      category: "Votações",
    });

    facts.push({
      id: `senado-votacao-ausencia-${data.codigo}`,
      label: "Ausências em votações",
      value: absent,
      context: `de ${total} votações registradas`,
      source,
      dimension: "historico",
      category: "Votações",
    });

    if (abstained > 0) {
      facts.push({
        id: `senado-votacao-abstencao-${data.codigo}`,
        label: "Abstenções em votações",
        value: abstained,
        context: `de ${total} votações registradas`,
        source,
        dimension: "historico",
        category: "Votações",
      });
    }

    const presenceRate = total > 0 ? Math.round((present / total) * 100) : 0;
    facts.push({
      id: `senado-votacao-taxa-${data.codigo}`,
      label: "Taxa de presença em votações",
      value: `${presenceRate}%`,
      context: `baseado em ${total} votações registradas`,
      source,
      dimension: "historico",
      category: "Votações",
    });
  }

  // --- Proposal facts ---
  facts.push({
    id: `senado-proposicoes-total-${data.codigo}`,
    label: "Matérias legislativas de autoria",
    value: data.proposals.length,
    context: "como autor(a) principal",
    source,
    dimension: "historico",
    category: "Produção Legislativa",
  });

  const approved = data.proposals.filter(
    (p) =>
      p.status.toLowerCase().includes("aprovad") ||
      p.status.toLowerCase().includes("lei") ||
      p.status.toLowerCase().includes("promulgad"),
  );
  if (approved.length > 0) {
    facts.push({
      id: `senado-proposicoes-aprovadas-${data.codigo}`,
      label: "Matérias aprovadas/transformadas em norma jurídica",
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
      id: `senado-escolaridade-${data.codigo}`,
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
      legislature: "57ª Legislatura (2023-2031)",
      totalVotes: total,
      present,
      absent,
      abstained,
      source,
    });
  }

  // --- Build proposals list ---
  const normalizedProposals: Proposal[] = data.proposals.map((p) => ({
    id: `senado-materia-${p.id}`,
    type: p.type,
    number: parseInt(p.number, 10) || 0,
    year: parseInt(p.year, 10) || 0,
    summary: p.summary,
    status: p.status,
    theme: undefined,
    source,
  }));

  return {
    slug: slugify(data.name),
    name: data.fullName,
    shortName: data.name,
    photoUrl: data.photoUrl,
    currentParty: data.party,
    state: data.state,
    birthDate: data.birthDate,
    education: data.education,
    occupation: undefined,

    officesHeld: [
      {
        role: "Senador(a)",
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
    legislativeThemes: [],

    assetDeclarations: [],
    campaignFinances: [],

    partyHistory: [],

    facts,
    lastUpdated: now,
    sources: ["Senado Federal - Dados Abertos"],
  };
}
