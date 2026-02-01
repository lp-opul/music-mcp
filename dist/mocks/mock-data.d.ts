import type { UploadTrackResponse, SubmitReleaseResponse, Release, EarningsResponse, StreamsResponse, SetSplitsResponse, DSP } from '../types.js';
export declare const mockTracks: Map<string, {
    trackId: string;
    title: string;
    artist: string;
    status: "uploaded" | "processing" | "ready" | "error";
    uploadedAt: string;
}>;
export declare const mockReleases: Map<string, Release>;
export declare function createMockUploadResponse(title: string, artist: string): UploadTrackResponse;
export declare function createMockSubmitReleaseResponse(title: string, artist: string, trackIds: string[], dsps: DSP[], releaseDate: string): SubmitReleaseResponse;
export declare function getMockReleaseStatus(releaseId: string): Release | null;
export declare function getMockEarnings(releaseId?: string, trackId?: string, startDate?: string, endDate?: string, dsp?: DSP): EarningsResponse;
export declare function getMockStreams(releaseId?: string, trackId?: string, startDate?: string, endDate?: string, dsp?: DSP): StreamsResponse;
export declare function setMockSplits(releaseId: string, splits: Array<{
    collaboratorEmail: string;
    collaboratorName: string;
    percentage: number;
    role: string;
}>): SetSplitsResponse;
