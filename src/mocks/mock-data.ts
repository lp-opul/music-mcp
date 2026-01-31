// Mock data and responses for development without API credentials

import type {
  UploadTrackResponse,
  SubmitReleaseResponse,
  Release,
  EarningsResponse,
  StreamsResponse,
  SetSplitsResponse,
  DSP,
  ReleaseStatus,
} from '../types.js';

// Generate a random ID
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Mock uploaded tracks storage (in-memory for development)
export const mockTracks = new Map<string, {
  trackId: string;
  title: string;
  artist: string;
  status: 'uploaded' | 'processing' | 'ready' | 'error';
  uploadedAt: string;
}>();

// Mock releases storage
export const mockReleases = new Map<string, Release>();

export function createMockUploadResponse(title: string, artist: string): UploadTrackResponse {
  const trackId = generateId('track');
  const uploadedAt = new Date().toISOString();
  
  // Store in mock storage
  mockTracks.set(trackId, {
    trackId,
    title,
    artist,
    status: 'ready',
    uploadedAt,
  });

  return {
    trackId,
    status: 'ready',
    message: `Track "${title}" by ${artist} uploaded successfully. Ready for release submission.`,
    uploadedAt,
  };
}

export function createMockSubmitReleaseResponse(
  title: string,
  artist: string,
  trackIds: string[],
  dsps: DSP[],
  releaseDate: string
): SubmitReleaseResponse {
  const releaseId = generateId('release');
  const createdAt = new Date().toISOString();

  const dspSubmissions = dsps.map(dsp => ({
    dsp,
    status: 'pending' as const,
    submittedAt: createdAt,
  }));

  // Store in mock storage
  const release: Release = {
    releaseId,
    title,
    artist,
    trackIds,
    releaseDate,
    status: 'pending_review',
    dsps: dspSubmissions,
  };
  mockReleases.set(releaseId, release);

  return {
    releaseId,
    status: 'pending_review',
    message: `Release "${title}" submitted for review. Will be distributed to ${dsps.length} platforms after approval.`,
    dsps: dspSubmissions,
    createdAt,
  };
}

export function getMockReleaseStatus(releaseId: string): Release | null {
  // Check mock storage first
  if (mockReleases.has(releaseId)) {
    return mockReleases.get(releaseId)!;
  }

  // Return a demo release for unknown IDs
  return {
    releaseId,
    title: 'Demo Track',
    artist: 'Demo Artist',
    trackIds: ['track_demo_001'],
    releaseDate: '2024-03-15',
    status: 'live',
    dsps: [
      {
        dsp: 'spotify',
        status: 'live',
        submittedAt: '2024-03-01T10:00:00Z',
        liveAt: '2024-03-15T00:00:00Z',
        url: 'https://open.spotify.com/track/demo',
      },
      {
        dsp: 'apple_music',
        status: 'live',
        submittedAt: '2024-03-01T10:00:00Z',
        liveAt: '2024-03-15T00:00:00Z',
        url: 'https://music.apple.com/album/demo',
      },
    ],
  };
}

export function getMockEarnings(
  releaseId?: string,
  trackId?: string,
  startDate?: string,
  endDate?: string,
  dsp?: DSP
): EarningsResponse {
  // Generate realistic-looking mock earnings data
  const breakdown = [
    {
      releaseId: releaseId || 'release_demo_001',
      trackId: trackId || 'track_demo_001',
      dsp: 'spotify' as DSP,
      earnings: 1247.83,
      streams: 312456,
      period: '2024-02',
    },
    {
      releaseId: releaseId || 'release_demo_001',
      trackId: trackId || 'track_demo_001',
      dsp: 'apple_music' as DSP,
      earnings: 892.45,
      streams: 178490,
      period: '2024-02',
    },
    {
      releaseId: releaseId || 'release_demo_001',
      trackId: trackId || 'track_demo_001',
      dsp: 'amazon_music' as DSP,
      earnings: 234.12,
      streams: 58530,
      period: '2024-02',
    },
  ];

  // Filter by DSP if specified
  const filteredBreakdown = dsp 
    ? breakdown.filter(b => b.dsp === dsp)
    : breakdown;

  const totalEarnings = filteredBreakdown.reduce((sum, b) => sum + b.earnings, 0);

  return {
    totalEarnings: Math.round(totalEarnings * 100) / 100,
    currency: 'USD',
    breakdown: filteredBreakdown,
  };
}

export function getMockStreams(
  releaseId?: string,
  trackId?: string,
  startDate?: string,
  endDate?: string,
  dsp?: DSP
): StreamsResponse {
  const breakdown = [
    {
      releaseId: releaseId || 'release_demo_001',
      trackId: trackId || 'track_demo_001',
      dsp: 'spotify' as DSP,
      streams: 312456,
      period: '2024-02',
    },
    {
      releaseId: releaseId || 'release_demo_001',
      trackId: trackId || 'track_demo_001',
      dsp: 'apple_music' as DSP,
      streams: 178490,
      period: '2024-02',
    },
    {
      releaseId: releaseId || 'release_demo_001',
      trackId: trackId || 'track_demo_001',
      dsp: 'youtube_music' as DSP,
      streams: 245123,
      period: '2024-02',
    },
    {
      releaseId: releaseId || 'release_demo_001',
      trackId: trackId || 'track_demo_001',
      dsp: 'tiktok' as DSP,
      streams: 892341,
      period: '2024-02',
    },
  ];

  const filteredBreakdown = dsp
    ? breakdown.filter(b => b.dsp === dsp)
    : breakdown;

  const totalStreams = filteredBreakdown.reduce((sum, b) => sum + b.streams, 0);

  return {
    totalStreams,
    breakdown: filteredBreakdown,
  };
}

export function setMockSplits(
  releaseId: string,
  splits: Array<{ collaboratorEmail: string; collaboratorName: string; percentage: number; role: string }>
): SetSplitsResponse {
  // Validate splits total 100%
  const totalPercentage = splits.reduce((sum, s) => sum + s.percentage, 0);
  
  if (Math.abs(totalPercentage - 100) > 0.01) {
    return {
      releaseId,
      splits,
      status: 'pending_approval',
      message: `Warning: Split percentages total ${totalPercentage}%, not 100%. Please adjust.`,
    };
  }

  return {
    releaseId,
    splits,
    status: 'active',
    message: `Revenue splits configured successfully for release ${releaseId}. ${splits.length} collaborators will receive payouts.`,
  };
}
