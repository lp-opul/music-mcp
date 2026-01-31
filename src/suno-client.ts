// Suno API client for AI music generation (via sunoapi.org)

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

export class SunoClient {
  private config: SunoConfig;

  constructor(config: SunoConfig) {
    this.config = config;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    timeoutMs: number = 60000, // 60 second timeout per request (increased)
    retries: number = 5 // More retries for Claude Desktop environment
  ): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`,
            ...options.headers,
          },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Suno API error: ${response.status} - ${error}`);
        }

        return response.json();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Don't retry on abort timeout for the last attempt
        if (attempt < retries) {
          console.error(`[Suno] Request attempt ${attempt}/${retries} failed: ${lastError.message}. Retrying in ${2 * attempt}s...`);
          // Wait before retry (exponential backoff, longer delays)
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        }
      }
    }

    throw new Error(`Suno request to ${endpoint} failed after ${retries} attempts: ${lastError?.message}`);
  }

  async generateMusic(params: GenerateMusicRequest): Promise<GenerationTask> {
    const result = await this.request<any>('/api/v1/generate', {
      method: 'POST',
      body: JSON.stringify({
        customMode: false,
        instrumental: params.instrumental ?? false,
        prompt: params.prompt,
        model: 'V4_5ALL',
        callBackUrl: 'https://example.com/callback', // Required by API, we use polling instead
      }),
    });

    if (result.code !== 200) {
      throw new Error(`Suno API error: ${result.msg || 'Unknown error'}`);
    }

    return {
      taskId: result.data?.taskId,
      status: 'pending',
    };
  }

  async getGenerationDetails(taskId: string): Promise<GenerationDetails> {
    const result = await this.request<any>(
      `/api/v1/generate/record-info?taskId=${taskId}`
    );

    if (result.code !== 200) {
      throw new Error(`Suno API error: ${result.msg || 'Unknown error'}`);
    }

    // Parse tracks from sunoData in response
    const sunoData = result.data?.response?.sunoData || [];
    const tracks: SunoTrack[] = sunoData.map((track: any) => ({
      id: track.id,
      title: track.title,
      audioUrl: track.audioUrl,
      streamAudioUrl: track.streamAudioUrl,
      imageUrl: track.imageUrl,
      duration: track.duration,
      tags: track.tags,
    }));

    return {
      taskId,
      status: result.data?.status || 'PENDING',
      tracks: tracks.length > 0 ? tracks : undefined,
      error: result.data?.errorMessage,
    };
  }

  async waitForCompletion(
    taskId: string,
    maxWaitMs: number = 300000, // 5 minutes (increased for slower generations)
    pollIntervalMs: number = 8000 // 8 seconds between polls (reduced load)
  ): Promise<GenerationDetails> {
    const startTime = Date.now();
    let pollCount = 0;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 10; // Higher tolerance for Claude Desktop

    while (Date.now() - startTime < maxWaitMs) {
      pollCount++;
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.error(`[Suno] Polling status (${pollCount}, ${elapsed}s elapsed)...`);
      
      try {
        const details = await this.getGenerationDetails(taskId);
        consecutiveErrors = 0; // Reset on success
        console.error(`[Suno] Status: ${details.status}`);

        // SUCCESS means all tracks are ready
        if (details.status === 'SUCCESS') {
          return details;
        }

        // Check for failure statuses
        if (
          details.status === 'CREATE_TASK_FAILED' ||
          details.status === 'GENERATE_AUDIO_FAILED' ||
          details.status === 'CALLBACK_EXCEPTION' ||
          details.status === 'SENSITIVE_WORD_ERROR'
        ) {
          throw new Error(`Music generation failed: ${details.error || details.status}`);
        }

        // PENDING, TEXT_SUCCESS, FIRST_SUCCESS are in-progress statuses
      } catch (pollError) {
        consecutiveErrors++;
        console.error(`[Suno] Poll error (${consecutiveErrors}/${maxConsecutiveErrors}): ${pollError instanceof Error ? pollError.message : pollError}`);
        
        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw new Error(`Too many consecutive polling errors: ${pollError instanceof Error ? pollError.message : pollError}`);
        }
        // Continue polling despite error
      }

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Music generation timed out after ${maxWaitMs / 1000}s`);
  }
}

// Factory function to create client from environment
export function createSunoClient(): SunoClient | null {
  const apiKey = process.env.SUNO_API_KEY;

  if (!apiKey) {
    return null;
  }

  return new SunoClient({
    apiKey,
    baseUrl: process.env.SUNO_BASE_URL || 'https://api.sunoapi.org',
  });
}
