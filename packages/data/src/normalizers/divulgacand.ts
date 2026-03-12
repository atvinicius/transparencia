import type { DivulgaCandFinanceData } from "../sources/divulgacand.js";
import type { CampaignFinance, Fact, Source } from "../schemas/index.js";

interface NormalizedFinanceResult {
  campaignFinances: CampaignFinance[];
  facts: Fact[];
}

/**
 * Format a monetary value in Brazilian Reais for display.
 */
function formatBRL(value: number): string {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Normalize one or more DivulgaCandFinanceData records into CampaignFinance
 * entries and Fact items for a CandidateProfile.
 *
 * Each DivulgaCandFinanceData represents a single election year, so the
 * output may contain multiple CampaignFinance entries (one per year) and
 * several facts summarizing campaign finance activity.
 */
export function normalizeDivulgaCandFinance(
  records: DivulgaCandFinanceData[],
): NormalizedFinanceResult {
  if (!records || records.length === 0) {
    return { campaignFinances: [], facts: [] };
  }

  const campaignFinances: CampaignFinance[] = [];
  const facts: Fact[] = [];

  for (const record of records) {
    const source: Source = record.source;
    const { candidateId, year, totalReceived, totalSpent, donations, expenses } = record;

    // --- Build top donors list (sorted by amount, top 10) ---
    const sortedDonors = [...donations]
      .sort((a, b) => b.amount - a.amount);

    const topDonors = sortedDonors.slice(0, 10).map((d) => ({
      name: d.name,
      amount: d.amount,
      type: d.type,
    }));

    campaignFinances.push({
      electionYear: year,
      totalReceived,
      totalSpent,
      topDonors,
      source,
    });

    // --- Generate facts for the "integridade" dimension ---

    // Fact: Total received
    if (totalReceived > 0) {
      facts.push({
        id: `divulgacand-receita-total-${candidateId}-${year}`,
        label: `Total recebido em doações de campanha (${year})`,
        value: formatBRL(totalReceived),
        context: `Eleição de ${year}`,
        source,
        dimension: "integridade",
        category: "Financiamento de Campanha",
      });
    }

    // Fact: Total spent
    if (totalSpent > 0) {
      facts.push({
        id: `divulgacand-despesa-total-${candidateId}-${year}`,
        label: `Total gasto em campanha (${year})`,
        value: formatBRL(totalSpent),
        context: `Eleição de ${year}`,
        source,
        dimension: "integridade",
        category: "Financiamento de Campanha",
      });
    }

    // Fact: Number of donors
    if (donations.length > 0) {
      facts.push({
        id: `divulgacand-doadores-total-${candidateId}-${year}`,
        label: `Número de doadores de campanha (${year})`,
        value: donations.length,
        context: `Eleição de ${year}`,
        source,
        dimension: "integridade",
        category: "Financiamento de Campanha",
      });
    }

    // Fact: Top donor
    if (sortedDonors.length > 0) {
      const topDonor = sortedDonors[0];
      facts.push({
        id: `divulgacand-maior-doador-${candidateId}-${year}`,
        label: `Maior doador de campanha (${year})`,
        value: topDonor.name,
        context: `${formatBRL(topDonor.amount)} — ${topDonor.type}`,
        source,
        dimension: "integridade",
        category: "Financiamento de Campanha",
      });
    }

    // Fact: Balance (received vs spent)
    if (totalReceived > 0 && totalSpent > 0) {
      const balance = totalReceived - totalSpent;
      const balanceLabel = balance >= 0 ? "Saldo positivo" : "Saldo negativo";
      facts.push({
        id: `divulgacand-saldo-${candidateId}-${year}`,
        label: `${balanceLabel} de campanha (${year})`,
        value: formatBRL(Math.abs(balance)),
        context: `Receitas ${formatBRL(totalReceived)} - Despesas ${formatBRL(totalSpent)}`,
        source,
        dimension: "integridade",
        category: "Financiamento de Campanha",
      });
    }
  }

  return { campaignFinances, facts };
}
