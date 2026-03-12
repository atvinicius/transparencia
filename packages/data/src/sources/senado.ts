import { fetchJson } from "../utils/http.js";
import type { Source } from "../schemas/index.js";

const BASE_URL = "https://legis.senado.leg.br/dadosabertos";

const HEADERS = { Accept: "application/json" };

function makeSource(path: string): Source {
  return {
    name: "Senado Federal",
    url: `${BASE_URL}${path}`,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Normalize a value that may be a single object or an array into an array.
 * The Senado API returns a single object instead of a one-element array in
 * many endpoints.
 */
function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

// --- Raw API types ---

interface SenadoParlamentar {
  IdentificacaoParlamentar: {
    CodigoParlamentar: string;
    NomeParlamentar: string;
    NomeCompletoParlamentar: string;
    SexoParlamentar: string;
    FormaTratamento: string;
    UrlFotoParlamentar: string;
    UrlPaginaParlamentar: string;
    EmailParlamentar: string;
    SiglaPartidoParlamentar: string;
    UfParlamentar: string;
  };
  Mandato?: {
    CodigoMandato: string;
    UfParlamentar: string;
    DescricaoParticipacao: string;
  };
}

interface SenadoDetalhe {
  CodigoParlamentar: string;
  NomeParlamentar: string;
  NomeCompletoParlamentar: string;
  SexoParlamentar: string;
  DataNascimento: string;
  UfNaturalidade: string;
  EnderecoParlamentar: string;
  EmailParlamentar: string;
  UrlFotoParlamentar: string;
  UrlPaginaParlamentar: string;
  SiglaPartidoParlamentar: string;
  UfParlamentar: string;
  FiliacaoPartidaria?: {
    Filiacoes?: {
      Filiacao: Array<{
        SiglaPartido: string;
        DataFiliacao: string;
        DataDesfiliacao?: string;
      }> | {
        SiglaPartido: string;
        DataFiliacao: string;
        DataDesfiliacao?: string;
      };
    };
  };
  DadosBasicosParlamentar?: {
    DataNascimento?: string;
    Naturalidade?: string;
    UfNaturalidade?: string;
    Escolaridade?: string;
  };
}

interface SenadoVotacao {
  CodigoSessao?: string;
  SiglaCasa?: string;
  DescricaoVotacao?: string;
  DescricaoResultado?: string;
  SessaoPlenaria?: {
    DataSessao: string;
    CodigoSessao: string;
  };
  Materia?: {
    CodigoMateria: string;
    SiglaTipoMateria: string;
    NumeroMateria: string;
    AnoMateria: string;
    DescricaoMateria: string;
  };
  VotoParlamentar?: string; // "Sim", "Não", "Abstenção", etc.
}

interface SenadoMateria {
  CodigoMateria: string;
  SiglaTipoMateria: string;
  NumeroMateria: string;
  AnoMateria: string;
  DescricaoMateria?: string;
  EmentaMateria?: string;
  Ementa?: string;
  IndicadorTramitando?: string;
  DescricaoSituacao?: string;
}

// --- Public API ---

export interface SenadoSenadorData {
  codigo: string;
  name: string;
  fullName: string;
  party: string;
  state: string;
  photoUrl: string;
  birthDate?: string;
  education?: string;
  details?: SenadoDetalhe;
  votingSummary: {
    total: number;
    present: number;
    absent: number;
    abstained: number;
  };
  proposals: Array<{
    id: string;
    type: string;
    number: string;
    year: string;
    summary: string;
    status: string;
  }>;
  source: Source;
}

export async function fetchSenadores(
  limit?: number,
): Promise<SenadoParlamentar[]> {
  console.log("[Senado] Fetching current senators...");

  try {
    const response = await fetchJson<{
      ListaParlamentarEmExercicio: {
        Parlamentares: {
          Parlamentar: SenadoParlamentar[] | SenadoParlamentar;
        };
      };
    }>(`${BASE_URL}/senador/lista/atual`, { headers: HEADERS });

    const parlamentares = ensureArray(
      response.ListaParlamentarEmExercicio?.Parlamentares?.Parlamentar,
    );

    const result = limit ? parlamentares.slice(0, limit) : parlamentares;
    console.log(`[Senado] Found ${result.length} senators`);
    return result;
  } catch (error) {
    console.error(`[Senado] Failed to fetch senators list: ${error}`);
    return [];
  }
}

export async function fetchSenadorDetails(
  codigo: string,
): Promise<SenadoDetalhe | undefined> {
  console.log(`[Senado] Fetching details for senator ${codigo}...`);

  try {
    const response = await fetchJson<{
      DetalheParlamentar: {
        Parlamentar: SenadoDetalhe;
      };
    }>(`${BASE_URL}/senador/${codigo}`, { headers: HEADERS });

    return response.DetalheParlamentar?.Parlamentar;
  } catch (error) {
    console.warn(`[Senado] Failed to fetch details for senator ${codigo}: ${error}`);
    return undefined;
  }
}

export async function fetchSenadorVotingSummary(
  codigo: string,
): Promise<{ total: number; present: number; absent: number; abstained: number }> {
  console.log(`[Senado] Fetching voting records for senator ${codigo}...`);

  try {
    const response = await fetchJson<{
      VotacaoParlamentar: {
        Parlamentar: {
          Votacoes: {
            Votacao: SenadoVotacao[] | SenadoVotacao;
          };
        };
      };
    }>(`${BASE_URL}/senador/${codigo}/votacoes`, { headers: HEADERS });

    const votacoes = ensureArray(
      response.VotacaoParlamentar?.Parlamentar?.Votacoes?.Votacao,
    );

    let present = 0;
    let absent = 0;
    let abstained = 0;

    for (const votacao of votacoes) {
      const voto = votacao.VotoParlamentar;
      if (!voto || voto === "NCompareceu" || voto === "Ausente") {
        absent++;
      } else if (voto === "Abstenção" || voto === "Abstencao") {
        abstained++;
      } else {
        // "Sim", "Não", "P-NRV", "Liberado", etc. count as present
        present++;
      }
    }

    const total = votacoes.length;
    console.log(
      `[Senado] Senator ${codigo}: ${total} votes (${present} present, ${absent} absent, ${abstained} abstained)`,
    );
    return { total, present, absent, abstained };
  } catch (error) {
    console.warn(`[Senado] Voting records unavailable for senator ${codigo}: ${error}`);
    return { total: 0, present: 0, absent: 0, abstained: 0 };
  }
}

export async function fetchSenadorProposals(
  codigo: string,
): Promise<SenadoMateria[]> {
  console.log(`[Senado] Fetching authored proposals for senator ${codigo}...`);

  try {
    const response = await fetchJson<{
      MateriasAutoria: {
        Parlamentar: {
          Materias: {
            Materia: SenadoMateria[] | SenadoMateria;
          };
        };
      };
    }>(`${BASE_URL}/senador/${codigo}/autorias`, { headers: HEADERS });

    const materias = ensureArray(
      response.MateriasAutoria?.Parlamentar?.Materias?.Materia,
    );

    console.log(`[Senado] Found ${materias.length} proposals for senator ${codigo}`);
    return materias;
  } catch (error) {
    console.warn(`[Senado] Proposals unavailable for senator ${codigo}: ${error}`);
    return [];
  }
}

export async function fetchFullSenadorData(
  senador: SenadoParlamentar,
): Promise<SenadoSenadorData> {
  const id = senador.IdentificacaoParlamentar;
  const codigo = id.CodigoParlamentar;
  console.log(`[Senado] Fetching full data for ${id.NomeParlamentar} (${codigo})...`);

  const [details, votingSummary, rawProposals] = await Promise.all([
    fetchSenadorDetails(codigo),
    fetchSenadorVotingSummary(codigo).catch((err) => {
      console.warn(`[Senado] Voting summary unavailable for ${id.NomeParlamentar}: ${err}`);
      return { total: 0, present: 0, absent: 0, abstained: 0 };
    }),
    fetchSenadorProposals(codigo).catch((err) => {
      console.warn(`[Senado] Proposals unavailable for ${id.NomeParlamentar}: ${err}`);
      return [] as SenadoMateria[];
    }),
  ]);

  const birthDate =
    details?.DadosBasicosParlamentar?.DataNascimento ||
    details?.DataNascimento ||
    undefined;

  const education = details?.DadosBasicosParlamentar?.Escolaridade || undefined;

  // Limit proposals to most recent 20 for manageability
  const proposals = rawProposals.slice(0, 20).map((m) => ({
    id: m.CodigoMateria,
    type: m.SiglaTipoMateria || "Outros",
    number: m.NumeroMateria,
    year: m.AnoMateria,
    summary: m.EmentaMateria || m.DescricaoMateria || m.Ementa || "",
    status: m.DescricaoSituacao || (m.IndicadorTramitando === "Sim" ? "Tramitando" : "Desconhecido"),
  }));

  return {
    codigo,
    name: id.NomeCompletoParlamentar || id.NomeParlamentar,
    fullName: id.NomeCompletoParlamentar || id.NomeParlamentar,
    party: id.SiglaPartidoParlamentar,
    state: id.UfParlamentar,
    photoUrl: id.UrlFotoParlamentar,
    birthDate,
    education,
    details,
    votingSummary,
    proposals,
    source: makeSource(`/senador/${codigo}`),
  };
}
