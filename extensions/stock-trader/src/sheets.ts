import { createSign } from "node:crypto";
import { getAlpacaCredentials, getGoogleServiceAccount } from "./credentials.js";

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

let tokenCache: { token: string; expiresAt: number } | undefined;

function base64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf) : buf;
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;

  const sa = await getGoogleServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(signingInput);
  const sig = base64url(sign.sign(sa.private_key));
  const jwt = `${signingInput}.${sig}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Google token → ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return tokenCache.token;
}

export async function sheetsWrite(params: {
  tab: string;
  rows: (string | number)[][];
  mode: "append" | "clear_and_write";
}): Promise<{ updatedRows: number }> {
  const creds = await getAlpacaCredentials();
  const sheetId = creds.googleSheetId;
  const token = await getAccessToken();
  const authHeader = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const range = `${params.tab}!A1`;

  if (params.mode === "clear_and_write") {
    await fetch(`${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(range)}:clear`, {
      method: "POST",
      headers: authHeader,
    });
  }

  const res = await fetch(
    `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", headers: authHeader, body: JSON.stringify({ values: params.rows }) },
  );
  if (!res.ok) throw new Error(`Sheets append → ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { updates?: { updatedRows?: number } };
  return { updatedRows: data.updates?.updatedRows ?? params.rows.length };
}
