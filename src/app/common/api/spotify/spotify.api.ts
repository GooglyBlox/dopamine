/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { Injectable } from '@angular/core';
import fetch from 'node-fetch';
import { ipcRenderer } from 'electron';
import { Logger } from '../../logger';
import { SettingsBase } from '../../settings/settings.base';
import { SpotifyPlaylistSummary, SpotifyPlaylistTrack, SpotifyUserProfile } from './spotify-types';

const API_BASE = 'https://api.spotify.com/v1';

export interface SpotifyAuthResult {
    ok: boolean;
    error?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
}

@Injectable({ providedIn: 'root' })
export class SpotifyApi {
    private refreshInFlight: Promise<boolean> | undefined;

    public constructor(
        private settings: SettingsBase,
        private logger: Logger,
    ) {}

    public isConnected(): boolean {
        return this.settings.spotifyRefreshToken.length > 0;
    }

    public async authorize(): Promise<SpotifyAuthResult> {
        const clientId = this.settings.spotifyClientId.trim();
        if (clientId.length === 0) {
            return { ok: false, error: 'no-client-id' };
        }

        const result: any = await ipcRenderer.invoke('spotify:authorize', { clientId });
        if (!result?.ok) {
            return { ok: false, error: result?.error ?? 'Authorization failed' };
        }

        this.settings.spotifyAccessToken = result.accessToken;
        this.settings.spotifyRefreshToken = result.refreshToken;
        this.settings.spotifyTokenExpiresAt = result.expiresAt;

        try {
            const profile = await this.getCurrentUser();
            this.settings.spotifyUserDisplayName = profile?.displayName ?? '';
        } catch {
            // best-effort
        }

        return { ok: true };
    }

    public async cancelAuthorize(): Promise<void> {
        try {
            await ipcRenderer.invoke('spotify:cancel-authorize');
        } catch {
            // ignore
        }
    }

    public signOut(): void {
        this.settings.spotifyAccessToken = '';
        this.settings.spotifyRefreshToken = '';
        this.settings.spotifyTokenExpiresAt = 0;
        this.settings.spotifyUserDisplayName = '';
    }

    public async getCurrentUser(): Promise<SpotifyUserProfile | undefined> {
        const data = await this.get('/me');
        if (data == undefined) return undefined;
        return {
            id: typeof data.id === 'string' ? data.id : '',
            displayName: typeof data.display_name === 'string' ? data.display_name : '',
        };
    }

    public async getUserPlaylists(): Promise<SpotifyPlaylistSummary[]> {
        const results: SpotifyPlaylistSummary[] = [];
        let nextUrl: string | undefined = `${API_BASE}/me/playlists?limit=50`;
        while (nextUrl != undefined) {
            const data = await this.getAbsolute(nextUrl);
            if (data == undefined) break;
            const items: any[] = Array.isArray(data.items) ? data.items : [];
            for (const item of items) {
                if (item == undefined) continue;
                const images: any[] = Array.isArray(item.images) ? item.images : [];
                results.push({
                    id: String(item.id ?? ''),
                    name: typeof item.name === 'string' ? item.name : '',
                    description: typeof item.description === 'string' ? item.description : '',
                    ownerId: String(item.owner?.id ?? ''),
                    ownerDisplayName: String(item.owner?.display_name ?? ''),
                    imageUrl: images.length > 0 ? images[0]?.url : undefined,
                    trackCount: typeof item.tracks?.total === 'number' ? item.tracks.total : 0,
                    snapshotId: String(item.snapshot_id ?? ''),
                });
            }
            nextUrl = typeof data.next === 'string' && data.next.length > 0 ? data.next : undefined;
        }
        return results.filter((p) => p.id.length > 0);
    }

    public async getPlaylist(playlistId: string): Promise<SpotifyPlaylistSummary | undefined> {
        const data = await this.get(
            `/playlists/${encodeURIComponent(playlistId)}` +
                `?fields=id,name,description,snapshot_id,owner(id,display_name),images,tracks(total)`,
        );
        if (data == undefined || typeof data.id !== 'string' || data.id.length === 0) {
            return undefined;
        }
        const images: any[] = Array.isArray(data.images) ? data.images : [];
        return {
            id: String(data.id),
            name: typeof data.name === 'string' ? data.name : '',
            description: typeof data.description === 'string' ? data.description : '',
            ownerId: String(data.owner?.id ?? ''),
            ownerDisplayName: String(data.owner?.display_name ?? ''),
            imageUrl: images.length > 0 ? images[0]?.url : undefined,
            trackCount: typeof data.tracks?.total === 'number' ? data.tracks.total : 0,
            snapshotId: String(data.snapshot_id ?? ''),
        };
    }

