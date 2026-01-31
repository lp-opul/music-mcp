export interface SunoConfig {
    apiKey: string;
    baseUrl: string;
}
export interface GenerateMusicRequest {
    prompt: string;
    style?: string;
    instrumental?: boolean;
}
export interface GenerationTask {
    taskId: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
}
export interface SunoTrack {
    id: string;
    title: string;
    audioUrl: string;
    streamAudioUrl?: string;
    imageUrl?: string;
    duration?: number;
    tags?: string;
}
export interface GenerationDetails {
    taskId: string;
    status: string;
    tracks?: SunoTrack[];
    error?: string;
}
export declare class SunoClient {
    private config;
    constructor(config: SunoConfig);
    private request;
    generateMusic(params: GenerateMusicRequest): Promise<GenerationTask>;
    getGenerationDetails(taskId: string): Promise<GenerationDetails>;
    waitForCompletion(taskId: string, maxWaitMs?: number, // 5 minutes (increased for slower generations)
    pollIntervalMs?: number): Promise<GenerationDetails>;
}
export declare function createSunoClient(): SunoClient | null;
