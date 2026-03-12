import { fetchJson } from "../utils/http.js";
import type { Source } from "../schemas/index.js";

const BASE_URL = "https://divulgacandcontas.tse.jus.br/divulga/rest/v1";

// Presidential election codes per year (DivulgaCandContas)
const ELECTION_CONFIGS: Record<number, { electionCode: number; officeCode: number }> = {
  2022: { electionCode: 546, officeCode: 1 },
  2018: { electionCode: 2022802018, officeCode: 1 },
  2014: { electionCode: 680, officeCode: 1 },
};

const ELECTION_YEARS = [2022, 2018, 2014] as const;

function makeSource(path: string): Source {
  return {
    name: "TSE - DivulgaCandContas",
    url: `${BASE_URL}${path}`,
    fetchedAt: new Date().toISOString(),
  };
}

// --- Raw API types ---

interface TseCandidatoResumo {
  id: number;
  nomeUrna: string;
  nomeCompleto: string;
  numero: number;
  partido: {
    sigla: string;
    nome: string;
    numero: number;
  };
  cargo: {
    codigo: number;
    nome: string;
  };
  descricaoSituacao: string;
  descricaoTotalizacao?: string;
  ufSuperiorCandidatura?: string;
}

interface TseCandidatoDetalhes {
  id: number;
  nomeUrna: string;
  nomeCompleto: string;
  descricaoSexo: string;
  dataDeNascimento: string;
  descricaoGrauInstrucao: string;
  descricaoEstadoCivil: string;
  ocupacao: string;
  partido: {
    sigla: string;
    nome: string;
    numero: number;
  };
  cargo: {
    codigo: number;
    nome: string;
  };
  descricaoSituacao: string;
  descricaoNaturalidade?: string;
  sgUfNascimento?: string;
  localCandidatura?: string;
  ufCandidatura?: string;
  fotoUrl?: string;
  sites?: string[];
  emails?: string[];
  elpipicopiValorDespesa?: number;
  gastoCampanha?: number;
  descricaoTotalizacao?: string;
  cnpjcampanha?: string;
  totalDeBens?: number;
}

interface TseBem {
  ordem: number;
  descricao: string;
  descricaoDeBemCandidato: string;
  valor: number;
}

interface TseListaResponse {
  candidatos: TseCandidatoResumo[];
}

interface TseBensResponse {
  bens: TseBem[];
}

// --- Public types ---

export interface TseCandidatoData {
  name: string;
  shortName: string;
  elections: Array<{
    year: number;
    party: string;
    role: string;
    location: string;
    situation: string;
    result?: string;
    totalAssets?: number;
    assets: Array<{
      description: string;
      value: number;
    }>;
    source: Source;
  }>;
  latestDetails?: {
    birthDate?: string;
    education?: string;
    occupation?: string;
    gender?: string;
    maritalStatus?: string;
    birthPlace?: string;
    photoUrl?: string;
  };
  source: Source;
}

// --- Internal helpers ---

