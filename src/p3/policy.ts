import type { ExecutorResult, HuntScenario } from "./contracts";

const RISK_ORDER: Record<HuntScenario["risk"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function selectTopScenarios(
  scenarios: HuntScenario[],
  maxScenarios: number,
): HuntScenario[] {
  return [...scenarios].sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk]).slice(0, maxScenarios);
}

export function ensureExecutableScenario(scenario: HuntScenario): HuntScenario {
  if (scenario.mode === "mutating" && scenario.guardrails.length === 0) {
    throw new Error(`Mutating scenario ${scenario.id} is missing guardrails`);
  }
  return scenario;
}

export function shouldCreateInvestigation(result: ExecutorResult): boolean {
  return result.outcome === "failed" && result.evidence.length > 0;
}

export async function runWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function consume(): Promise<void> {
    while (cursor < items.length) {
      const current = cursor++;
      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => consume()),
  );

  return results;
}
