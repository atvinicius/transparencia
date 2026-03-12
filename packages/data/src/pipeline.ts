import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchDeputies, fetchFullDeputyData } from "./sources/camara.js";
import { normalizeCamaraDeputy } from "./normalizers/camara.js";
import { fetchSenadores, fetchFullSenadorData } from "./sources/senado.js";
import { normalizeSenador } from "./normalizers/senado.js";
import { fetchTseCandidateData } from "./sources/tse.js";
import { mergeTseData } from "./normalizers/tse.js";
import { fetchCampaignFinanceByName } from "./sources/divulgacand.js";
import { normalizeDivulgaCandFinance } from "./normalizers/divulgacand.js";
import { fetchSanctions, isConfigured as isTransparenciaConfigured } from "./sources/transparencia-portal.js";
import { searchProceedings, isConfigured as isCnjConfigured } from "./sources/cnj.js";
import type { CandidateProfile, PipelineMetadata } from "./schemas/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "..", "output");
const CANDIDATES_DIR = join(OUTPUT_DIR, "candidates");
const DIMENSIONS_DIR = join(OUTPUT_DIR, "dimensions");

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

// --- Parse CLI args ---
function parseArgs(): { source?: string; limit?: number } {
  const args = process.argv.slice(2);
  const result: { source?: string; limit?: number } = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--source" && args[i + 1]) {
      result.source = args[i + 1];
      i++;
    }
    if (args[i] === "--limit" && args[i + 1]) {
      result.limit = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return result;
}

// --- Source runners ---

interface SourceResult {
  profiles: CandidateProfile[];
  status: "success" | "partial" | "error";
  error?: string;
}

async function runCamaraPipeline(limit?: number): Promise<SourceResult> {
  console.log("\n=== Câmara dos Deputados ===\n");

  try {
    const deputies = await fetchDeputies(undefined, limit);
    console.log(`[Câmara] Processing ${deputies.length} deputies...`);

    const profiles: CandidateProfile[] = [];
    let errors = 0;

    for (const deputy of deputies) {
      try {
        const data = await fetchFullDeputyData(deputy);
        const profile = normalizeCamaraDeputy(data);
        profiles.push(profile);
        console.log(`  + ${profile.shortName} (${profile.currentParty}-${profile.state})`);
      } catch (error) {
        errors++;
        console.error(`  x ${deputy.nome}: ${error}`);
      }
    }

    return {
      profiles,
      status: errors === 0 ? "success" : errors < deputies.length ? "partial" : "error",
      error: errors > 0 ? `${errors} deputies failed` : undefined,
    };
  } catch (error) {
    return { profiles: [], status: "error", error: String(error) };
  }
}

async function runSenadoPipeline(limit?: number): Promise<SourceResult> {
  console.log("\n=== Senado Federal ===\n");

  try {
    const senadores = await fetchSenadores(limit);
    console.log(`[Senado] Processing ${senadores.length} senators...`);

    const profiles: CandidateProfile[] = [];
    let errors = 0;

    for (const senador of senadores) {
      try {
        const data = await fetchFullSenadorData(senador);
        const profile = normalizeSenador(data);
        profiles.push(profile);
        console.log(`  + ${profile.shortName} (${profile.currentParty}-${profile.state})`);
      } catch (error) {
        errors++;
        console.error(`  x ${senador.IdentificacaoParlamentar.NomeParlamentar}: ${error}`);
      }
    }

    return {
      profiles,
      status: errors === 0 ? "success" : errors < senadores.length ? "partial" : "error",
      error: errors > 0 ? `${errors} senators failed` : undefined,
    };
  } catch (error) {
    return { profiles: [], status: "error", error: String(error) };
  }
}

async function enrichWithTse(profiles: CandidateProfile[]): Promise<{ enriched: number; errors: number }> {
  console.log("\n=== TSE — Dados Eleitorais ===\n");
  let enriched = 0;
  let errors = 0;

  for (const profile of profiles) {
    try {
      const tseData = await fetchTseCandidateData(profile.name);
      if (tseData) {
        const merged = mergeTseData(profile, tseData);
        // Copy merged fields back into the profile
        Object.assign(profile, merged);
        enriched++;
        console.log(`  + ${profile.shortName}: TSE data merged`);
      }
    } catch (error) {
      errors++;
      console.warn(`  x ${profile.shortName}: TSE failed — ${error}`);
    }
  }

  return { enriched, errors };
}

async function enrichWithCampaignFinance(profiles: CandidateProfile[]): Promise<{ enriched: number; errors: number }> {
  console.log("\n=== DivulgaCandContas — Finanças de Campanha ===\n");
  let enriched = 0;
  let errors = 0;

  for (const profile of profiles) {
    try {
      const financeData = await fetchCampaignFinanceByName(profile.name);
      if (financeData && financeData.length > 0) {
        const normalized = normalizeDivulgaCandFinance(financeData);
        profile.campaignFinances.push(...normalized.campaignFinances);
        profile.facts.push(...normalized.facts);
        if (!profile.sources.includes("DivulgaCandContas")) {
          profile.sources.push("DivulgaCandContas");
        }
        enriched++;
        console.log(`  + ${profile.shortName}: finance data merged`);
      }
    } catch (error) {
      errors++;
      console.warn(`  x ${profile.shortName}: DivulgaCandContas failed — ${error}`);
    }
  }

  return { enriched, errors };
}

