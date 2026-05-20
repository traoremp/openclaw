import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AlpacaCredentials {
  apiKey: string;
  secretKey: string;
  paper: boolean;
  googleSheetId: string;
}

export interface GoogleServiceAccount {
  client_email: string;
  private_key: string;
}

const credDir = join(homedir(), ".openclaw", "credentials");

let alpacaCache: AlpacaCredentials | undefined;
let googleCache: GoogleServiceAccount | undefined;

export async function getAlpacaCredentials(): Promise<AlpacaCredentials> {
  if (!alpacaCache) {
    const raw = await readFile(join(credDir, "alpaca.json"), "utf8");
    alpacaCache = JSON.parse(raw) as AlpacaCredentials;
  }
  return alpacaCache;
}

export async function getGoogleServiceAccount(): Promise<GoogleServiceAccount> {
  if (!googleCache) {
    const raw = await readFile(
      join(homedir(), ".openclaw", "googlechat-service-account.json"),
      "utf8",
    );
    googleCache = JSON.parse(raw) as GoogleServiceAccount;
  }
  return googleCache;
}
