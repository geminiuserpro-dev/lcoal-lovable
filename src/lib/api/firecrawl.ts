type FirecrawlResponse<T = any> = {
  success: boolean;
  error?: string;
  data?: T;
};

type ScrapeOptions = {
  formats?: ('markdown' | 'html' | 'rawHtml' | 'links' | 'screenshot' | 'branding' | 'summary')[];
  onlyMainContent?: boolean;
  waitFor?: number;
  location?: { country?: string; languages?: string[] };
};

type SearchOptions = {
  limit?: number;
  lang?: string;
  country?: string;
  tbs?: string;
  scrapeOptions?: { formats?: ('markdown' | 'html')[] };
};

type MapOptions = {
  search?: string;
  limit?: number;
  includeSubdomains?: boolean;
};

type CrawlOptions = {
  limit?: number;
  maxDepth?: number;
  includePaths?: string[];
  excludePaths?: string[];
};

export const firecrawlApi = {
  async scrape(url: string, options?: ScrapeOptions): Promise<FirecrawlResponse> {
    const resp = await fetch('/api/firecrawl/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, ...options }),
    });
    if (!resp.ok) return { success: false, error: await resp.text() };
    return resp.json();
  },

  async search(query: string, options?: SearchOptions): Promise<FirecrawlResponse> {
    const resp = await fetch('/api/firecrawl/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, ...options }),
    });
    if (!resp.ok) return { success: false, error: await resp.text() };
    return resp.json();
  },

  async map(url: string, options?: MapOptions): Promise<FirecrawlResponse> {
    const resp = await fetch('/api/firecrawl/map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, ...options }),
    });
    if (!resp.ok) return { success: false, error: await resp.text() };
    return resp.json();
  },

  async crawl(url: string, options?: CrawlOptions): Promise<FirecrawlResponse> {
    const resp = await fetch('/api/firecrawl/crawl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, ...options }),
    });
    if (!resp.ok) return { success: false, error: await resp.text() };
    return resp.json();
  },
};
