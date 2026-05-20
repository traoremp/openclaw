export interface EdgarFiling {
  form: string;
  filedAt: string;
  url: string;
  description: string;
  excerpt: string;
}

const EDGAR_BASE = "https://efts.sec.gov/LATEST/search-index";
const SUBMISSIONS_BASE = "https://data.sec.gov/submissions";

async function edgarHeaders(): Promise<Record<string, string>> {
  return {
    "User-Agent": "OpenClaw stock-trader plugin traore.moussap@gmail.com",
    Accept: "application/json",
  };
}

// Map ticker to CIK via SEC EDGAR company search
async function tickerToCik(symbol: string): Promise<string | null> {
  const res = await fetch(
    `https://efts.sec.gov/LATEST/search-index?q=%22${symbol}%22&dateRange=custom&startdt=2020-01-01&forms=10-K`,
    {
      headers: await edgarHeaders(),
    },
  );
  if (!res.ok) return null;

  // Use the company tickers JSON maintained by SEC
  const tickerRes = await fetch("https://www.sec.gov/files/company_tickers.json", {
    headers: await edgarHeaders(),
  });
  if (!tickerRes.ok) return null;
  const tickers = (await tickerRes.json()) as Record<string, { cik_str: number; ticker: string }>;
  const entry = Object.values(tickers).find((e) => e.ticker.toUpperCase() === symbol.toUpperCase());
  return entry ? String(entry.cik_str).padStart(10, "0") : null;
}

export async function fetchSecFiling(
  symbol: string,
  formType = "10-K",
): Promise<EdgarFiling | null> {
  const cik = await tickerToCik(symbol);
  if (!cik) return null;

  const res = await fetch(`${SUBMISSIONS_BASE}/CIK${cik}.json`, { headers: await edgarHeaders() });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    filings?: {
      recent?: {
        form: string[];
        filingDate: string[];
        accessionNumber: string[];
        primaryDocument: string[];
        primaryDocDescription: string[];
      };
    };
  };

  const recent = data.filings?.recent;
  if (!recent) return null;

  const idx = recent.form.findIndex((f) => f === formType);
  if (idx === -1) return null;

  const accession = recent.accessionNumber[idx]!.replace(/-/g, "");
  const primaryDoc = recent.primaryDocument[idx]!;
  const url = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${accession}/${primaryDoc}`;

  // Fetch a short excerpt from the document
  let excerpt = "";
  try {
    const docRes = await fetch(url, { headers: await edgarHeaders() });
    if (docRes.ok) {
      const text = await docRes.text();
      // Strip HTML tags and grab first 500 chars of meaningful content
      const plain = text
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      excerpt = plain.slice(0, 500);
    }
  } catch {
    // excerpt stays empty
  }

  return {
    form: formType,
    filedAt: recent.filingDate[idx]!,
    url,
    description: recent.primaryDocDescription[idx] ?? formType,
    excerpt,
  };
}
