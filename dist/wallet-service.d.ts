/**
 * Create a wallet for an artist
 * Returns existing wallet if already created
 */
export declare function createArtistWallet(artistName: string): Promise<string | null>;
/**
 * Get wallet address for an artist
 */
export declare function getArtistWallet(artistName: string): string | null;
/**
 * List all artist wallets
 */
export declare function listArtistWallets(): Record<string, string>;
/**
 * Get wallet balance (placeholder - implement with actual balance check)
 */
export declare function getWalletBalance(address: string): Promise<string>;
/**
 * Check if CDP is configured
 */
export declare function isCdpConfigured(): boolean;
