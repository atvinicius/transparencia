import { fetchJson, fetchAllPages } from "../utils/http.js";
import type { Source } from "../schemas/index.js";

const BASE_URL = "https://dadosabertos.camara.leg.br/api/v2";

function makeSource(path: string): Source {
  return {
    name: "Câmara dos Deputados",
    url: `${BASE_URL}${path}`,
    fetchedAt: new Date().toISOString(),
  };
}

// --- Raw API types ---

interface CamaraDeputado {
  id: number;
  uri: string;
  nome: string;
  siglaPartido: string;
  siglaUf: string;
  idLegislatura: number;
  urlFoto: string;
  email: string;
}

interface CamaraDeputadoDetalhes {
  id: number;
  nomeCivil: string;
  cpf: string;
  sexo: string;
  dataNascimento: string;
  dataFalecimento: string | null;
  ufNascimento: string;
  municipioNascimento: string;
  escolaridade: string;
  urlWebsite: string;
  redeSocial: string[];
  ultimoStatus: {
    nome: string;
    siglaPartido: string;
    siglaUf: string;
    situacao: string;
    condicaoEleitoral: string;
    nomeEleitoral: string;
  };
}

interface CamaraVotacao {
  id: string;
  uri: string;
  data: string;
  dataHoraRegistro: string;
  siglaOrgao: string;
  descricao: string;
  aprovacao: number;
}

interface CamaraVoto {
  deputado_: { id: number; nome: string; siglaPartido: string; siglaUf: string };
  tipoVoto: string; // "Sim", "Não", "Abstenção", "Obstrução", etc.
}

interface CamaraProposicao {
  id: number;
  uri: string;
  siglaTipo: string;
  numero: number;
  ano: number;
  ementa: string;
}

interface CamaraProposicaoDetalhes {
  id: number;
  siglaTipo: string;
  numero: number;
  ano: number;
  ementa: string;
  statusProposicao: {
    descricaoSituacao: string;
    descricaoTramitacao: string;
  };
  urlInteiroTeor: string;
  keywords: string[];
}

// --- Public API ---

export interface CamaraDeputyData {
  id: number;
  name: string;
  shortName: string;
  party: string;
  state: string;
  photoUrl: string;
  birthDate?: string;
  education?: string;
  legislature: number;
  details?: CamaraDeputadoDetalhes;
  votingSummary: {
    total: number;
    present: number;
    absent: number;
    abstained: number;
  };
  proposals: Array<{
    id: number;
    type: string;
    number: number;
    year: number;
    summary: string;
    status: string;
    keywords: string[];
    url?: string;
  }>;
  source: Source;
}

export async function fetchDeputies(
  legislature?: number,
  limit?: number,
): Promise<CamaraDeputado[]> {
  const currentLegislature = legislature ?? 57; // 57th legislature: 2023-2027
  console.log(`[Câmara] Fetching deputies for legislature ${currentLegislature}...`);

  // Use a smaller page size to avoid API timeouts
  const pageSize = limit && limit <= 15 ? limit : 15;
  const maxPages = limit ? Math.ceil(limit / pageSize) : 40;

  const allDeputies: CamaraDeputado[] = [];

  for (let page = 1; page <= maxPages; page++) {
    try {
      const response = await fetchJson<{ dados: CamaraDeputado[] }>(
        `${BASE_URL}/deputados`,
        {
          params: {
            idLegislatura: currentLegislature,
            ordem: "ASC",
            ordenarPor: "nome",
            pagina: page,
            itens: pageSize,
          },
        },
      );

      allDeputies.push(...response.dados);

      if (limit && allDeputies.length >= limit) {
        break;
      }

      if (response.dados.length < pageSize) {
        break; // Last page
      }
    } catch (error) {
      console.warn(`[Câmara] Page ${page} failed: ${error}. Stopping pagination.`);
      break;
    }
  }

  const result = limit ? allDeputies.slice(0, limit) : allDeputies;
  console.log(`[Câmara] Found ${result.length} deputies`);
  return result;
}

