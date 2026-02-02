import type { Split } from './types.js';
export interface DittoConfig {
    email: string;
    password: string;
    baseUrl: string;
    releasesUrl: string;
    salesUrl: string;
    trendsUrl: string;
    basicAuthUser?: string;
    basicAuthPass?: string;
}
export declare class DittoClient {
    private config;
    private auth;
    private basicAuthHeader;
    constructor(config: DittoConfig);
    private getBaseHeaders;
    private authenticate;
    private request;
    createArtist(name: string, genres?: string[]): Promise<any>;
    getArtists(): Promise<any>;
    getArtist(id: string): Promise<any>;
    createRelease(data: {
        title: string;
        artistId: string;
        artistName?: string;
        releaseDate: string;
        genreId?: string;
        labelId?: string;
        upc?: string;
        copyrightHolder?: string;
        copyrightYear?: number;
    }): Promise<any>;
    getReleases(): Promise<any>;
    getRelease(id: string): Promise<any>;
    updateRelease(id: string, data: any): Promise<any>;
    addArtistToRelease(releaseId: string, artistId: number): Promise<any>;
    deleteRelease(id: string): Promise<void>;
    createTrack(data: {
        title: string;
        releaseId: string;
        artistId: string;
        isrc?: string;
        explicit: boolean;
        languageCode: string;
        trackNumber?: number;
        audioFile?: string;
    }): Promise<any>;
    getTracks(): Promise<any>;
    getTrack(id: string): Promise<any>;
    updateTrack(id: string, data: any): Promise<any>;
    deleteTrack(id: string): Promise<void>;
    /**
     * Create a track with audio file
     * Downloads audio from URL and uploads to Ditto releases API
     * The track is created WITH the audio in a single request
     */
    createTrackWithAudio(releaseId: string, audioUrl: string, filename?: string): Promise<any>;
    /**
     * Create track with audio from a Buffer (for cached audio)
     */
    createTrackWithAudioBuffer(releaseId: string, audioBuffer: Buffer, filename: string): Promise<any>;
    /**
     * Upload artwork to a release
     * Downloads image from URL and uploads to Ditto releases API
     */
    uploadArtwork(releaseId: string, imageUrl: string): Promise<any>;
    /**
     * Upload artwork from a processed buffer (already resized/optimized)
     */
    uploadArtworkBuffer(releaseId: string, imageBuffer: Buffer): Promise<any>;
    /**
     * Generate AI artwork for a release
     * Uses Ditto's artgen service
     */
    generateArtwork(releaseId: string, prompt: string): Promise<any>;
    getStores(): Promise<any>;
    submitToStores(releaseId: string, storeIds: number[]): Promise<any>;
    removeFromStores(releaseId: string, storeIds: string[]): Promise<any>;
    /**
     * Finalize and submit a release for review
     * This changes the release status to "Submitted" (statusId: 8)
     */
    finalizeRelease(releaseId: string): Promise<any>;
    getReleaseStatuses(): Promise<any>;
    getGenres(): Promise<any>;
    setReleaseSplits(releaseId: string, splits: Split[]): Promise<any>;
    setTrackSplits(trackId: string, splits: Split[]): Promise<any>;
    getTrackSplits(trackId: string): Promise<any>;
    getMe(): Promise<any>;
    getAccountBalances(): Promise<any>;
    getProfile(): Promise<any>;
    getCollaborators(): Promise<any>;
    getCollaborator(id: string): Promise<any>;
    getEarnings(params?: {
        releaseId?: string;
        trackId?: string;
        startDate?: string;
        endDate?: string;
        storeId?: string;
    }): Promise<any>;
    getStreams(params?: {
        releaseId?: string;
        trackId?: string;
        startDate?: string;
        endDate?: string;
        storeId?: string;
    }): Promise<any>;
    getBalanceLedger(): Promise<any>;
}
export declare function createDittoClient(): DittoClient | null;
