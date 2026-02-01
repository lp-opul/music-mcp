/**
 * Validate Ethereum address format
 */
export declare function isValidEthAddress(address: string): boolean;
/**
 * Get wallet address for an artist (read-only)
 */
export declare function getArtistWallet(artistName: string): string | null;
/**
 * Set wallet address for an artist
 */
export declare function setArtistWallet(artistName: string, walletAddress: string): {
    success: boolean;
    error?: string;
};
/**
 * List all artist wallets
 */
export declare function listArtistWallets(): Record<string, string>;
/**
 * Get wallet balance (placeholder)
 */
export declare function getWalletBalance(address: string): Promise<string>;