async function searchCandidatesInYear(
  name: string,
  year: number,
): Promise<TseCandidatoResumo[]> {
  const config = ELECTION_CONFIGS[year];
  if (!config) return [];

  try {
    const response = await fetchJson<TseListaResponse>(
      `${BASE_URL}/candidatura/listar/${year}/BR/${config.electionCode}/${config.officeCode}`,
      { retries: 2 },
    );

    if (!response.candidatos || !Array.isArray(response.candidatos)) {
      return [];
    }

    const normalizedSearch = name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    return response.candidatos.filter((c) => {
      const normalizedName = (c.nomeCompleto || c.nomeUrna || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      return normalizedName.includes(normalizedSearch);
    });
  } catch (error) {
    console.warn(`[TSE] Failed to search candidates for ${year}: ${error}`);
    return [];
  }
}

async function fetchCandidateDetails(
  candidateId: number,
  year: number,
): Promise<TseCandidatoDetalhes | null> {
  const config = ELECTION_CONFIGS[year];
  if (!config) return null;

  try {
    const response = await fetchJson<TseCandidatoDetalhes>(
      `${BASE_URL}/candidatura/buscar/${year}/BR/${config.electionCode}/${candidateId}`,
      { retries: 2 },
    );
    return response;
  } catch (error) {
    console.warn(`[TSE] Failed to fetch candidate details for ${candidateId} (${year}): ${error}`);
    return null;
  }
}

// --- Public API ---

/**
 * Search for a candidate by name across election years.
 * Returns matches from the most recent year first.
 */
export async function searchCandidateByName(
  name: string,
  year?: number,
): Promise<TseCandidatoResumo[]> {
  const years = year ? [year] : [...ELECTION_YEARS];

  for (const y of years) {
    const results = await searchCandidatesInYear(name, y);
    if (results.length > 0) {
      console.log(`[TSE] Found ${results.length} candidate(s) matching "${name}" in ${y}`);
      return results;
    }
  }

  console.log(`[TSE] No candidates found matching "${name}"`);
  return [];
}

/**
 * Fetch asset declarations (bens declarados) for a candidate in a given year.
 */
export async function fetchCandidateAssets(
  candidateId: number,
  year: number,
): Promise<TseBem[]> {
  const config = ELECTION_CONFIGS[year];
  if (!config) return [];

  try {
    const response = await fetchJson<TseBensResponse>(
      `${BASE_URL}/candidatura/${candidateId}/bens`,
      { retries: 2 },
    );

    if (!response.bens || !Array.isArray(response.bens)) {
      return [];
    }

    return response.bens;
  } catch (error) {
    console.warn(`[TSE] Failed to fetch assets for candidate ${candidateId} (${year}): ${error}`);
    return [];
  }
}

/**
 * Fetch election history for a candidate across multiple years.
 * Searches by name in each election year and aggregates results.
 */
export async function fetchCandidateHistory(
  name: string,
): Promise<Array<{ year: number; candidate: TseCandidatoResumo }>> {
  const history: Array<{ year: number; candidate: TseCandidatoResumo }> = [];

  for (const year of ELECTION_YEARS) {
    const results = await searchCandidatesInYear(name, year);
    if (results.length > 0) {
      // Take the best match (first result)
      history.push({ year, candidate: results[0] });
    }
  }

  console.log(`[TSE] Found election history in ${history.length} year(s) for "${name}"`);
  return history;
}

/**
 * Main orchestrator: fetches all available TSE data for a candidate.
 * Returns null if no data is found.
 */
export async function fetchTseCandidateData(
  name: string,
): Promise<TseCandidatoData | null> {
  console.log(`[TSE] Fetching data for "${name}"...`);

  // 1. Find the candidate across election years
  const history = await fetchCandidateHistory(name);
  if (history.length === 0) {
    console.log(`[TSE] No election data found for "${name}"`);
    return null;
  }

  // 2. Fetch details from the most recent election
  const mostRecent = history[0];
  const details = await fetchCandidateDetails(mostRecent.candidate.id, mostRecent.year);

  // 3. Fetch assets for each election year
  const elections: TseCandidatoData["elections"] = [];

  for (const { year, candidate } of history) {
    const assets = await fetchCandidateAssets(candidate.id, year);

    elections.push({
      year,
      party: candidate.partido?.sigla || "Desconhecido",
      role: candidate.cargo?.nome || "Desconhecido",
      location: candidate.ufSuperiorCandidatura || "BR",
      situation: candidate.descricaoSituacao || "Desconhecida",
      result: candidate.descricaoTotalizacao,
      totalAssets: assets.reduce((sum, b) => sum + (b.valor || 0), 0),
      assets: assets.map((b) => ({
        description: b.descricaoDeBemCandidato || b.descricao || "Sem descricao",
        value: b.valor || 0,
      })),
      source: makeSource(`/candidatura/buscar/${year}/BR`),
    });
  }

  // 4. Build the result
  const candidateName = details?.nomeCompleto
    || mostRecent.candidate.nomeCompleto
    || name;

  const candidateShortName = details?.nomeUrna
    || mostRecent.candidate.nomeUrna
    || name;

  const result: TseCandidatoData = {
    name: candidateName,
    shortName: candidateShortName,
    elections,
    source: makeSource(`/candidatura`),
  };

  if (details) {
    result.latestDetails = {
      birthDate: details.dataDeNascimento || undefined,
      education: details.descricaoGrauInstrucao || undefined,
      occupation: details.ocupacao || undefined,
      gender: details.descricaoSexo || undefined,
      maritalStatus: details.descricaoEstadoCivil || undefined,
      birthPlace: details.descricaoNaturalidade
        ? `${details.descricaoNaturalidade}/${details.sgUfNascimento || ""}`
        : undefined,
      photoUrl: details.fotoUrl || undefined,
    };
  }

  console.log(
    `[TSE] Completed data fetch for "${candidateName}": ${elections.length} election(s)`,
  );
  return result;
}
