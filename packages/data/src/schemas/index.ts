import { z } from "zod";

// --- Enums ---

export const Dimension = z.enum([
  "historico",      // Track record & experience
  "propostas",      // Policy positions & proposals
  "integridade",    // Integrity & legal standing
  "compromissos",   // Commitments & consistency
]);
export type Dimension = z.infer<typeof Dimension>;

// --- Source citation ---

export const Source = z.object({
  name: z.string(),
  url: z.string().url(),
  fetchedAt: z.string().datetime(),
});
export type Source = z.infer<typeof Source>;

// --- A single verifiable fact ---

export const Fact = z.object({
  id: z.string(),
  label: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
  context: z.string().optional(),
  source: Source,
  dimension: Dimension,
  category: z.string().optional(),
});
export type Fact = z.infer<typeof Fact>;

// --- Office held by a candidate ---

export const OfficeHeld = z.object({
  role: z.string(),
  location: z.string(),
  startYear: z.number(),
  endYear: z.number().optional(),
  party: z.string(),
  elected: z.boolean(),
  source: Source,
});
export type OfficeHeld = z.infer<typeof OfficeHeld>;

// --- Voting summary ---

export const VotingSummary = z.object({
  legislature: z.string(),
  totalVotes: z.number(),
  present: z.number(),
  absent: z.number(),
  abstained: z.number(),
  source: Source,
});
export type VotingSummary = z.infer<typeof VotingSummary>;

// --- Legislative proposal ---

export const Proposal = z.object({
  id: z.string(),
  type: z.string(),
  number: z.number(),
  year: z.number(),
  summary: z.string(),
  status: z.string(),
  theme: z.string().optional(),
  url: z.string().url().optional(),
  source: Source,
});
export type Proposal = z.infer<typeof Proposal>;

// --- Campaign finance ---

export const CampaignFinance = z.object({
  electionYear: z.number(),
  totalReceived: z.number(),
  totalSpent: z.number(),
  topDonors: z.array(z.object({
    name: z.string(),
    amount: z.number(),
    type: z.string(),
  })),
  source: Source,
});
export type CampaignFinance = z.infer<typeof CampaignFinance>;

// --- Asset declaration ---

export const AssetDeclaration = z.object({
  electionYear: z.number(),
  totalDeclared: z.number(),
  items: z.array(z.object({
    description: z.string(),
    value: z.number(),
  })),
  source: Source,
});
export type AssetDeclaration = z.infer<typeof AssetDeclaration>;

// --- Full candidate profile ---

export const CandidateProfile = z.object({
  slug: z.string(),
  name: z.string(),
  shortName: z.string(),
  photoUrl: z.string().url().optional(),
  currentParty: z.string(),
  state: z.string(),
  birthDate: z.string().optional(),
  education: z.string().optional(),
  occupation: z.string().optional(),

  // Dimension 1: Track record
  officesHeld: z.array(OfficeHeld),
  votingSummaries: z.array(VotingSummary),
  proposals: z.array(Proposal),

  // Dimension 2: Policy positions
  governmentPlanUrl: z.string().url().optional(),
  legislativeThemes: z.array(z.string()),

  // Dimension 3: Integrity
  assetDeclarations: z.array(AssetDeclaration),
  campaignFinances: z.array(CampaignFinance),

  // Dimension 4: Commitments
  partyHistory: z.array(z.object({
    party: z.string(),
    startYear: z.number(),
    endYear: z.number().optional(),
  })),

  // All facts (denormalized for easy rendering)
  facts: z.array(Fact),

  // Metadata
  lastUpdated: z.string().datetime(),
  sources: z.array(z.string()),
});
export type CandidateProfile = z.infer<typeof CandidateProfile>;

// --- Pipeline metadata ---

export const PipelineMetadata = z.object({
  lastRun: z.string().datetime(),
  sources: z.array(z.object({
    name: z.string(),
    status: z.enum(["success", "partial", "error"]),
    recordCount: z.number(),
    lastFetched: z.string().datetime(),
    error: z.string().optional(),
  })),
  candidateCount: z.number(),
});
export type PipelineMetadata = z.infer<typeof PipelineMetadata>;
