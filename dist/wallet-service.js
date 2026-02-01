// Simple Wallet Service - stores artist wallet addresses
import fs from "fs";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WALLET_FILE = join(__dirname, '..', 'artist-wallets.json');
// Load existing wallets from file
function loadWallets() {
    try {
        if (fs.existsSync(WALLET_FILE)) {
            const data = JSON.parse(fs.readFileSync(WALLET_FILE, 'utf-8'));
            // Handle legacy format (string addresses) and new format (WalletData objects)
            const normalized = {};
            for (const [key, value] of Object.entries(data)) {
                if (typeof value === 'string') {
                    normalized[key] = { address: value, setAt: 'legacy' };
                }
                else {
                    normalized[key] = value;
                }
            }
            return normalized;
        }
    }
    catch (error) {
        console.error('[Wallet] Failed to load wallets:', error);
    }
    return {};
}
// Save wallets to file
function saveWallets(wallets) {
    try {
        fs.writeFileSync(WALLET_FILE, JSON.stringify(wallets, null, 2));
        console.error('[Wallet] Wallets saved');
    }
    catch (error) {
        console.error('[Wallet] Failed to save wallets:', error);
    }
}
/**
 * Validate Ethereum address format
 */
export function isValidEthAddress(address) {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
}
/**
 * Get wallet address for an artist (read-only)
 */
export function getArtistWallet(artistName) {
    const wallets = loadWallets();
    const key = artistName.toLowerCase().trim();
    return wallets[key]?.address || null;
}
/**
 * Set wallet address for an artist
 */
export function setArtistWallet(artistName, walletAddress) {
    // Validate address format
    if (!isValidEthAddress(walletAddress)) {
        return {
            success: false,
            error: 'Invalid Ethereum address. Must start with 0x and be 42 characters.'
        };
    }
    const wallets = loadWallets();
    const key = artistName.toLowerCase().trim();
    wallets[key] = {
        address: walletAddress,
        setAt: new Date().toISOString(),
    };
    saveWallets(wallets);
    console.error(`[Wallet] Set wallet for "${artistName}": ${walletAddress}`);
    return { success: true };
}
/**
 * List all artist wallets
 */
export function listArtistWallets() {
    const wallets = loadWallets();
    const result = {};
    for (const [key, data] of Object.entries(wallets)) {
        result[key] = data.address;
    }
    return result;
}
/**
 * Get wallet balance (placeholder)
 */
export async function getWalletBalance(address) {
    // Placeholder - could integrate with ethers.js or viem
    return '0.00 ETH';
}
