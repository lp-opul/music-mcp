// Privy Wallet Service for artist royalty wallets

import { PrivyClient } from "@privy-io/server-auth";
import fs from "fs";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WALLET_FILE = join(__dirname, '..', 'artist-wallets.json');

let privyClient: PrivyClient | null = null;

// Initialize Privy client lazily
function getPrivyClient(): PrivyClient | null {
  if (privyClient) return privyClient;
  
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  
  if (!appId || !appSecret) {
    console.error('[Wallet] Privy credentials not configured (PRIVY_APP_ID, PRIVY_APP_SECRET)');
    return null;
  }
  
  try {
    privyClient = new PrivyClient(appId, appSecret);
    console.error('[Wallet] Privy client initialized');
    return privyClient;
  } catch (error) {
    console.error('[Wallet] Failed to initialize Privy client:', error);
    return null;
  }
}

// Wallet data structure
interface WalletData {
  address: string;
  privyUserId?: string;
  createdAt: string;
}

// Load existing wallets from file
function loadWallets(): Record<string, WalletData> {
  try {
    if (fs.existsSync(WALLET_FILE)) {
      const data = JSON.parse(fs.readFileSync(WALLET_FILE, 'utf-8'));
      // Handle legacy format (string addresses) and new format (WalletData objects)
      const normalized: Record<string, WalletData> = {};
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string') {
          normalized[key] = { address: value, createdAt: 'legacy' };
        } else {
          normalized[key] = value as WalletData;
        }
      }
      return normalized;
    }
  } catch (error) {
    console.error('[Wallet] Failed to load wallets:', error);
  }
  return {};
}

// Save wallets to file
function saveWallets(wallets: Record<string, WalletData>) {
  try {
    fs.writeFileSync(WALLET_FILE, JSON.stringify(wallets, null, 2));
    console.error('[Wallet] Wallets saved');
  } catch (error) {
    console.error('[Wallet] Failed to save wallets:', error);
  }
}

/**
 * Get or create a wallet for an artist
 * Returns existing wallet if already created, otherwise creates new one via Privy
 */
export async function getOrCreateArtistWallet(artistName: string): Promise<string | null> {
  const wallets = loadWallets();
  const key = artistName.toLowerCase().trim();
  
  // Check if already exists
  if (wallets[key]) {
    console.error(`[Wallet] Using existing wallet for "${artistName}": ${wallets[key].address}`);
    return wallets[key].address;
  }
  
  // Initialize Privy client
  const privy = getPrivyClient();
  if (!privy) {
    console.error('[Wallet] Privy not configured - skipping wallet creation');
    return null;
  }
  
  try {
    console.error(`[Wallet] Creating new Privy wallet for "${artistName}"...`);
    
    // Create an Ethereum wallet using Privy's wallet API
    const wallet = await privy.walletApi.create({
      chainType: 'ethereum',
    });
    
    // Store mapping
    wallets[key] = {
      address: wallet.address,
      privyUserId: wallet.id,
      createdAt: new Date().toISOString(),
    };
    saveWallets(wallets);
    
    console.error(`[Wallet] Created wallet for "${artistName}": ${wallet.address}`);
    return wallet.address;
  } catch (error) {
    console.error('[Wallet] Failed to create wallet:', error);
    return null;
  }
}

/**
 * Legacy function name - calls getOrCreateArtistWallet
 */
export async function createArtistWallet(artistName: string): Promise<string | null> {
  return getOrCreateArtistWallet(artistName);
}

/**
 * Get wallet address for an artist (without creating)
 */
export function getArtistWallet(artistName: string): string | null {
  const wallets = loadWallets();
  const key = artistName.toLowerCase().trim();
  return wallets[key]?.address || null;
}

/**
 * List all artist wallets
 */
export function listArtistWallets(): Record<string, string> {
  const wallets = loadWallets();
  const result: Record<string, string> = {};
  for (const [key, data] of Object.entries(wallets)) {
    result[key] = data.address;
  }
  return result;
}

/**
 * Get wallet balance (placeholder - implement with actual balance check)
 */
export async function getWalletBalance(address: string): Promise<string> {
  // For now return placeholder
  // Could integrate with ethers.js or viem to check actual balance
  return '0.00 USDC';
}

/**
 * Check if Privy is configured
 */
export function isWalletServiceConfigured(): boolean {
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  console.error(`[Wallet] Config check - PRIVY_APP_ID: ${appId ? appId.slice(0, 8) + '...' : 'undefined'}`);
  console.error(`[Wallet] Config check - PRIVY_APP_SECRET: ${appSecret ? 'set (' + appSecret.length + ' chars)' : 'undefined'}`);
  return !!(appId && appSecret);
}

// Legacy export for backwards compatibility
export const isCdpConfigured = isWalletServiceConfigured;
