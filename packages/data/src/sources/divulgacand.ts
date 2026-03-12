import { fetchJson } from "../utils/http.js";
import type { Source } from "../schemas/index.js";
import type { TseElectionEntry } from "./tse.js";

const BASE_URL = "https://divulgacandcontas.tse.jus.br/divulga/rest/v1";

function makeSource(path: string): Source {
  return {
    name: "DivulgaCandContas (TSE)",
    url: `${BASE_URL}${path}`,
    fetchedAt: new Date().toISOString(),
  };
}

// --- Raw API response types ---

interface PrestadorSummary {
  idPrestador?: number;
  idUltimaEntrega?: number;
  dadosConsolidados?: {
    totalRecebido?: number;
    totalDespesas?: number;
    totalReceitaDoacao?: number;
    totalReceitaPartido?: number;
    totalReceitaFundoPartidario?: number;
    totalReceitaFundoEleitoral?: number;
    totalReceitaOutros?: number;
  };
  despesas?: {
    totalGeral?: number;
    totalDespesasContratadas?: number;
    totalDespesasPagas?: number;
    totalPago?: number;
    totalEstimado?: number;
  };
  rankingDoadores?: Array<{
    nomeDoador?: string;
    cpfCnpjDoador?: string;
    valorReceita?: number;
    fonteOrigem?: string;
  }>;
  rankingFornecedores?: Array<{
    nomeFornecedor?: string;
    cpfCnpjFornecedor?: string;
    valorDespesa?: number;
    tipoDespesa?: string;
  }>;
}

interface PrestadorReceita {
  nomeDoador?: string;
  nomeDoadorRFB?: string;
  valorReceita?: number;
  fonteOrigem?: string;
  cpfCnpjDoador?: string;
  dsReceita?: string;
  dtReceita?: string;
}

