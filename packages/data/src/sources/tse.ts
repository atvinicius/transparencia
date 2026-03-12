import { fetchJson } from "../utils/http.js";
import type { Source } from "../schemas/index.js";

const BASE_URL = "https://divulgacandcontas.tse.jus.br/divulga/rest/v1";

// Presidential election codes per year (DivulgaCandContas)
const ELECTION_CONFIGS: Record<number, { electionCode: number; officeCode: number }> = {
  2022: { electionCode: 2040602022, officeCode: 1 },
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

interface TseBem {
  ordem: number;
  descricao: string;
  descricaoDeBemCandidato: string;
  valor: number;
}

interface TseCandidatoDetalhes {
  id: number;
  nomeUrna: string;
  nomeCompleto: string;
  numero: number;
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
  gastoCampanha1T?: number;
  gastoCampanha2T?: number;
  gastoCampanha?: number;
  descricaoTotalizacao?: string;
  cnpjcampanha?: string;
  totalDeBens?: number;
  bens?: TseBem[];
}

interface TseListaResponse {
  candidatos: TseCandidatoResumo[];
}

// --- Public types ---

export interface TseElectionEntry {
  year: number;
  candidateId: number;
  candidateNumber: number;
  partyNumber: number;
  electionCode: number;
  sgUe: string;         // "BR" for federal, state code for governor
  officeCode: number;   // 1=president, 3=governor
  party: string;
  role: string;
  location: string;
  situation: string;
  result?: string;
  totalAssets?: number;
  campaignSpending1T?: number;
  campaignSpending2T?: number;
  assets: Array<{
    description: string;
    value: number;
  }>;
  source: Source;
}

export interface TseCandidatoData {
  name: string;
  shortName: string;
  elections: TseElectionEntry[];
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

// Office codes
const OFFICE_PRESIDENT = 1;
const OFFICE_GOVERNOR = 3;

// --- Internal helpers ---

async function listCandidatesInYear(
  year: number,
  sgUe: string = "BR",
  officeCode: number = OFFICE_PRESIDENT,
): Promise<TseCandidatoResumo[]> {
  const config = ELECTION_CONFIGS[year];
  if (!config) return [];

  try {
    const response = await fetchJson<TseListaResponse>(
      `${BASE_URL}/candidatura/listar/${year}/${sgUe}/${config.electionCode}/${officeCode}/candidatos`,
      { retries: 2 },
    );

    if (!response.candidatos || !Array.isArray(response.candidatos)) {
      return [];
    }

    return response.candidatos;
  } catch (error) {
    console.warn(`[TSE] Failed to list candidates for ${year}/${sgUe}/${officeCode}: ${error}`);
    return [];
  }
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

async function searchCandidatesInYear(
  name: string,
  year: number,
  sgUe: string = "BR",
  officeCode: number = OFFICE_PRESIDENT,
): Promise<TseCandidatoResumo[]> {
  const candidates = await listCandidatesInYear(year, sgUe, officeCode);
  const normalizedSearch = normalizeText(name);

  return candidates.filter((c) => {
    const normalizedFull = normalizeText(c.nomeCompleto || "");
    const normalizedUrna = normalizeText(c.nomeUrna || "");
    return normalizedFull.includes(normalizedSearch) || normalizedUrna.includes(normalizedSearch);
  });
}

async function fetchCandidateDetails(
  candidateId: number,
  year: number,
  sgUe: string = "BR",
): Promise<TseCandidatoDetalhes | null> {
  const config = ELECTION_CONFIGS[year];
  if (!config) return null;

  try {
    const response = await fetchJson<TseCandidatoDetalhes>(
      `${BASE_URL}/candidatura/buscar/${year}/${sgUe}/${config.electionCode}/candidato/${candidateId}`,
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
 * Fetch election history for a candidate across multiple years.
 * Searches presidential elections first, then governor elections by state.
 */
interface HistoryEntry {
  year: number;
  candidate: TseCandidatoResumo;
  sgUe: string;
}

export async function fetchCandidateHistory(
  name: string,
  state?: string,
): Promise<HistoryEntry[]> {
  const history: HistoryEntry[] = [];

  // Search presidential elections (officeCode=1, sgUe=BR)
  for (const year of ELECTION_YEARS) {
    const results = await searchCandidatesInYear(name, year, "BR", OFFICE_PRESIDENT);
    if (results.length > 0) {
      history.push({ year, candidate: results[0], sgUe: "BR" });
    }
  }

  // Also search governor elections if state is provided
  if (state) {
    for (const year of ELECTION_YEARS) {
      // Skip if we already have this year from presidential search
      if (history.some((h) => h.year === year)) continue;

      const results = await searchCandidatesInYear(name, year, state, OFFICE_GOVERNOR);
      if (results.length > 0) {
        history.push({ year, candidate: results[0], sgUe: state });
      }
    }
    // Sort by year descending (most recent first)
    history.sort((a, b) => b.year - a.year);
  }

  console.log(`[TSE] Found election history in ${history.length} year(s) for "${name}"`);
  return history;
}

/**
 * Main orchestrator: fetches all available TSE data for a candidate.
 * Returns null if no data is found.
 * @param name - Full name or ballot name to search
 * @param state - State code (e.g. "SP") to also search governor elections
 */
export async function fetchTseCandidateData(
  name: string,
  state?: string,
): Promise<TseCandidatoData | null> {
  console.log(`[TSE] Fetching data for "${name}"${state ? ` (state: ${state})` : ""}...`);

  // 1. Find the candidate across election years (presidential + governor)
  const history = await fetchCandidateHistory(name, state);
  if (history.length === 0) {
    console.log(`[TSE] No election data found for "${name}"`);
    return null;
  }

  // 2. Fetch details from the most recent election
  const mostRecent = history[0];
  const details = await fetchCandidateDetails(mostRecent.candidate.id, mostRecent.year, mostRecent.sgUe);

  // 3. Build election entries with assets from details
  const elections: TseElectionEntry[] = [];

  for (const { year, candidate, sgUe } of history) {
    const config = ELECTION_CONFIGS[year]!;
    // Fetch details for each year to get bens (assets)
    const yearDetails = year === mostRecent.year
      ? details
      : await fetchCandidateDetails(candidate.id, year, sgUe);

    const bens = yearDetails?.bens ?? [];
    const totalAssets = yearDetails?.totalDeBens ?? bens.reduce((sum, b) => sum + (b.valor || 0), 0);

    elections.push({
      year,
      candidateId: candidate.id,
      candidateNumber: yearDetails?.numero || candidate.numero || 0,
      partyNumber: yearDetails?.partido?.numero || candidate.partido?.numero || 0,
      electionCode: config.electionCode,
      sgUe,
      officeCode: sgUe === "BR" ? OFFICE_PRESIDENT : OFFICE_GOVERNOR,
      party: candidate.partido?.sigla || "Desconhecido",
      role: candidate.cargo?.nome || "Desconhecido",
      location: candidate.ufSuperiorCandidatura || "BR",
      situation: candidate.descricaoSituacao || "Desconhecida",
      result: candidate.descricaoTotalizacao || yearDetails?.descricaoTotalizacao,
      totalAssets: totalAssets || undefined,
      campaignSpending1T: yearDetails?.gastoCampanha1T || undefined,
      campaignSpending2T: yearDetails?.gastoCampanha2T || undefined,
      assets: bens.map((b) => ({
        description: b.descricaoDeBemCandidato || b.descricao || "Sem descrição",
        value: b.valor || 0,
      })),
      source: makeSource(`/candidatura/buscar/${year}/${sgUe}/${config.electionCode}/candidato/${candidate.id}`),
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
