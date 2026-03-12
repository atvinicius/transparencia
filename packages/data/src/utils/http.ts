export interface FetchOptions {
  headers?: Record<string, string>;
  params?: Record<string, string | number>;
  retries?: number;
  retryDelay?: number;
}

function buildUrl(base: string, params?: Record<string, string | number>): string {
  if (!params || Object.keys(params).length === 0) return base;
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchJson<T = unknown>(
  url: string,
  options: FetchOptions = {},
): Promise<T> {
  const { headers = {}, params, retries = 3, retryDelay = 1000 } = options;
  const fullUrl = buildUrl(url, params);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(fullUrl, {
        headers: {
          Accept: "application/json",
          ...headers,
        },
      });

      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : retryDelay * attempt;
        console.warn(`[HTTP] Rate limited on ${fullUrl}, waiting ${waitMs}ms...`);
        await sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText} for ${fullUrl}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (attempt === retries) throw error;
      console.warn(
        `[HTTP] Attempt ${attempt}/${retries} failed for ${fullUrl}: ${error}. Retrying in ${retryDelay * attempt}ms...`,
      );
      await sleep(retryDelay * attempt);
    }
  }

  throw new Error(`Unreachable: all ${retries} attempts failed for ${fullUrl}`);
}

export async function fetchAllPages<T>(
  baseUrl: string,
  options: FetchOptions & {
    pageParam?: string;
    itemsPerPage?: number;
    extractItems: (response: unknown) => T[];
    extractTotal?: (response: unknown) => number;
  },
): Promise<T[]> {
  const {
    pageParam = "pagina",
    itemsPerPage = 100,
    extractItems,
    extractTotal,
    ...fetchOpts
  } = options;

  const allItems: T[] = [];
  let page = 1;
  let totalExpected: number | undefined;

  while (true) {
    const params = {
      ...fetchOpts.params,
      [pageParam]: page,
      itens: itemsPerPage,
    };

    const response = await fetchJson(baseUrl, { ...fetchOpts, params });
    const items = extractItems(response);

    if (totalExpected === undefined && extractTotal) {
      totalExpected = extractTotal(response);
    }

    allItems.push(...items);

    if (items.length < itemsPerPage) break;
    if (totalExpected !== undefined && allItems.length >= totalExpected) break;

    page++;
  }

  return allItems;
}