interface PrestadorDespesa {
  descricaoDespesa?: string;
  valorDespesa?: number;
  tipoDespesa?: string;
  nomeFornecedor?: string;
  cpfCnpjFornecedor?: string;
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
 * Fetch the prestador summary (campaign finance overview).
 * URL pattern: /prestador/consulta/{electionCode}/{year}/{sgUe}/{officeCode}/{partyNumber}/{candidateNumber}/{candidateId}
 */
async function fetchPrestadorSummary(
  electionCode: number,
  year: number,
  sgUe: string,
  officeCode: number,
  partyNumber: number,
  candidateNumber: number,
  candidateId: number,
): Promise<PrestadorSummary | null> {
  const path = `/prestador/consulta/${electionCode}/${year}/${sgUe}/${officeCode}/${partyNumber}/${candidateNumber}/${candidateId}`;
  try {
    return await fetchJson<PrestadorSummary>(
      `${BASE_URL}${path}`,
      { retries: 2, retryDelay: 2000 },
    );
  } catch (error) {
    console.warn(`[DivulgaCand] Prestador unavailable: ${error}`);
    return null;
  }
}

/**
 * Fetch detailed receitas (donations) for a candidate.
 */
async function fetchPrestadorReceitas(
  electionCode: number,
  idPrestador: number,
  idUltimaEntrega: number,
): Promise<PrestadorReceita[]> {
  try {
    const response = await fetchJson<PrestadorReceita[] | { receitas?: PrestadorReceita[] }>(
      `${BASE_URL}/prestador/consulta/receitas/${electionCode}/${idPrestador}/${idUltimaEntrega}/lista`,
      { retries: 2, retryDelay: 2000 },
    );

    if (Array.isArray(response)) return response;
    if (response && Array.isArray(response.receitas)) return response.receitas;
    return [];
  } catch (error) {
    console.warn(`[DivulgaCand] Receitas unavailable: ${error}`);
    return [];
  }
}

/**
 * Fetch detailed despesas (expenses) for a candidate.
 */
async function fetchPrestadorDespesas(
  electionCode: number,
  idPrestador: number,
  idUltimaEntrega: number,
): Promise<PrestadorDespesa[]> {
  try {
    const response = await fetchJson<PrestadorDespesa[] | { despesas?: PrestadorDespesa[] }>(
      `${BASE_URL}/prestador/consulta/despesas/${electionCode}/${idPrestador}/${idUltimaEntrega}`,
      { retries: 2, retryDelay: 2000 },
    );

    if (Array.isArray(response)) return response;
    if (response && Array.isArray(response.despesas)) return response.despesas;
    return [];
  } catch (error) {
    console.warn(`[DivulgaCand] Despesas unavailable: ${error}`);
    return [];
  }
}

// --- Public API ---

/**
 * Fetch campaign finance data using candidate info from TSE listing.
 * This is the correct approach — the prestador endpoint requires
 * the candidate's party number, ballot number, and TSE ID.
 */
export async function fetchCampaignFinanceForCandidate(
  candidateName: string,
  election: TseElectionEntry,
): Promise<DivulgaCandFinanceData | null> {
  console.log(
    `[DivulgaCand] Fetching finance for "${candidateName}" (${election.year})...`,
  );

  // Step 1: Get the prestador summary
  const summary = await fetchPrestadorSummary(
    election.electionCode,
    election.year,
    election.sgUe,
    election.officeCode,
    election.partyNumber,
    election.candidateNumber,
    election.candidateId,
  );
  if (!summary) return null;

  const totalReceived = summary.dadosConsolidados?.totalRecebido ?? 0;
  const totalSpent = summary.despesas?.totalDespesasPagas
    ?? summary.despesas?.totalDespesasContratadas
    ?? summary.despesas?.totalGeral
    ?? 0;

  // Step 2: Build donations from ranking (quick) or detailed receitas
  let donations: DivulgaCandDonation[] = [];
  let expenses: DivulgaCandExpense[] = [];

  if (summary.idPrestador && summary.idUltimaEntrega) {
    // Try to get detailed receitas/despesas
    const [rawReceitas, rawDespesas] = await Promise.all([
      fetchPrestadorReceitas(election.electionCode, summary.idPrestador, summary.idUltimaEntrega),
      fetchPrestadorDespesas(election.electionCode, summary.idPrestador, summary.idUltimaEntrega),
    ]);

    donations = rawReceitas.map((r) => ({
      name: r.nomeDoadorRFB || r.nomeDoador || "Não identificado",
      amount: r.valorReceita ?? 0,
      type: r.fonteOrigem || r.dsReceita || "Outros",
      cpfCnpj: r.cpfCnpjDoador || undefined,
    }));

    expenses = rawDespesas.map((d) => ({
      description: d.descricaoDespesa || d.nomeFornecedor || "Despesa não descrita",
      amount: d.valorDespesa ?? 0,
      category: d.tipoDespesa || "Outros",
    }));
  }

  // Fallback: use ranking data from summary if detailed data is empty
  if (donations.length === 0 && summary.rankingDoadores) {
    donations = summary.rankingDoadores.map((d) => ({
      name: d.nomeDoador || "Não identificado",
      amount: d.valorReceita ?? 0,
      type: d.fonteOrigem || "Outros",
      cpfCnpj: d.cpfCnpjDoador || undefined,
    }));
  }

  if (expenses.length === 0 && summary.rankingFornecedores) {
    expenses = summary.rankingFornecedores.map((f) => ({
      description: f.nomeFornecedor || "Despesa não descrita",
      amount: f.valorDespesa ?? 0,
      category: f.tipoDespesa || "Outros",
    }));
  }

  const sourcePath = `/prestador/consulta/${election.electionCode}/${election.year}/${election.sgUe}/${election.officeCode}/${election.partyNumber}/${election.candidateNumber}/${election.candidateId}`;

  console.log(
    `[DivulgaCand] ${candidateName} (${election.year}): R$ ${totalReceived.toLocaleString("pt-BR")} received, R$ ${totalSpent.toLocaleString("pt-BR")} spent`,
  );

  return {
    candidateName,
    candidateId: String(election.candidateId),
    year: election.year,
    totalReceived,
    totalSpent,
    donations,
    expenses,
    source: makeSource(sourcePath),
  };
}

/**
 * Fetch campaign finance data for a candidate across multiple elections.
 * Requires TSE election entries (from fetchTseCandidateData).
 */
export async function fetchCampaignFinanceFromTseData(
  candidateName: string,
  elections: TseElectionEntry[],
): Promise<DivulgaCandFinanceData[]> {
  console.log(
    `[DivulgaCand] Searching finance for "${candidateName}" across ${elections.length} election(s)...`,
  );

  const results: DivulgaCandFinanceData[] = [];

  for (const election of elections) {
    if (!election.candidateNumber || !election.partyNumber) {
      console.warn(`[DivulgaCand] Missing candidate/party number for ${candidateName} (${election.year}), skipping`);
      continue;
    }

    const financeData = await fetchCampaignFinanceForCandidate(candidateName, election);
    if (financeData) {
      results.push(financeData);
    }
  }

  console.log(
    `[DivulgaCand] Found ${results.length} finance record(s) for "${candidateName}"`,
  );
  return results;
}

/**
 * @deprecated Use fetchCampaignFinanceFromTseData instead.
 * Kept for backwards compatibility but will not work without TSE data.
 */
export async function fetchCampaignFinanceByName(
  _name: string,
  _years?: number[],
): Promise<DivulgaCandFinanceData[]> {
  console.warn("[DivulgaCand] fetchCampaignFinanceByName is deprecated. Use fetchCampaignFinanceFromTseData with TSE election data.");
  return [];
}