    public async getPlaylistTracks(playlistId: string): Promise<SpotifyPlaylistTrack[]> {
        const results: SpotifyPlaylistTrack[] = [];
        let nextUrl: string | undefined =
            `${API_BASE}/playlists/${encodeURIComponent(playlistId)}/tracks?limit=100` +
            `&fields=next,items(added_at,track(id,name,duration_ms,external_urls,external_ids,preview_url,artists(name),album(name,images)))`;
        while (nextUrl != undefined) {
            const data = await this.getAbsolute(nextUrl);
            if (data == undefined) break;
            const items: any[] = Array.isArray(data.items) ? data.items : [];
            for (const item of items) {
                const track = item?.track;
                if (track == undefined || track.id == undefined) continue;
                const artists: any[] = Array.isArray(track.artists) ? track.artists : [];
                const albumImages: any[] = Array.isArray(track.album?.images) ? track.album.images : [];
                results.push({
                    id: String(track.id),
                    name: typeof track.name === 'string' ? track.name : '',
                    artists: artists.map((a) => String(a?.name ?? '')).filter((n) => n.length > 0),
                    albumName: typeof track.album?.name === 'string' ? track.album.name : '',
                    durationMs: typeof track.duration_ms === 'number' ? track.duration_ms : 0,
                    isrc: typeof track.external_ids?.isrc === 'string' ? track.external_ids.isrc : undefined,
                    addedAt: typeof item.added_at === 'string' ? item.added_at : undefined,
                    externalUrl:
                        typeof track.external_urls?.spotify === 'string' ? track.external_urls.spotify : undefined,
                    albumImageUrl: albumImages.length > 0 ? albumImages[albumImages.length - 1]?.url : undefined,
                    previewUrl: typeof track.preview_url === 'string' ? track.preview_url : undefined,
                });
            }
            nextUrl = typeof data.next === 'string' && data.next.length > 0 ? data.next : undefined;
        }
        return results;
    }

    private async get(path: string): Promise<any> {
        return this.getAbsolute(`${API_BASE}${path}`);
    }

    private async getAbsolute(url: string): Promise<any> {
        const attempt = async (): Promise<{ status: number; body: any } | undefined> => {
            const token = this.settings.spotifyAccessToken;
            if (token.length === 0) {
                return undefined;
            }
            try {
                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        Accept: 'application/json',
                    },
                });
                if (response.status === 204) {
                    return { status: 204, body: undefined };
                }
                let body: any;
                try {
                    body = await response.json();
                } catch {
                    body = undefined;
                }
                return { status: response.status, body };
            } catch (e) {
                this.logger.warn(`Spotify request failed for ${url}: ${e}`, 'SpotifyApi', 'getAbsolute');
                return undefined;
            }
        };

        if (this.shouldRefresh()) {
            await this.ensureFreshToken();
        }

        let result = await attempt();
        if (result != undefined && result.status === 401) {
            const refreshed = await this.ensureFreshToken(true);
            if (refreshed) {
                result = await attempt();
            }
        }

        if (result == undefined) {
            return undefined;
        }

        if (result.status === 429) {
            this.logger.warn(`Spotify rate-limited at ${url}`, 'SpotifyApi', 'getAbsolute');
            await new Promise((resolve) => setTimeout(resolve, 2000));
            const retry = await attempt();
            return retry?.body;
        }

        if (result.status >= 200 && result.status < 300) {
            return result.body;
        }

        this.logger.warn(
            `Spotify ${result.status} at ${url}: ${JSON.stringify(result.body).slice(0, 200)}`,
            'SpotifyApi',
            'getAbsolute',
        );
        return undefined;
    }

    private shouldRefresh(): boolean {
        if (this.settings.spotifyRefreshToken.length === 0) return false;
        if (this.settings.spotifyAccessToken.length === 0) return true;
        return this.settings.spotifyTokenExpiresAt <= Date.now();
    }

    private async ensureFreshToken(force: boolean = false): Promise<boolean> {
        if (!force && !this.shouldRefresh()) return true;
        if (this.settings.spotifyRefreshToken.length === 0) return false;

        if (this.refreshInFlight != undefined) {
            return this.refreshInFlight;
        }

        this.refreshInFlight = (async () => {
            try {
                const result: any = await ipcRenderer.invoke('spotify:refresh', {
                    clientId: this.settings.spotifyClientId,
                    refreshToken: this.settings.spotifyRefreshToken,
                });
                if (!result?.ok) {
                    this.logger.warn(`Spotify token refresh failed: ${result?.error}`, 'SpotifyApi', 'ensureFreshToken');
                    return false;
                }
                this.settings.spotifyAccessToken = result.accessToken;
                if (typeof result.refreshToken === 'string' && result.refreshToken.length > 0) {
                    this.settings.spotifyRefreshToken = result.refreshToken;
                }
                this.settings.spotifyTokenExpiresAt = result.expiresAt;
                return true;
            } finally {
                this.refreshInFlight = undefined;
            }
        })();

        return this.refreshInFlight;
    }
}