export async function fetchDeputyDetails(
  deputyId: number,
): Promise<CamaraDeputadoDetalhes> {
  const response = await fetchJson<{ dados: CamaraDeputadoDetalhes }>(
    `${BASE_URL}/deputados/${deputyId}`,
  );
  return response.dados;
}

export async function fetchDeputyVotingSummary(
  deputyId: number,
): Promise<{ total: number; present: number; absent: number; abstained: number }> {
  // Fetch recent votações (small page to avoid timeouts)
  const response = await fetchJson<{ dados: CamaraVotacao[] }>(
    `${BASE_URL}/votacoes`,
    {
      params: {
        idLegislatura: 57,
        ordem: "DESC",
        ordenarPor: "dataHoraRegistro",
        itens: 15,
        pagina: 1,
      },
    },
  );
  const votacoes = response.dados;

  let present = 0;
  let absent = 0;
  let abstained = 0;

  // Sample recent votações for performance
  const sample = votacoes.slice(0, 10);

  for (const votacao of sample) {
    try {
      const votos = await fetchJson<{ dados: CamaraVoto[] }>(
        `${BASE_URL}/votacoes/${votacao.id}/votos`,
      );

      const deputyVote = votos.dados.find((v) => v.deputado_.id === deputyId);

      if (!deputyVote) {
        absent++;
      } else if (deputyVote.tipoVoto === "Abstenção") {
        abstained++;
      } else {
        present++;
      }
    } catch {
      // Some votações may not have individual vote data
      continue;
    }
  }

  return { total: sample.length, present, absent, abstained };
}

export async function fetchDeputyProposals(
  deputyId: number,
): Promise<CamaraProposicaoDetalhes[]> {
  console.log(`[Câmara] Fetching proposals for deputy ${deputyId}...`);

  const response = await fetchJson<{ dados: CamaraProposicao[] }>(
    `${BASE_URL}/proposicoes`,
    {
      params: {
        idDeputadoAutor: deputyId,
        ordem: "DESC",
        ordenarPor: "ano",
        itens: 20,
        pagina: 1,
      },
    },
  );
  const proposicoes = response.dados;

  console.log(`[Câmara] Found ${proposicoes.length} proposals for deputy ${deputyId}`);

  // Fetch details for each (limited to avoid hammering the API)
  const detailed: CamaraProposicaoDetalhes[] = [];
  for (const prop of proposicoes.slice(0, 10)) {
    try {
      const detail = await fetchJson<{ dados: CamaraProposicaoDetalhes }>(
        `${BASE_URL}/proposicoes/${prop.id}`,
      );
      detailed.push(detail.dados);
    } catch {
      continue;
    }
  }

  return detailed;
}

export async function fetchFullDeputyData(
  deputy: CamaraDeputado,
): Promise<CamaraDeputyData> {
  console.log(`[Câmara] Fetching full data for ${deputy.nome} (${deputy.id})...`);

  const [details, votingSummary, proposals] = await Promise.all([
    fetchDeputyDetails(deputy.id),
    fetchDeputyVotingSummary(deputy.id).catch((err) => {
      console.warn(`[Câmara] Voting summary unavailable for ${deputy.nome}: ${err}`);
      return { total: 0, present: 0, absent: 0, abstained: 0 };
    }),
    fetchDeputyProposals(deputy.id),
  ]);

  return {
    id: deputy.id,
    name: details.nomeCivil || deputy.nome,
    shortName: details.ultimoStatus?.nomeEleitoral || deputy.nome,
    party: deputy.siglaPartido,
    state: deputy.siglaUf,
    photoUrl: deputy.urlFoto,
    birthDate: details.dataNascimento || undefined,
    education: details.escolaridade || undefined,
    legislature: deputy.idLegislatura,
    details,
    votingSummary,
    proposals: proposals.map((p) => ({
      id: p.id,
      type: p.siglaTipo,
      number: p.numero,
      year: p.ano,
      summary: p.ementa,
      status: p.statusProposicao?.descricaoSituacao || "Desconhecido",
      keywords: p.keywords || [],
      url: p.urlInteiroTeor || undefined,
    })),
    source: makeSource(`/deputados/${deputy.id}`),
  };
}
