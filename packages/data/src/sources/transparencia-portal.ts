import { fetchJson } from "../utils/http.js";
import type { Source } from "../schemas/index.js";

const BASE_URL = "https://api.portaldatransparencia.gov.br/api-de-dados";

function getApiKey(): string | undefined {
  return process.env.TRANSPARENCIA_API_KEY;
}

function makeSource(path: string): Source {
  return {
    name: "Portal da Transparência",
    url: `${BASE_URL}${path}`,
    fetchedAt: new Date().toISOString(),
  };
}

// --- Raw API types ---

interface CeisSanction {
  id: number;
  cpfCnpj: string;
  nomeSancionado: string;
  nomeInformadoOrgaoSancionador: string;
  razaoSocialCadastroReceita: string;
  nomeFantasiaCadastroReceita: string;
  tipoSancao: { descricaoResumida: string };
  dataInicioSancao: string;
  dataFinalSancao: string;
  dataPublicacao: string;
  orgaoSancionador: { nome: string };
  fonteSancao: string;
}

interface CnepSanction {
  id: number;
  cpfCnpj: string;
  nomeSancionado: string;
  nomeInformadoOrgaoSancionador: string;
  tipoSancao: { descricaoResumida: string };
  dataInicioSancao: string;
  dataFinalSancao: string;
  orgaoSancionador: { nome: string };
  fonteSancao: string;
}

interface CeafSanction {
  id: number;
  cpfCnpj: string;
  nomeSancionado: string;
  tipoSancao: { descricaoResumida: string };
  dataInicioSancao: string;
  dataFinalSancao: string;
  orgaoSancionador: { nome: string };
  fundamentoLegal: string;
}

// --- Public API ---

export interface TransparenciaData {
  sanctions: {
    ceis: CeisSanction[];
    cnep: CnepSanction[];
    ceaf: CeafSanction[];
  };
  source: Source;
}

/**
 * Check if the Portal da Transparência API key is configured.
 */
export function isConfigured(): boolean {
  return !!getApiKey();
}

/**
 * Fetch all three sanction types (CEIS, CNEP, CEAF) for a given CPF.
 * Returns null if the API key is not configured.
 */
export async function fetchSanctions(cpf: string): Promise<TransparenciaData | null> {
  const apiKey = getApiKey();

  if (!apiKey) {
    console.log(
      "[Portal da Transparência] TRANSPARENCIA_API_KEY não configurada. Pulando consulta de sanções.",
    );
    return null;
  }

  const headers = { "chave-api-dados": apiKey };
  const cleanCpf = cpf.replace(/\D/g, "");

  console.log(`[Portal da Transparência] Buscando sanções para CPF ${cleanCpf}...`);

  const [ceis, cnep, ceaf] = await Promise.all([
    fetchSanctionType<CeisSanction>("ceis", cleanCpf, headers),
    fetchSanctionType<CnepSanction>("cnep", cleanCpf, headers),
    fetchSanctionType<CeafSanction>("ceaf", cleanCpf, headers),
  ]);

  const totalFound = ceis.length + cnep.length + ceaf.length;
  console.log(
    `[Portal da Transparência] Encontradas ${totalFound} sanções (CEIS: ${ceis.length}, CNEP: ${cnep.length}, CEAF: ${ceaf.length})`,
  );

  return {
    sanctions: { ceis, cnep, ceaf },
    source: makeSource(`/ceis?cpfCnpj=${cleanCpf}`),
  };
}

async function fetchSanctionType<T>(
  endpoint: string,
  cpf: string,
  headers: Record<string, string>,
): Promise<T[]> {
  try {
    const result = await fetchJson<T[]>(`${BASE_URL}/${endpoint}`, {
      headers,
      params: {
        pagina: 1,
        tamanhoPagina: 15,
        cpfCnpj: cpf,
      },
    });
    return Array.isArray(result) ? result : [];
  } catch (error) {
    console.warn(
      `[Portal da Transparência] Erro ao buscar ${endpoint.toUpperCase()} para CPF ${cpf}: ${error}`,
    );
    return [];
  }
}
