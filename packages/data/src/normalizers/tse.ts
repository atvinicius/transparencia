import type { TseCandidatoData, TseElectionEntry } from "../sources/tse.js";
import type {
  CandidateProfile,
  AssetDeclaration,
  OfficeHeld,
  Fact,
} from "../schemas/index.js";

/**
 * Result of normalizing TSE data — partial profile fields
 * ready to be merged into an existing CandidateProfile.
 */
export interface TseNormalized {
  assetDeclarations: AssetDeclaration[];
  officesHeld: OfficeHeld[];
  partyHistory: Array<{ party: string; startYear: number; endYear?: number }>;
  facts: Fact[];
}

/**
 * Normalizes raw TSE candidate data into partial profile fields.
 * Used by the pipeline to enrich existing profiles.
 */
export function normalizeTse(tseData: TseCandidatoData): TseNormalized {
  const facts: Fact[] = [];
  const assetDeclarations: AssetDeclaration[] = [];
  const officesHeld: OfficeHeld[] = [];
  const partyHistory: Array<{ party: string; startYear: number; endYear?: number }> = [];

  // --- Asset declarations ---

  for (const election of tseData.elections) {
    if (election.assets.length === 0 && !election.totalAssets) continue;

    const totalDeclared =
      election.totalAssets ?? election.assets.reduce((s, a) => s + a.value, 0);

    assetDeclarations.push({
      electionYear: election.year,
      totalDeclared,
      items: election.assets.map((a) => ({
        description: a.description,
        value: a.value,
      })),
      source: election.source,
    });

    facts.push({
      id: `tse-bens-total-${election.year}`,
      label: `Bens declarados na eleição de ${election.year}`,
      value: formatCurrency(totalDeclared),
      context: `${election.assets.length} item(ns) declarado(s)`,
      source: election.source,
      dimension: "integridade",
      category: "Patrimônio",
    });
  }

  // Asset evolution across elections (if multiple years available)
  const sortedAssets = [...assetDeclarations].sort(
    (a, b) => a.electionYear - b.electionYear,
  );
  if (sortedAssets.length >= 2) {
    const oldest = sortedAssets[0];
    const newest = sortedAssets[sortedAssets.length - 1];

    if (oldest.totalDeclared > 0) {
      const changePercent = Math.round(
        ((newest.totalDeclared - oldest.totalDeclared) / oldest.totalDeclared) *
          100,
      );
      const direction = changePercent >= 0 ? "aumento" : "redução";

      facts.push({
        id: `tse-bens-evolucao`,
        label: "Evolução patrimonial declarada",
        value: `${Math.abs(changePercent)}% de ${direction}`,
        context: `de ${oldest.electionYear} (${formatCurrency(oldest.totalDeclared)}) a ${newest.electionYear} (${formatCurrency(newest.totalDeclared)})`,
        source: newest.source,
        dimension: "integridade",
        category: "Patrimônio",
      });
    }
  }

  // --- Campaign spending from TSE details ---

  for (const election of tseData.elections) {
    const spending1T = (election as TseElectionEntry).campaignSpending1T;
    const spending2T = (election as TseElectionEntry).campaignSpending2T;
    const totalSpending = (spending1T || 0) + (spending2T || 0);

    if (totalSpending > 0) {
      facts.push({
        id: `tse-gasto-campanha-${election.year}`,
        label: `Gasto de campanha declarado (${election.year})`,
        value: formatCurrency(totalSpending),
        context: spending2T
          ? `1º turno: ${formatCurrency(spending1T || 0)} | 2º turno: ${formatCurrency(spending2T)}`
          : `1º turno`,
        source: election.source,
        dimension: "integridade",
        category: "Financiamento de Campanha",
      });
    }
  }

  // --- Offices held (election history) ---

  for (const election of tseData.elections) {
    const resultLower = (election.result || election.situation || "").toLowerCase();
    const elected = resultLower.includes("eleit") && !resultLower.includes("não eleit");

    officesHeld.push({
      role: election.role,
      location: election.location,
      startYear: election.year,
      endYear: elected ? election.year + 4 : election.year,
      party: election.party,
      elected,
      source: election.source,
    });

    const resultText = elected ? "Eleito(a)" : (election.result || election.situation);
    facts.push({
      id: `tse-eleicao-${election.year}`,
      label: `Resultado na eleição de ${election.year}`,
      value: resultText,
      context: `Cargo: ${election.role} | Partido: ${election.party}`,
      source: election.source,
      dimension: "historico",
      category: "Histórico Eleitoral",
    });
  }

  // --- Party history ---

  const chronological = [...tseData.elections].sort(
    (a, b) => a.year - b.year,
  );

  for (const election of chronological) {
    const lastEntry = partyHistory[partyHistory.length - 1];

    // Same party as previous entry — skip
    if (lastEntry && lastEntry.party === election.party) {
      continue;
    }

    // Close previous entry if party changed
    if (lastEntry && !lastEntry.endYear && lastEntry.party !== election.party) {
      lastEntry.endYear = election.year;
    }

    partyHistory.push({
      party: election.party,
      startYear: election.year,
      endYear: undefined,
    });
  }

  // Fact: number of distinct parties
  const uniqueParties = new Set(partyHistory.map((p) => p.party));
  if (uniqueParties.size > 1) {
    facts.push({
      id: `tse-partidos-total`,
      label: "Partidos pelos quais concorreu",
      value: uniqueParties.size,
      context: [...uniqueParties].join(", "),
      source: tseData.source,
      dimension: "compromissos",
      category: "Filiação Partidária",
    });
  }

  // Fact: total elections contested
  facts.push({
    id: `tse-eleicoes-total`,
    label: "Eleições disputadas (registros TSE)",
    value: tseData.elections.length,
    context: tseData.elections.map((e) => `${e.year} (${e.role})`).join(", "),
    source: tseData.source,
    dimension: "historico",
    category: "Histórico Eleitoral",
  });

  return { assetDeclarations, officesHeld, partyHistory, facts };
}

