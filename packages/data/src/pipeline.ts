import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchDeputies, fetchFullDeputyData } from "./sources/camara.js";
import { normalizeCamaraDeputy } from "./normalizers/camara.js";
import { fetchSenadores, fetchFullSenadorData } from "./sources/senado.js";
import { normalizeSenador } from "./normalizers/senado.js";
import { fetchTseCandidateData, type TseCandidatoData } from "./sources/tse.js";
import { mergeTseData } from "./normalizers/tse.js";
import { fetchCampaignFinanceFromTseData } from "./sources/divulgacand.js";
import { normalizeDivulgaCandFinance } from "./normalizers/divulgacand.js";
import { isConfigured as isTransparenciaConfigured } from "./sources/transparencia-portal.js";
import { searchProceedings, isConfigured as isCnjConfigured } from "./sources/cnj.js";
import { PRESIDENTIAL_CANDIDATES_2026, type PresidentialCandidate } from "./candidates.js";
import type { CandidateProfile, PipelineMetadata } from "./schemas/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "..", "output");
const CANDIDATES_DIR = join(OUTPUT_DIR, "candidates");
const DIMENSIONS_DIR = join(OUTPUT_DIR, "dimensions");

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function ensureDirs(): Promise<void> {
  await mkdir(CANDIDATES_DIR, { recursive: true });
  await mkdir(DIMENSIONS_DIR, { recursive: true });
  await mkdir(join(OUTPUT_DIR, "raw"), { recursive: true });
}

async function writeCandidate(profile: CandidateProfile): Promise<void> {
  const path = join(CANDIDATES_DIR, `${profile.slug}.json`);
  await writeFile(path, JSON.stringify(profile, null, 2), "utf-8");
}

async function writeMetadata(metadata: PipelineMetadata): Promise<void> {
  const path = join(OUTPUT_DIR, "metadata.json");
  await writeFile(path, JSON.stringify(metadata, null, 2), "utf-8");
}

async function writeDimensionFiles(profiles: CandidateProfile[]): Promise<void> {
  const dimensions = {
    "track-record": profiles.map((p) => ({
      slug: p.slug,
      shortName: p.shortName,
      party: p.currentParty,
      facts: p.facts.filter((f) => f.dimension === "historico"),
      votingSummaries: p.votingSummaries,
      proposalCount: p.proposals.length,
    })),
    "policy-positions": profiles.map((p) => ({
      slug: p.slug,
      shortName: p.shortName,
      party: p.currentParty,
      facts: p.facts.filter((f) => f.dimension === "propostas"),
      legislativeThemes: p.legislativeThemes,
      governmentPlanUrl: p.governmentPlanUrl,
    })),
    "integrity": profiles.map((p) => ({
      slug: p.slug,
      shortName: p.shortName,
      party: p.currentParty,
      facts: p.facts.filter((f) => f.dimension === "integridade"),
      assetDeclarations: p.assetDeclarations,
      campaignFinances: p.campaignFinances,
    })),
    "commitments": profiles.map((p) => ({
      slug: p.slug,
      shortName: p.shortName,
      party: p.currentParty,
      facts: p.facts.filter((f) => f.dimension === "compromissos"),
      partyHistory: p.partyHistory,
    })),
  };

  for (const [name, data] of Object.entries(dimensions)) {
    await writeFile(
      join(DIMENSIONS_DIR, `${name}.json`),
      JSON.stringify(data, null, 2),
      "utf-8",
    );
  }
}

/**
 * Create a base CandidateProfile from the presidential candidate config.
 * This is the starting point before enrichment from any data source.
 */
function createBaseProfile(candidate: PresidentialCandidate): CandidateProfile {
  const now = new Date().toISOString();
  return {
    slug: slugify(candidate.shortName),
    name: candidate.name,
    shortName: candidate.shortName,
    photoUrl: candidate.photoUrl,
    currentParty: candidate.party,
    state: candidate.state,
    birthDate: undefined,
    education: undefined,
    occupation: candidate.currentRole,
    officesHeld: [],
    votingSummaries: [],
    proposals: [],
    governmentPlanUrl: undefined,
    legislativeThemes: [],
    assetDeclarations: [],
    campaignFinances: [],
    partyHistory: [],
    facts: [],
    lastUpdated: now,
    sources: [],
  };
}

// --- Enrichment from Câmara ---