async function enrichWithTransparencia(profiles: CandidateProfile[]): Promise<{ enriched: number; errors: number }> {
  if (!isTransparenciaConfigured()) {
    console.log("\n=== Portal da Transparência === (pulado — TRANSPARENCIA_API_KEY não configurada)\n");
    return { enriched: 0, errors: 0 };
  }

  console.log("\n=== Portal da Transparência ===\n");
  console.log("  (Requer CPF do candidato — funcionalidade será expandida em versões futuras)");
  // Portal da Transparência requires CPF for sanctions lookup.
  // CandidateProfile doesn't currently store CPF, so we skip for now.
  // TODO: Add CPF field to profile or create a CPF lookup mechanism.
  return { enriched: 0, errors: 0 };
}

async function enrichWithCnj(profiles: CandidateProfile[]): Promise<{ enriched: number; errors: number }> {
  if (!isCnjConfigured()) {
    console.log("\n=== CNJ DataJud === (pulado — CNJ_API_KEY não configurada)\n");
    return { enriched: 0, errors: 0 };
  }

  console.log("\n=== CNJ DataJud ===\n");
  let enriched = 0;
  let errors = 0;

  for (const profile of profiles) {
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
        enriched++;
        console.log(`  + ${profile.shortName}: ${data.totalFound} proceedings found`);
      }
    } catch (error) {
      errors++;
      console.warn(`  x ${profile.shortName}: CNJ failed — ${error}`);
    }
  }

  return { enriched, errors };
}

// --- Main pipeline ---

async function main(): Promise<void> {
  const { source, limit } = parseArgs();
  const startTime = Date.now();

  console.log("╔══════════════════════════════════════╗");
  console.log("║   Transparência — Data Pipeline      ║");
  console.log("╚══════════════════════════════════════╝");
  console.log(`\nIniciado: ${new Date().toISOString()}`);
  if (limit) console.log(`Limite: ${limit} candidatos por fonte`);
  if (source) console.log(`Fonte: ${source}`);

  await ensureDirs();

  const sourceResults: PipelineMetadata["sources"] = [];
  let allProfiles: CandidateProfile[] = [];

  // Step 1: Fetch from primary legislative sources
  if (!source || source === "camara") {
    const camara = await runCamaraPipeline(limit);
    allProfiles.push(...camara.profiles);
    sourceResults.push({
      name: "Câmara dos Deputados",
      status: camara.status,
      recordCount: camara.profiles.length,
      lastFetched: new Date().toISOString(),
      error: camara.error,
    });
  }

  if (!source || source === "senado") {
    const senado = await runSenadoPipeline(limit);
    allProfiles.push(...senado.profiles);
    sourceResults.push({
      name: "Senado Federal",
      status: senado.status,
      recordCount: senado.profiles.length,
      lastFetched: new Date().toISOString(),
      error: senado.error,
    });
  }

  // Step 2: Enrich with supplementary sources (TSE, DivulgaCandContas, etc.)
  if (!source || source === "tse") {
    const tse = await enrichWithTse(allProfiles);
    sourceResults.push({
      name: "TSE — Dados Abertos",
      status: tse.errors === 0 ? "success" : "partial",
      recordCount: tse.enriched,
      lastFetched: new Date().toISOString(),
      error: tse.errors > 0 ? `${tse.errors} failures` : undefined,
    });
  }

  if (!source || source === "divulgacand") {
    const finance = await enrichWithCampaignFinance(allProfiles);
    sourceResults.push({
      name: "DivulgaCandContas",
      status: finance.errors === 0 ? "success" : "partial",
      recordCount: finance.enriched,
      lastFetched: new Date().toISOString(),
      error: finance.errors > 0 ? `${finance.errors} failures` : undefined,
    });
  }

  if (!source || source === "transparencia") {
    const transp = await enrichWithTransparencia(allProfiles);
    if (isTransparenciaConfigured()) {
      sourceResults.push({
        name: "Portal da Transparência",
        status: transp.errors === 0 ? "success" : "partial",
        recordCount: transp.enriched,
        lastFetched: new Date().toISOString(),
        error: transp.errors > 0 ? `${transp.errors} failures` : undefined,
      });
    }
  }

  if (!source || source === "cnj") {
    const cnj = await enrichWithCnj(allProfiles);
    if (isCnjConfigured()) {
      sourceResults.push({
        name: "CNJ DataJud",
        status: cnj.errors === 0 ? "success" : "partial",
        recordCount: cnj.enriched,
        lastFetched: new Date().toISOString(),
        error: cnj.errors > 0 ? `${cnj.errors} failures` : undefined,
      });
    }
  }

  // Step 3: Write all outputs
  for (const profile of allProfiles) {
    profile.lastUpdated = new Date().toISOString();
    await writeCandidate(profile);
  }

  // Write dimension files
  await writeDimensionFiles(allProfiles);

  // Write candidates index
  const index = allProfiles.map((p) => ({
    slug: p.slug,
    name: p.name,
    shortName: p.shortName,
    party: p.currentParty,
    state: p.state,
    photoUrl: p.photoUrl,
  }));
  await writeFile(
    join(OUTPUT_DIR, "candidates-index.json"),
    JSON.stringify(index, null, 2),
    "utf-8",
  );

  // Write metadata
  const metadata: PipelineMetadata = {
    lastRun: new Date().toISOString(),
    sources: sourceResults,
    candidateCount: allProfiles.length,
  };
  await writeMetadata(metadata);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n${"=".repeat(40)}`);
  console.log(`Pipeline concluído em ${elapsed}s`);
  console.log(`  Candidatos: ${allProfiles.length}`);
  console.log(`  Fontes: ${sourceResults.map((s) => `${s.name} (${s.status})`).join(", ")}`);
  console.log(`  Output: ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error("Pipeline failed:", error);
  process.exit(1);
});
