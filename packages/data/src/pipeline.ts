import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchDeputies, fetchFullDeputyData } from "./sources/camara.js";
import { normalizeCamaraDeputy } from "./normalizers/camara.js";
import type { CandidateProfile, PipelineMetadata } from "./schemas/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "..", "output");
const CANDIDATES_DIR = join(OUTPUT_DIR, "candidates");

// --- Candidate registry: known/potential 2026 presidential candidates ---
// We fetch data for all deputies but can filter to known candidates
const KNOWN_CANDIDATE_IDS: Set<number> = new Set([
  // These will be populated as candidates announce
  // For now, we collect data for all current deputies
]);

async function ensureDirs(): Promise<void> {
  await mkdir(CANDIDATES_DIR, { recursive: true });
  await mkdir(join(OUTPUT_DIR, "dimensions"), { recursive: true });
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

// --- Main pipeline ---

async function runCamaraPipeline(limit?: number): Promise<{
  profiles: CandidateProfile[];
  status: "success" | "partial" | "error";
  error?: string;
}> {
  console.log("\n=== Câmara dos Deputados Pipeline ===\n");

  try {
    const deputies = await fetchDeputies(undefined, limit);

    const toProcess = deputies;
    console.log(`[Pipeline] Processing ${toProcess.length} deputies...`);

    const profiles: CandidateProfile[] = [];
    let errors = 0;

    for (const deputy of toProcess) {
      try {
        const data = await fetchFullDeputyData(deputy);
        const profile = normalizeCamaraDeputy(data);
        await writeCandidate(profile);
        profiles.push(profile);
        console.log(`  ✓ ${profile.shortName} (${profile.currentParty}-${profile.state})`);
      } catch (error) {
        errors++;
        console.error(`  ✗ ${deputy.nome}: ${error}`);
      }
    }

    return {
      profiles,
      status: errors === 0 ? "success" : errors < toProcess.length ? "partial" : "error",
      error: errors > 0 ? `${errors} deputies failed` : undefined,
    };
  } catch (error) {
    return {
      profiles: [],
      status: "error",
      error: String(error),
    };
  }
}

async function main(): Promise<void> {
  const { source, limit } = parseArgs();
  const startTime = Date.now();

  console.log("╔══════════════════════════════════════╗");
  console.log("║   Transparência — Data Pipeline      ║");
  console.log("╚══════════════════════════════════════╝");
  console.log(`\nStarted at: ${new Date().toISOString()}`);
  if (limit) console.log(`Limit: ${limit} candidates per source`);

  await ensureDirs();

  const sourceResults: PipelineMetadata["sources"] = [];
  let allProfiles: CandidateProfile[] = [];

  // Run Câmara pipeline (unless a different source was specified)
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

  // Write metadata
  const metadata: PipelineMetadata = {
    lastRun: new Date().toISOString(),
    sources: sourceResults,
    candidateCount: allProfiles.length,
  };
  await writeMetadata(metadata);

  // Write a candidates index
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

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✓ Pipeline complete in ${elapsed}s`);
  console.log(`  Candidates: ${allProfiles.length}`);
  console.log(`  Output: ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error("Pipeline failed:", error);
  process.exit(1);
});
