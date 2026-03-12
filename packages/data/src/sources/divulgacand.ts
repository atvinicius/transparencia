import { fetchJson } from "../utils/http.js";
import type { Source } from "../schemas/index.js";

const BASE_URL = "https://divulgacandcontas.tse.jus.br/divulga/rest/v1";

/** Election years typically available in the DivulgaCandContas system. */
const DEFAULT_ELECTION_YEARS = [2024, 2022, 2020, 2018, 2016, 2014];

function makeSource(path: string): Source {
  return {
    name: "DivulgaCandContas (TSE)",
    url: `${BASE_URL}${path}`,
    fetchedAt: new Date().toISOString(),
  };
}

// --- Raw API response types ---

interface PrestadorConsulta {
  nomeCandidato?: string;
  numeroCandidato?: string;
  totalReceitasDoacao?: number;
  totalReceitas?: number;
  totalDespesas?: number;
  totalReceitaPartido?: number;
  totalReceitaFundoPartidario?: number;
  totalReceitaFundoEleitoral?: number;
}

interface PrestadorReceita {
  nomeDoador?: string;
  nomeDoadorRFB?: string;
  valorReceita?: number;
  fonteReceita?: string;
  cpfCnpjDoador?: string;
  descricaoReceita?: string;
}

interface PrestadorDespesa {
  descricaoDespesa?: string;
  valorDespesa?: number;
  categoriaDespesa?: string;
  nomeFornecedor?: string;
  cpfCnpjFornecedor?: string;
}

interface CandidaturaResponse {
  nomeCandidato?: string;
  nomeUrna?: string;
  numero?: string;
  id?: number;
  partido?: { sigla?: string; nome?: string };
  cargo?: { nome?: string };
  localCandidatura?: string;
  despesaMaximaGastos?: number;
  gastosEleitorais?: {
    totalRecebido?: number;
    totalGasto?: number;
  };
}

// --- Public interface ---

export interface DivulgaCandDonation {
  name: string;
  amount: number;
  type: string;
  cpfCnpj?: string;
}

export interface DivulgaCandExpense {
  description: string;
  amount: number;
  category: string;
}

export interface DivulgaCandFinanceData {
  candidateName: string;
  candidateId: string;
  year: number;
  totalReceived: number;
  totalSpent: number;
  donations: DivulgaCandDonation[];
  expenses: DivulgaCandExpense[];
  source: Source;
}

// --- Internal helpers ---

/**
 * Fetch the campaign finance summary from the prestador/consulta endpoint.
 * Returns null if data is not available (404, timeout, etc.).
 */
async function fetchPrestadorConsulta(
  candidateId: string,
  year: number,
): Promise<PrestadorConsulta | null> {
  try {
    return await fetchJson<PrestadorConsulta>(
      `${BASE_URL}/prestador/consulta/${candidateId}/${year}`,
      { retries: 2, retryDelay: 2000 },
    );
  } catch (error) {
    console.warn(
      `[DivulgaCand] Consulta unavailable for candidate ${candidateId}/${year}: ${error}`,
    );
    return null;
  }
}

/**
 * Fetch the list of donations (receitas) for a candidate/year.
 */
async function fetchPrestadorReceitas(
  candidateId: string,
  year: number,
): Promise<PrestadorReceita[]> {
  try {
    const response = await fetchJson<PrestadorReceita[] | { receitas?: PrestadorReceita[] }>(
      `${BASE_URL}/prestador/receitas/${candidateId}/${year}`,
      { retries: 2, retryDelay: 2000 },
    );

    if (Array.isArray(response)) return response;
    if (response && Array.isArray(response.receitas)) return response.receitas;
    return [];
  } catch (error) {
    console.warn(
      `[DivulgaCand] Receitas unavailable for candidate ${candidateId}/${year}: ${error}`,
    );
    return [];
  }
}

/**
 * Fetch the list of expenses (despesas) for a candidate/year.
 */
async function fetchPrestadorDespesas(
  candidateId: string,
  year: number,
): Promise<PrestadorDespesa[]> {
  try {
    const response = await fetchJson<PrestadorDespesa[] | { despesas?: PrestadorDespesa[] }>(
      `${BASE_URL}/prestador/despesas/${candidateId}/${year}`,
      { retries: 2, retryDelay: 2000 },
    );

    if (Array.isArray(response)) return response;
    if (response && Array.isArray(response.despesas)) return response.despesas;
    return [];
  } catch (error) {
    console.warn(
      `[DivulgaCand] Despesas unavailable for candidate ${candidateId}/${year}: ${error}`,
    );
    return [];
  }
}

