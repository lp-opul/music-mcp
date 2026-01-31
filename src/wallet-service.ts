// CDP Wallet Service for artist royalty wallets

import { CdpClient } from "@coinbase/cdp-sdk";
import fs from "fs";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WALLET_FILE = join(__dirname, '..', 'artist-wallets.json');

let cdpClient: CdpClient | null = null;

// Initialize CDP client lazily
function getCdpClient(): CdpClient | null {
  if (cdpClient) return cdpClient;
  
  // CDP SDK reads from env vars automatically:
  // CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET
  if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET) {
    console.error('[Wallet] CDP credentials not configured');
    return null;
  }
  
  try {
    cdpClient = new CdpClient();
    console.error('[Wallet] CDP client initialized');
    return cdpClient;
  } catch (error) {
    console.error('[Wallet] Failed to initialize CDP client:', error);
    return null;
  }
}

// Load existing wallets from file
function loadWallets(): Record<string, string> {
  try {
    if (fs.existsSync(WALLET_FILE)) {
      return JSON.parse(fs.readFileSync(WALLET_FILE, 'utf-8'));
    }
  } catch (error) {
    console.error('[Wallet] Failed to load wallets:', error);
  }
  return {};
}

// Save wallets to file
function saveWallets(wallets: Record<string, string>) {
  try {
    fs.writeFileSync(WALLET_FILE, JSON.stringify(wallets, null, 2));
    console.error('[Wallet] Wallets saved');
  } catch (error) {
    console.error('[Wallet] Failed to save wallets:', error);
  }
}

/**
 * Create a wallet for an artist
 * Returns existing wallet if already created
 */
export async function createArtistWallet(artistName: string): Promise<string | null> {
  const wallets = loadWallets();
  const key = artistName.toLowerCase().trim();
  
  // Check if already exists
  if (wallets[key]) {
    console.error(`[Wallet] Using existing wallet for "${artistName}": ${wallets[key]}`);
    return wallets[key];
  }
  
  // Initialize CDP client
  const cdp = getCdpClient();
  if (!cdp) {
    console.error('[Wallet] CDP not configured - skipping wallet creation');
    return null;
  }
  
  try {
    // Create new wallet on Base
    console.error(`[Wallet] Creating new wallet for "${artistName}"...`);
    const account = await cdp.evm.createAccount();
    
    // Store mapping
    wallets[key] = account.address;
    saveWallets(wallets);
    
    console.error(`[Wallet] Created wallet for "${artistName}": ${account.address}`);
    return account.address;
  } catch (error) {
    console.error('[Wallet] Failed to create wallet:', error);
    return null;
  }
}

/**
 * Get wallet address for an artist
 */
export function getArtistWallet(artistName: string): string | null {
  const wallets = loadWallets();
  const key = artistName.toLowerCase().trim();
  return wallets[key] || null;
}

/**
 * List all artist wallets
 */
export function listArtistWallets(): Record<string, string> {
  return loadWallets();
}

/**
 * Get wallet balance (placeholder - implement with actual balance check)
 */
export async function getWalletBalance(address: string): Promise<string> {
  const cdp = getCdpClient();
  if (!cdp) {
    return 'CDP not configured';
  }
  
  try {
    // For now return placeholder - CDP SDK balance check would go here
    // const balance = await cdp.evm.getBalance(address);
    return '0.00 USDC';
  } catch (error) {
    console.error('[Wallet] Failed to get balance:', error);
    return 'Error fetching balance';
  }
}

/**
 * Check if CDP is configured
 */
export function isCdpConfigured(): boolean {
  return !!(process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET);
}