async function enrichFromCamara(
  profile: CandidateProfile,
  candidate: PresidentialCandidate,
): Promise<boolean> {
  if (!candidate.camaraId) return false;

  try {
    // Fetch all deputies and find the one matching our candidate
    const deputies = await fetchDeputies(undefined, 600);
    const match = deputies.find((d) => d.id === candidate.camaraId);
    if (!match) return false;

    const data = await fetchFullDeputyData(match);
    const camaraProfile = normalizeCamaraDeputy(data);

    // Merge Câmara data into the profile
    profile.officesHeld.push(...camaraProfile.officesHeld);
    profile.votingSummaries.push(...camaraProfile.votingSummaries);
    profile.proposals.push(...camaraProfile.proposals);
    profile.legislativeThemes.push(...camaraProfile.legislativeThemes);
    profile.facts.push(...camaraProfile.facts);
    profile.photoUrl = profile.photoUrl || camaraProfile.photoUrl;
    profile.birthDate = profile.birthDate || camaraProfile.birthDate;
    profile.education = profile.education || camaraProfile.education;
    if (!profile.sources.includes("Câmara dos Deputados - Dados Abertos")) {
      profile.sources.push("Câmara dos Deputados - Dados Abertos");
    }
    console.log(`  + Câmara: dados legislativos adicionados`);
    return true;
  } catch (error) {
    console.warn(`  x Câmara: ${error}`);
    return false;
  }
}

// --- Enrichment from Senado ---

async function enrichFromSenado(
  profile: CandidateProfile,
  candidate: PresidentialCandidate,
): Promise<boolean> {
  if (!candidate.senadoCodigo) return false;

  try {
    const senadores = await fetchSenadores(200);
    const match = senadores.find(
      (s) => s.IdentificacaoParlamentar.CodigoParlamentar === candidate.senadoCodigo,
    );
    if (!match) return false;

    const data = await fetchFullSenadorData(match);
    const senadoProfile = normalizeSenador(data);

    profile.officesHeld.push(...senadoProfile.officesHeld);
    profile.votingSummaries.push(...senadoProfile.votingSummaries);
    profile.proposals.push(...senadoProfile.proposals);
    profile.facts.push(...senadoProfile.facts);
    profile.photoUrl = profile.photoUrl || senadoProfile.photoUrl;
    profile.birthDate = profile.birthDate || senadoProfile.birthDate;
    profile.education = profile.education || senadoProfile.education;
    if (!profile.sources.includes("Senado Federal - Dados Abertos")) {
      profile.sources.push("Senado Federal - Dados Abertos");
    }
    console.log(`  + Senado: dados legislativos adicionados`);
    return true;
  } catch (error) {
    console.warn(`  x Senado: ${error}`);
    return false;
  }
}

// --- Enrichment from TSE ---

async function enrichFromTse(
  profile: CandidateProfile,
  state: string,
): Promise<TseCandidatoData | null> {
  try {
    let tseData = await fetchTseCandidateData(profile.name, state);
    if (!tseData) {
      // Try with short name
      tseData = await fetchTseCandidateData(profile.shortName, state);
      if (!tseData) return null;
    }
    const merged = mergeTseData(profile, tseData);
    Object.assign(profile, merged);
    const via = tseData.name !== profile.name ? " (via nome de urna)" : "";
    console.log(`  + TSE: ${tseData.elections.length} eleição(ões)${via}`);
    return tseData;
  } catch (error) {
    console.warn(`  x TSE: ${error}`);
    return null;
  }
}

// --- Enrichment from DivulgaCandContas ---

async function enrichFromDivulgaCand(
  profile: CandidateProfile,
  tseData: TseCandidatoData | null,
): Promise<boolean> {
  if (!tseData || tseData.elections.length === 0) {
    console.log(`  - DivulgaCandContas: sem dados TSE para buscar finanças`);
    return false;
  }

  try {
    const financeData = await fetchCampaignFinanceFromTseData(
      profile.shortName,
      tseData.elections,
    );
    if (financeData && financeData.length > 0) {
      const normalized = normalizeDivulgaCandFinance(financeData);
      profile.campaignFinances.push(...normalized.campaignFinances);
      profile.facts.push(...normalized.facts);
      if (!profile.sources.includes("DivulgaCandContas")) {
        profile.sources.push("DivulgaCandContas");
      }
      console.log(`  + DivulgaCandContas: ${financeData.length} registro(s) de finanças`);
      return true;
    }
    return false;
  } catch (error) {
    console.warn(`  x DivulgaCandContas: ${error}`);
    return false;
  }
}

// --- Enrichment from CNJ ---

