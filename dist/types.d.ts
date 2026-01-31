export interface TrackMetadata {
    title: string;
    artist: string;
    album?: string;
    genre: string;
    isrc?: string;
    releaseDate?: string;
    explicit: boolean;
    language: string;
    contributors?: Contributor[];
}
export interface Contributor {
    name: string;
    role: 'primary_artist' | 'featured_artist' | 'producer' | 'writer' | 'composer' | 'mixer' | 'engineer';
}
export interface UploadTrackRequest {
    audioBase64: string;
    audioFormat: 'wav' | 'flac' | 'mp3';
    metadata: TrackMetadata;
}
export interface UploadTrackResponse {
    trackId: string;
    status: 'uploaded' | 'processing' | 'ready' | 'error';
    message: string;
    uploadedAt: string;
}
export interface Release {
    releaseId: string;
    title: string;
    artist: string;
    trackIds: string[];
    coverArtUrl?: string;
    releaseDate: string;
    status: ReleaseStatus;
    dsps: DSPSubmission[];
}
export type ReleaseStatus = 'draft' | 'pending_review' | 'approved' | 'distributing' | 'live' | 'taken_down' | 'rejected';
export interface DSPSubmission {
    dsp: DSP;
    status: 'pending' | 'submitted' | 'live' | 'rejected' | 'taken_down';
    submittedAt?: string;
    liveAt?: string;
    url?: string;
}
export type DSP = 'spotify' | 'apple_music' | 'amazon_music' | 'youtube_music' | 'deezer' | 'tidal' | 'pandora' | 'soundcloud' | 'tiktok' | 'instagram';
export interface SubmitReleaseRequest {
    title: string;
    artist: string;
    trackIds: string[];
    coverArtBase64?: string;
    releaseDate: string;
    dsps: DSP[];
    upc?: string;
    genre: string;
    subgenre?: string;
    recordLabel?: string;
    copyrightHolder: string;
    copyrightYear: number;
}
export interface SubmitReleaseResponse {
    releaseId: string;
    status: ReleaseStatus;
    message: string;
    dsps: DSPSubmission[];
    createdAt: string;
}
export interface GetReleaseStatusRequest {
    releaseId: string;
}
export interface GetReleaseStatusResponse {
    release: Release;
}
export interface EarningsQuery {
    releaseId?: string;
    trackId?: string;
    startDate?: string;
    endDate?: string;
    dsp?: DSP;
}
export interface EarningsResponse {
    totalEarnings: number;
    currency: string;
    breakdown: EarningsBreakdown[];
}
export interface EarningsBreakdown {
    releaseId: string;
    trackId: string;
    dsp: DSP;
    earnings: number;
    streams: number;
    period: string;
}
export interface StreamsQuery {
    releaseId?: string;
    trackId?: string;
    startDate?: string;
    endDate?: string;
    dsp?: DSP;
}
export interface StreamsResponse {
    totalStreams: number;
    breakdown: StreamsBreakdown[];
}
export interface StreamsBreakdown {
    releaseId: string;
    trackId: string;
    dsp: DSP;
    streams: number;
    period: string;
}
export interface Split {
    collaboratorEmail: string;
    collaboratorName: string;
    percentage: number;
    role: string;
}
export interface SetSplitsRequest {
    releaseId: string;
    splits: Split[];
}
export interface SetSplitsResponse {
    releaseId: string;
    splits: Split[];
    status: 'active' | 'pending_approval';
    message: string;
}
