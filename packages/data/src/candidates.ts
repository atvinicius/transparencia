/**
 * Known/likely 2026 presidential candidates.
 *
 * Each entry provides the candidate's name and IDs in various data sources.
 * IDs are optional — the pipeline will attempt to find data even without them.
 *
 * This list should be updated as candidates officially announce or withdraw.
 */

export interface PresidentialCandidate {
  /** Full civil name (used for TSE/DivulgaCandContas search) */
  name: string;
  /** Nome de urna / nome político */
  shortName: string;
  /** Current party affiliation */
  party: string;
  /** State of origin */
  state: string;
  /** Photo URL (optional, filled by pipeline if available) */
  photoUrl?: string;
  /** ID in Câmara API (if currently a federal deputy) */
  camaraId?: number;
  /** Código in Senado API (if currently a senator) */
  senadoCodigo?: string;
  /** Brief description of current/recent role */
  currentRole: string;
}

export const PRESIDENTIAL_CANDIDATES_2026: PresidentialCandidate[] = [
  {
    name: "Luiz Inácio Lula da Silva",
    shortName: "Lula",
    party: "PT",
    state: "SP",
    currentRole: "Presidente da República (2023–)",
  },
  {
    name: "Tarcísio Gomes de Freitas",
    shortName: "Tarcísio de Freitas",
    party: "REPUBLICANOS",
    state: "SP",
    currentRole: "Governador de São Paulo (2023–)",
  },
  {
    name: "Ciro Ferreira Gomes",
    shortName: "Ciro Gomes",
    party: "PDT",
    state: "CE",
    currentRole: "Ex-governador do Ceará, ex-candidato à presidência",
  },
  {
    name: "Simone Nassar Tebet",
    shortName: "Simone Tebet",
    party: "MDB",
    state: "MS",
    currentRole: "Ministra do Planejamento (2023–)",
  },
  {
    name: "Ronaldo Rodrigues Caiado",
    shortName: "Ronaldo Caiado",
    party: "UNIÃO",
    state: "GO",
    currentRole: "Governador de Goiás (2019–)",
  },
  {
    name: "Ratinho Junior",
    shortName: "Ratinho Junior",
    party: "PSD",
    state: "PR",
    currentRole: "Governador do Paraná (2019–)",
  },
  {
    name: "Guilherme Boulos",
    shortName: "Guilherme Boulos",
    party: "PSOL",
    state: "SP",
    camaraId: 220639,
    currentRole: "Deputado Federal (2023–)",
  },
  {
    name: "Fernando Haddad",
    shortName: "Fernando Haddad",
    party: "PT",
    state: "SP",
    currentRole: "Ministro da Fazenda (2023–)",
  },
  {
    name: "Pablo Marçal",
    shortName: "Pablo Marçal",
    party: "PRTB",
    state: "SP",
    currentRole: "Empresário, ex-candidato a prefeito de SP",
  },
  {
    name: "Helder Zahluth Barbalho",
    shortName: "Helder Barbalho",
    party: "MDB",
    state: "PA",
    currentRole: "Governador do Pará (2019–)",
  },
  {
    name: "Jair Messias Bolsonaro",
    shortName: "Jair Bolsonaro",
    party: "PL",
    state: "RJ",
    currentRole: "Ex-Presidente da República (2019–2022)",
  },
  {
    name: "Romeu Zema Neto",
    shortName: "Romeu Zema",
    party: "NOVO",
    state: "MG",
    currentRole: "Governador de Minas Gerais (2019–)",
  },
];