async function enrichFromCnj(profile: CandidateProfile): Promise<boolean> {
  if (!isCnjConfigured()) return false;

  try {
    const data = await searchProceedings(profile.name);
    if (data && data.proceedings.length > 0) {
      const tribunals = [...new Set(data.proceedings.map((p) => p.tribunal))];
      profile.facts.push({
        id: `cnj-processos-${profile.slug}`,
        label: "Processos judiciais encontrados",
        value: data.totalFound,
        context: `em ${tribunals.join(", ")}`,
        source: data.source,
        dimension: "integridade",
        category: "Processos Judiciais",
      });
      if (!profile.sources.includes("CNJ DataJud")) {
        profile.sources.push("CNJ DataJud");
      }
      console.log(`  + CNJ: ${data.totalFound} processos encontrados`);
      return true;
    }
    return false;
  } catch (error) {
    console.warn(`  x CNJ: ${error}`);
    return false;
  }
}

// --- Main pipeline ---

async function main(): Promise<void> {
  const startTime = Date.now();
  const candidates = PRESIDENTIAL_CANDIDATES_2026;

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   Transparência — Pipeline Presidencial 2026 ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(`\nIniciado: ${new Date().toISOString()}`);
  console.log(`Candidatos: ${candidates.length}`);

  if (!isTransparenciaConfigured()) {
    console.log("(Portal da Transparência: TRANSPARENCIA_API_KEY não configurada)");
  }
  if (!isCnjConfigured()) {
    console.log("(CNJ DataJud: CNJ_API_KEY não configurada)");
  }

  await ensureDirs();

  const sourceResults: PipelineMetadata["sources"] = [];
  const sourceCounts = { camara: 0, senado: 0, tse: 0, divulgacand: 0, cnj: 0 };
  const allProfiles: CandidateProfile[] = [];

  for (const candidate of candidates) {
    console.log(`\n--- ${candidate.shortName} (${candidate.party}-${candidate.state}) ---`);
    console.log(`    ${candidate.currentRole}`);

    const profile = createBaseProfile(candidate);

    // Try all sources for this candidate
    if (await enrichFromCamara(profile, candidate)) sourceCounts.camara++;
    if (await enrichFromSenado(profile, candidate)) sourceCounts.senado++;
    const tseData = await enrichFromTse(profile, candidate.state);
    if (tseData) sourceCounts.tse++;
    if (await enrichFromDivulgaCand(profile, tseData)) sourceCounts.divulgacand++;
    if (await enrichFromCnj(profile)) sourceCounts.cnj++;

    // Add a fact about current role
    profile.facts.push({
      id: `role-${profile.slug}`,
      label: "Cargo/função atual",
      value: candidate.currentRole,
      source: {
        name: "Transparência (curadoria)",
        url: "https://atvinicius.github.io/transparencia/metodologia",
        fetchedAt: new Date().toISOString(),
      },
      dimension: "historico",
      category: "Informações Gerais",
    });

    profile.lastUpdated = new Date().toISOString();
    allProfiles.push(profile);
    await writeCandidate(profile);
    console.log(`    => ${profile.facts.length} fatos, ${profile.sources.length} fontes`);
  }

  // Build source results
  sourceResults.push(
    { name: "Câmara dos Deputados", status: sourceCounts.camara > 0 ? "success" : "partial", recordCount: sourceCounts.camara, lastFetched: new Date().toISOString() },
    { name: "Senado Federal", status: sourceCounts.senado > 0 ? "success" : "partial", recordCount: sourceCounts.senado, lastFetched: new Date().toISOString() },
    { name: "TSE — Dados Abertos", status: sourceCounts.tse > 0 ? "success" : "partial", recordCount: sourceCounts.tse, lastFetched: new Date().toISOString() },
    { name: "DivulgaCandContas", status: sourceCounts.divulgacand > 0 ? "success" : "partial", recordCount: sourceCounts.divulgacand, lastFetched: new Date().toISOString() },
  );

  // Write outputs
  await writeDimensionFiles(allProfiles);

  const index = allProfiles.map((p) => ({
    slug: p.slug,
    name: p.name,
    shortName: p.shortName,
    party: p.currentParty,
    state: p.state,
    photoUrl: p.photoUrl,
  }));
  await writeFile(join(OUTPUT_DIR, "candidates-index.json"), JSON.stringify(index, null, 2), "utf-8");

  const metadata: PipelineMetadata = {
    lastRun: new Date().toISOString(),
    sources: sourceResults,
    candidateCount: allProfiles.length,
  };
  await writeMetadata(metadata);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n${"=".repeat(48)}`);
  console.log(`Pipeline concluído em ${elapsed}s`);
  console.log(`  Candidatos presidenciais: ${allProfiles.length}`);
  console.log(`  Câmara: ${sourceCounts.camara} | Senado: ${sourceCounts.senado} | TSE: ${sourceCounts.tse} | Finanças: ${sourceCounts.divulgacand} | CNJ: ${sourceCounts.cnj}`);
  console.log(`  Output: ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error("Pipeline failed:", error);
  process.exit(1);
});
