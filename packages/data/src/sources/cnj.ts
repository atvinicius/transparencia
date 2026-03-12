import type { Source } from "../schemas/index.js";

const BASE_URL = "https://api-publica.datajud.cnj.jus.br";

/** Default tribunals to search when none are specified. */
const DEFAULT_TRIBUNALS = ["stf", "stj", "tse"] as const;

function getApiKey(): string | undefined {
  return process.env.CNJ_API_KEY;
}

function makeSource(tribunal: string): Source {
  return {
    name: `CNJ DataJud (${tribunal.toUpperCase()})`,
    url: `${BASE_URL}/api_publica_${tribunal}/_search`,
    fetchedAt: new Date().toISOString(),
  };
}

// --- Raw API types ---

interface DataJudHit {
  _source: {
    numeroProcesso: string;
    classe: { nome: string };
    assuntos: Array<{ nome: string }>;
    orgaoJulgador: { nome: string };
    dataAjuizamento: string;
    movimentos: Array<{
      nome: string;
      dataHora: string;
    }>;
  };
}

interface DataJudResponse {
  hits: {
    total: { value: number };
    hits: DataJudHit[];
  };
}

// --- Public API ---

export interface CnjProceeding {
  numeroProcesso: string;
  classe: string;
  assuntos: string[];
  orgaoJulgador: string;
  dataAjuizamento: string;
  movimentos: Array<{ nome: string; dataHora: string }>;
  tribunal: string;
}

export interface CnjData {
  proceedings: CnjProceeding[];
  totalFound: number;
  source: Source;
}

/**
 * Check if the CNJ DataJud API key is configured.
 */
export function isConfigured(): boolean {
  return !!getApiKey();
}

/**
 * Search for legal proceedings related to a candidate name across key tribunals.
 * Returns null if the API key is not configured.
 */
export async function searchProceedings(
  name: string,
  tribunals?: string[],
): Promise<CnjData | null> {
  const apiKey = getApiKey();

  if (!apiKey) {
    console.log(
      "[CNJ DataJud] CNJ_API_KEY não configurada. Pulando consulta de processos judiciais.",
    );
    return null;
  }

  const tribunalList = tribunals ?? [...DEFAULT_TRIBUNALS];

  console.log(
    `[CNJ DataJud] Buscando processos para "${name}" nos tribunais: ${tribunalList.map((t) => t.toUpperCase()).join(", ")}...`,
  );

  const allProceedings: CnjProceeding[] = [];
  let totalFound = 0;
  let lastTribunal = tribunalList[0] ?? "stf";

  const results = await Promise.all(
    tribunalList.map((tribunal) => searchTribunal(name, tribunal, apiKey)),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const tribunal = tribunalList[i];
    if (result) {
      allProceedings.push(...result.proceedings);
      totalFound += result.totalFound;
      lastTribunal = tribunal;
    }
  }

  console.log(
    `[CNJ DataJud] Encontrados ${totalFound} processos (${allProceedings.length} retornados)`,
  );

  return {
    proceedings: allProceedings,
    totalFound,
    source: makeSource(lastTribunal),
  };
}

async function searchTribunal(
  name: string,
  tribunal: string,
  apiKey: string,
): Promise<{ proceedings: CnjProceeding[]; totalFound: number } | null> {
  const url = `${BASE_URL}/api_publica_${tribunal}/_search`;

  const body = {
    query: {
      bool: {
        must: [
          { match: { nomeParteEnvolvida: name } },
        ],
      },
    },
    size: 10,
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `APIKey ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.warn(
        `[CNJ DataJud] Erro HTTP ${response.status} ao buscar no ${tribunal.toUpperCase()}: ${response.statusText}`,
      );
      return null;
    }

    const data = (await response.json()) as DataJudResponse;

    const proceedings: CnjProceeding[] = (data.hits?.hits ?? []).map((hit) => ({
      numeroProcesso: hit._source.numeroProcesso,
      classe: hit._source.classe?.nome ?? "Desconhecida",
      assuntos: (hit._source.assuntos ?? []).map((a) => a.nome),
      orgaoJulgador: hit._source.orgaoJulgador?.nome ?? "Desconhecido",
      dataAjuizamento: hit._source.dataAjuizamento ?? "",
      movimentos: hit._source.movimentos ?? [],
      tribunal: tribunal.toUpperCase(),
    }));

    return {
      proceedings,
      totalFound: data.hits?.total?.value ?? 0,
    };
  } catch (error) {
    console.warn(
      `[CNJ DataJud] Erro ao buscar processos no ${tribunal.toUpperCase()}: ${error}`,
    );
    return null;
  }
}
