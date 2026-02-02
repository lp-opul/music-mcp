// Ditto API client with JWT authentication and Basic Auth support
export class DittoClient {
    config;
    auth = null;
    basicAuthHeader = null;
    constructor(config) {
        this.config = config;
        // Create Basic Auth header if credentials provided
        if (config.basicAuthUser && config.basicAuthPass) {
            const credentials = Buffer.from(`${config.basicAuthUser}:${config.basicAuthPass}`).toString('base64');
            this.basicAuthHeader = `Basic ${credentials}`;
        }
    }
    // Get headers with optional Basic Auth
    getBaseHeaders() {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };
        if (this.basicAuthHeader) {
            headers['Authorization'] = this.basicAuthHeader;
        }
        return headers;
    }
    // ============================================
    // Authentication
    // ============================================
    async authenticate() {
        // Return existing token if still valid (with 5 min buffer)
        if (this.auth && this.auth.expiresAt > Date.now() + 5 * 60 * 1000) {
            return this.auth.token;
        }
        // Try refresh token first
        if (this.auth?.refreshToken) {
            try {
                const response = await fetch(`${this.config.baseUrl}/api/token/refresh`, {
                    method: 'POST',
                    headers: this.getBaseHeaders(),
                    body: JSON.stringify({ refresh_token: this.auth.refreshToken }),
                });
                if (response.ok) {
                    const data = await response.json();
                    this.auth = {
                        token: data.token,
                        refreshToken: data.refresh_token || this.auth.refreshToken,
                        expiresAt: Date.now() + 3600 * 1000, // Assume 1 hour expiry
                    };
                    return this.auth.token;
                }
            }
            catch (e) {
                // Fall through to full login
            }
        }
        // Try /authentication_token endpoint (API access, no captcha)
        let response = await fetch(`${this.config.baseUrl}/authentication_token`, {
            method: 'POST',
            headers: this.getBaseHeaders(),
            body: JSON.stringify({
                email: this.config.email,
                password: this.config.password,
            }),
        });
        // If that fails, try /api/login as fallback
        if (!response.ok) {
            const firstError = await response.text();
            response = await fetch(`${this.config.baseUrl}/api/login`, {
                method: 'POST',
                headers: this.getBaseHeaders(),
                body: JSON.stringify({
                    email: this.config.email,
                    password: this.config.password,
                }),
            });
            if (!response.ok) {
                throw new Error(`Authentication failed - please check credentials`);
            }
        }
        if (!response.ok) {
            throw new Error(`Authentication failed - status ${response.status}`);
        }
        const data = await response.json();
        this.auth = {
            token: data.token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + 3600 * 1000,
        };
        return this.auth.token;
    }
    async request(url, options = {}, baseUrl) {
        const token = await this.authenticate();
        const fullUrl = `${baseUrl || this.config.baseUrl}${url}`;
        // Build headers for API requests
        // Basic Auth is for server access, Bearer is for API auth
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
            ...options.headers,
        };
        // Add Basic Auth as separate header if configured
        if (this.basicAuthHeader) {
            headers['X-Basic-Authorization'] = this.basicAuthHeader;
        }
        const response = await fetch(fullUrl, {
            ...options,
            headers,
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`API request failed: ${response.status} - ${error}`);
        }
        return response.json();
    }
    // ============================================
    // Artists
    // ============================================
    async createArtist(name, genres) {
        return this.request('/api/me/artists', {
            method: 'POST',
            body: JSON.stringify({
                name,
                genres: genres || [],
            }),
        });
    }
    async getArtists() {
        return this.request('/api/me/artists');
    }
    async getArtist(id) {
        return this.request(`/api/me/artists/${id}`);
    }
    // ============================================
    // Releases
    // ============================================
    async createRelease(data) {
        // Extract numeric ID from IRI or use as-is
        const artistIdMatch = data.artistId.match(/(\d+)$/);
        const numericArtistId = artistIdMatch ? parseInt(artistIdMatch[1], 10) : parseInt(data.artistId, 10);
        // Use artist name as default copyright holder
        const currentYear = new Date().getFullYear();
        const copyrightHolder = data.copyrightHolder || data.artistName || 'Independent Artist';
        const copyrightYear = data.copyrightYear || currentYear;
        const payload = {
            title: data.title,
            primaryArtist: `/api/me/artists/${numericArtistId}`, // IRI reference
            originalReleaseDate: data.releaseDate,
            genre: data.genreId,
            label: data.labelId,
            upc: data.upc,
            // Copyright fields (required for submission)
            cLine: copyrightHolder, // Copyright Holder
            cLineYear: copyrightYear, // Copyright Year
            pLine: copyrightHolder, // Phonographic Rights Holder (usually same)
            pLineYear: copyrightYear, // Production Year
        };
        return this.request('/api/me/releases/music', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    }
    async getReleases() {
        return this.request('/api/me/releases/music');
    }
    async getRelease(id) {
        return this.request(`/api/me/releases/music/${id}`);
    }
    async updateRelease(id, data) {
        return this.request(`/api/me/releases/music/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }
    async addArtistToRelease(releaseId, artistId) {
        const payload = {
            artists: [{ id: artistId, isPrimaryArtist: true }]
        };
        return this.request(`/api/me/releases/music/${releaseId}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
        });
    }
    async deleteRelease(id) {
        await this.request(`/api/me/releases/music/${id}`, {
            method: 'DELETE',
        });
    }
    // ============================================
    // Tracks
    // ============================================
    async createTrack(data) {
        return this.request('/api/me/release_tracks', {
            method: 'POST',
            body: JSON.stringify({
                title: data.title,
                release: data.releaseId,
                artist: data.artistId,
                isrc: data.isrc,
                explicit: data.explicit,
                language: data.languageCode,
                trackNumber: data.trackNumber || 1,
            }),
        });
    }
    async getTracks() {
        return this.request('/api/me/release_tracks');
    }
    async getTrack(id) {
        return this.request(`/api/me/release_tracks/${id}`);
    }
    async updateTrack(id, data) {
        return this.request(`/api/me/release_tracks/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }
    async deleteTrack(id) {
        await this.request(`/api/me/release_tracks/${id}`, {
            method: 'DELETE',
        });
    }
    /**
     * Create a track with audio file
     * Downloads audio from URL and uploads to Ditto releases API
     * The track is created WITH the audio in a single request
     */
    async createTrackWithAudio(releaseId, audioUrl, filename) {
        const token = await this.authenticate();
        // Step 1: Download the audio file from the URL
        let audioResponse = await fetch(audioUrl);
        // If audioUrl fails with 403, try streamUrl (remove .mp3 extension)
        if (audioResponse.status === 403 && audioUrl.endsWith('.mp3')) {
            const streamUrl = audioUrl.replace('.mp3', '');
            // Try alternate URL on 403
            audioResponse = await fetch(streamUrl);
        }
        if (!audioResponse.ok) {
            throw new Error(`Failed to download audio: ${audioResponse.status} ${audioResponse.statusText}`);
        }
        const audioBuffer = await audioResponse.arrayBuffer();
        const audioBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });
        // Step 2: Create FormData with the audio file
        const formData = new FormData();
        formData.append('file', audioBlob, filename || 'track.mp3');
        // Step 3: Upload to Ditto releases API - creates track with audio
        const uploadUrl = `${this.config.releasesUrl}/api/me/releases/${releaseId}/tracks`;
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
        };
        if (this.basicAuthHeader) {
            headers['X-Basic-Authorization'] = this.basicAuthHeader;
        }
        const uploadResponse = await fetch(uploadUrl, {
            method: 'POST',
            headers,
            body: formData,
        });
        if (!uploadResponse.ok) {
            const error = await uploadResponse.text();
            throw new Error(`Failed to create track with audio: ${uploadResponse.status} - ${error}`);
        }
        const result = await uploadResponse.json();
        return result;
    }
    /**
     * Create track with audio from a Buffer (for cached audio)
     */
    async createTrackWithAudioBuffer(releaseId, audioBuffer, filename) {
        const token = await this.authenticate();
        // Create FormData with the audio file
        const formData = new FormData();
        const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/mpeg' });
        formData.append('file', audioBlob, filename);
        // Upload to Ditto releases API
        const uploadUrl = `${this.config.releasesUrl}/api/me/releases/${releaseId}/tracks`;
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
        };
        if (this.basicAuthHeader) {
            headers['X-Basic-Authorization'] = this.basicAuthHeader;
        }
        const uploadResponse = await fetch(uploadUrl, {
            method: 'POST',
            headers,
            body: formData,
        });
        if (!uploadResponse.ok) {
            const error = await uploadResponse.text();
            throw new Error(`Failed to create track with audio: ${uploadResponse.status} - ${error}`);
        }
        const result = await uploadResponse.json();
        return result;
    }
    // ============================================
    // Artwork
    // ============================================
    /**
     * Upload artwork to a release
     * Downloads image from URL and uploads to Ditto releases API
     */
    async uploadArtwork(releaseId, imageUrl) {
        const token = await this.authenticate();
        // Step 1: Download the image file from the URL
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
            throw new Error(`Failed to download image: ${imageResponse.status} ${imageResponse.statusText}`);
        }
        const imageBuffer = await imageResponse.arrayBuffer();
        const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
        const imageBlob = new Blob([imageBuffer], { type: contentType });
        // Step 2: Create FormData with the image file
        const formData = new FormData();
        const extension = contentType.includes('png') ? 'png' : 'jpg';
        formData.append('file', imageBlob, `artwork.${extension}`);
        // Step 3: Upload to Ditto releases API
        const uploadUrl = `${this.config.releasesUrl}/api/me/releases/${releaseId}/artworks`;
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
        };
        if (this.basicAuthHeader) {
            headers['X-Basic-Authorization'] = this.basicAuthHeader;
        }
        const uploadResponse = await fetch(uploadUrl, {
            method: 'POST',
            headers,
            body: formData,
        });
        if (!uploadResponse.ok) {
            const error = await uploadResponse.text();
            throw new Error(`Failed to upload artwork: ${uploadResponse.status} - ${error}`);
        }
        const result = await uploadResponse.json();
        return result;
    }
    /**
     * Upload artwork from a processed buffer (already resized/optimized)
     */
    async uploadArtworkBuffer(releaseId, imageBuffer) {
        const token = await this.authenticate();
        // Create FormData with the image buffer (convert to Uint8Array for Blob compatibility)
        const imageBlob = new Blob([new Uint8Array(imageBuffer)], { type: 'image/jpeg' });
        const formData = new FormData();
        formData.append('file', imageBlob, 'artwork.jpg');
        // Upload to Ditto releases API
        const uploadUrl = `${this.config.releasesUrl}/api/me/releases/${releaseId}/artworks`;
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
        };
        if (this.basicAuthHeader) {
            headers['X-Basic-Authorization'] = this.basicAuthHeader;
        }
        const uploadResponse = await fetch(uploadUrl, {
            method: 'POST',
            headers,
            body: formData,
        });
        if (!uploadResponse.ok) {
            const error = await uploadResponse.text();
            throw new Error(`Failed to upload artwork: ${uploadResponse.status} - ${error}`);
        }
        const result = await uploadResponse.json();
        return result;
    }
    /**
     * Generate AI artwork for a release
     * Uses Ditto's artgen service
     */
    async generateArtwork(releaseId, prompt) {
        const token = await this.authenticate();
        const generateUrl = `${this.config.releasesUrl}/api/me/artgen/generate`;
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };
        if (this.basicAuthHeader) {
            headers['X-Basic-Authorization'] = this.basicAuthHeader;
        }
        const response = await fetch(generateUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                releaseId: parseInt(releaseId),
                prompt: prompt,
            }),
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Failed to generate artwork: ${response.status} - ${error}`);
        }
        const result = await response.json();
        return result;
    }
    // ============================================
    // Stores (DSP Distribution)
    // ============================================
    async getStores() {
        return this.request('/api/lookup/stores');
    }
    async submitToStores(releaseId, storeIds) {
        const requestBody = {
            storeIds: storeIds, // Integer array: [2, 63, 104]
        };
        return this.request(`/api/me/releases/${releaseId}/stores`, {
            method: 'POST',
            body: JSON.stringify(requestBody),
        });
    }
    async removeFromStores(releaseId, storeIds) {
        return this.request(`/api/me/releases/${releaseId}/stores/remove`, {
            method: 'POST',
            body: JSON.stringify({
                stores: storeIds,
            }),
        });
    }
    /**
     * Finalize and submit a release for review
     * This changes the release status to "Submitted" (statusId: 8)
     */
    async finalizeRelease(releaseId) {
        // Try the submit endpoint first
        try {
            const submitResult = await this.request(`/api/me/releases/${releaseId}/submit`, {
                method: 'POST',
                body: JSON.stringify({}),
            });
            return submitResult;
        }
        catch (e) {
            // Try status update as fallback
        }
        // Fallback: try to PATCH the status directly
        try {
            const patchResult = await this.request(`/api/me/releases/${releaseId}`, {
                method: 'PATCH',
                body: JSON.stringify({ statusId: 8 }), // 8 = Submitted
            });
            return patchResult;
        }
        catch (e) {
        }
        // Return current release state
        return this.getRelease(releaseId);
    }
    // ============================================
    // Release Status
    // ============================================
    async getReleaseStatuses() {
        return this.request('/api/lookup/release_statuses');
    }
    // ============================================
    // Genres
    // ============================================
    async getGenres() {
        return this.request('/api/lookup/genres');
    }
    // ============================================
    // Royalty Splits
    // ============================================
    async setReleaseSplits(releaseId, splits) {
        return this.request(`/api/me/release/${releaseId}/royalty-splits`, {
            method: 'PUT',
            body: JSON.stringify({
                splits: splits.map(s => ({
                    email: s.collaboratorEmail,
                    name: s.collaboratorName,
                    percentage: s.percentage,
                    role: s.role,
                })),
            }),
        });
    }
    async setTrackSplits(trackId, splits) {
        return this.request(`/api/me/release_tracks/${trackId}/royalty-splits`, {
            method: 'PUT',
            body: JSON.stringify({
                splits: splits.map(s => ({
                    email: s.collaboratorEmail,
                    name: s.collaboratorName,
                    percentage: s.percentage,
                    role: s.role,
                })),
            }),
        });
    }
    async getTrackSplits(trackId) {
        return this.request(`/api/me/release_tracks/${trackId}/royalty-splits`);
    }
    // ============================================
    // User / Account
    // ============================================
    async getMe() {
        return this.request('/api/me');
    }
    async getAccountBalances() {
        return this.request('/api/me/account_balances');
    }
    async getProfile() {
        return this.request('/api/me/profile');
    }
    // ============================================
    // Collaborators
    // ============================================
    async getCollaborators() {
        return this.request('/api/collaborators');
    }
    async getCollaborator(id) {
        return this.request(`/api/collaborators/${id}`);
    }
    // ============================================
    // Sales / Earnings (Sales API)
    // ============================================
    async getEarnings(params) {
        const queryParams = new URLSearchParams();
        if (params?.releaseId)
            queryParams.append('release', params.releaseId);
        if (params?.trackId)
            queryParams.append('track', params.trackId);
        if (params?.startDate)
            queryParams.append('startDate', params.startDate);
        if (params?.endDate)
            queryParams.append('endDate', params.endDate);
        if (params?.storeId)
            queryParams.append('store', params.storeId);
        const query = queryParams.toString();
        return this.request(`/api/sales${query ? `?${query}` : ''}`, {}, this.config.salesUrl);
    }
    // ============================================
    // Trends / Streams (Trends API)
    // ============================================
    async getStreams(params) {
        const queryParams = new URLSearchParams();
        if (params?.releaseId)
            queryParams.append('release', params.releaseId);
        if (params?.trackId)
            queryParams.append('track', params.trackId);
        if (params?.startDate)
            queryParams.append('startDate', params.startDate);
        if (params?.endDate)
            queryParams.append('endDate', params.endDate);
        if (params?.storeId)
            queryParams.append('store', params.storeId);
        const query = queryParams.toString();
        return this.request(`/api/trends${query ? `?${query}` : ''}`, {}, this.config.trendsUrl);
    }
    // ============================================
    // Balance / Payouts
    // ============================================
    async getBalanceLedger() {
        return this.request('/api/user_balance_ledgers');
    }
}
// Factory function to create client from environment
export function createDittoClient() {
    const email = process.env.DITTO_EMAIL;
    const password = process.env.DITTO_PASSWORD;
    if (!email || !password) {
        return null;
    }
    return new DittoClient({
        email,
        password,
        baseUrl: process.env.DITTO_BASE_URL || 'https://dashboard2.qa.dittomusic.com',
        releasesUrl: process.env.DITTO_RELEASES_URL || 'https://releases.qa.dittomusic.com',
        salesUrl: process.env.DITTO_SALES_URL || 'https://sales.dittomusic.com',
        trendsUrl: process.env.DITTO_TRENDS_URL || 'https://trends.dittomusic.com',
        basicAuthUser: process.env.DITTO_BASIC_USER,
        basicAuthPass: process.env.DITTO_BASIC_PASS,
    });
}