// --- Public API ---

/**
 * Fetch campaign finance data for a specific candidate ID and election year.
 *
 * The DivulgaCandContas API requires exact candidate IDs which change every
 * election cycle. When the ID is not known or the API returns errors, this
 * function returns null instead of throwing.
 */
export async function fetchCampaignFinance(
  candidateId: string,
  year: number,
): Promise<DivulgaCandFinanceData | null> {
  console.log(
    `[DivulgaCand] Fetching campaign finance for candidate ${candidateId}, year ${year}...`,
  );

  const consulta = await fetchPrestadorConsulta(candidateId, year);
  if (!consulta) return null;

  const [rawReceitas, rawDespesas] = await Promise.all([
    fetchPrestadorReceitas(candidateId, year),
    fetchPrestadorDespesas(candidateId, year),
  ]);

  const donations: DivulgaCandDonation[] = rawReceitas.map((r) => ({
    name: r.nomeDoadorRFB || r.nomeDoador || "Não identificado",
    amount: r.valorReceita ?? 0,
    type: r.fonteReceita || r.descricaoReceita || "Outros",
    cpfCnpj: r.cpfCnpjDoador || undefined,
  }));

  const expenses: DivulgaCandExpense[] = rawDespesas.map((d) => ({
    description: d.descricaoDespesa || d.nomeFornecedor || "Despesa não descrita",
    amount: d.valorDespesa ?? 0,
    category: d.categoriaDespesa || "Outros",
  }));

  const totalReceived =
    consulta.totalReceitas ??
    consulta.totalReceitasDoacao ??
    donations.reduce((sum, d) => sum + d.amount, 0);

  const totalSpent =
    consulta.totalDespesas ??
    expenses.reduce((sum, e) => sum + e.amount, 0);

  const candidateName = consulta.nomeCandidato || `Candidato ${candidateId}`;

  console.log(
    `[DivulgaCand] ${candidateName} (${year}): R$ ${totalReceived.toLocaleString("pt-BR")} received, R$ ${totalSpent.toLocaleString("pt-BR")} spent, ${donations.length} donations, ${expenses.length} expenses`,
  );

  return {
    candidateName,
    candidateId,
    year,
    totalReceived,
    totalSpent,
    donations,
    expenses,
    source: makeSource(`/prestador/consulta/${candidateId}/${year}`),
  };
}

/**
 * Search for campaign finance data by candidate name across election years.
 *
 * NOTE: The DivulgaCandContas API does not provide a direct name-search
 * endpoint for prestação de contas. This function attempts to use the
 * candidatura search endpoint to find candidate IDs, then fetches finance
 * data for each match. Results may be incomplete if the API does not
 * return matches.
 *
 * @param name - Candidate name (partial match)
 * @param years - Election years to search (defaults to recent elections)
 */
export async function fetchCampaignFinanceByName(
  name: string,
  years: number[] = DEFAULT_ELECTION_YEARS,
): Promise<DivulgaCandFinanceData[]> {
  console.log(
    `[DivulgaCand] Searching campaign finance for "${name}" across years: ${years.join(", ")}...`,
  );

  const results: DivulgaCandFinanceData[] = [];

  for (const year of years) {
    try {
      // Try the candidatura search endpoint to find candidate IDs
      const searchResponse = await fetchJson<{
        candidatos?: CandidaturaResponse[];
      }>(
        `${BASE_URL}/candidatura/buscar/${year}/BR/0/candidatos`,
        {
          params: { nomeUrnaCandidato: name },
          retries: 1,
          retryDelay: 2000,
        },
      );

      const candidates = searchResponse?.candidatos ?? [];

      if (candidates.length === 0) {
        console.log(`[DivulgaCand] No candidates found for "${name}" in ${year}`);
        continue;
      }

      // Fetch finance data for each matched candidate (limit to 5 per year)
      for (const candidate of candidates.slice(0, 5)) {
        const candidateId = candidate.id?.toString();
        if (!candidateId) continue;

        const financeData = await fetchCampaignFinance(candidateId, year);
        if (financeData) {
          // Use the name from the candidatura response if available
          financeData.candidateName =
            candidate.nomeCandidato || candidate.nomeUrna || financeData.candidateName;
          results.push(financeData);
        }
      }
    } catch (error) {
      console.warn(
        `[DivulgaCand] Search failed for "${name}" in ${year}: ${error}`,
      );
      // Continue to the next year
    }
  }

  console.log(
    `[DivulgaCand] Found ${results.length} finance record(s) for "${name}"`,
  );
  return results;
}