/**
 * Full merge: takes an existing CandidateProfile and TSE data,
 * returns a new enriched profile with deduplication and biographical fill-in.
 *
 * Use this when you need a complete merged profile rather than
 * just the TSE-sourced fragments.
 */
export function mergeTseData(
  profile: CandidateProfile,
  tseData: TseCandidatoData,
): CandidateProfile {
  const normalized = normalizeTse(tseData);

  // Deduplicate asset declarations by year
  const existingAssetYears = new Set(
    profile.assetDeclarations.map((a) => a.electionYear),
  );
  const newAssets = normalized.assetDeclarations.filter(
    (a) => !existingAssetYears.has(a.electionYear),
  );

  // Deduplicate offices by role + year
  const existingOfficeKeys = new Set(
    profile.officesHeld.map(
      (o) => `${o.role.toLowerCase()}-${o.startYear}`,
    ),
  );
  const newOffices = normalized.officesHeld.filter(
    (o) => !existingOfficeKeys.has(`${o.role.toLowerCase()}-${o.startYear}`),
  );

  // Deduplicate party history by party + startYear
  const existingPartyKeys = new Set(
    profile.partyHistory.map((p) => `${p.party}-${p.startYear}`),
  );
  const newPartyEntries = normalized.partyHistory.filter(
    (p) => !existingPartyKeys.has(`${p.party}-${p.startYear}`),
  );

  return {
    ...profile,
    birthDate:
      profile.birthDate || tseData.latestDetails?.birthDate || undefined,
    education:
      profile.education || tseData.latestDetails?.education || undefined,
    occupation:
      profile.occupation || tseData.latestDetails?.occupation || undefined,
    photoUrl:
      profile.photoUrl || tseData.latestDetails?.photoUrl || undefined,

    assetDeclarations: [...profile.assetDeclarations, ...newAssets],
    officesHeld: [...profile.officesHeld, ...newOffices],
    partyHistory: [...profile.partyHistory, ...newPartyEntries],
    facts: [...profile.facts, ...normalized.facts],
    sources: [...new Set([...profile.sources, "TSE - DivulgaCandContas"])],
    lastUpdated: new Date().toISOString(),
  };
}

// --- Helpers ---

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
