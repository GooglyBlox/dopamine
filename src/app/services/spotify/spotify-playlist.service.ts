import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { Logger } from '../../common/logger';
import { SettingsBase } from '../../common/settings/settings.base';
import { SpotifyApi } from '../../common/api/spotify/spotify.api';
import { SpotifyPlaylistSummary } from '../../common/api/spotify/spotify-types';
import { SpotifyTrackMatcher } from './spotify-track-matcher';
import {
    EnrichedMatchedTrack,
    PastedPlaylistEntry,
    PastedTrack,
    SpotifyPlaylistDetail,
    SpotifyPlaylistViewModel,
} from './spotify-playlist-models';
import { SpotifyPlaylistTrack } from '../../common/api/spotify/spotify-types';
import { AlbumArtworkRepositoryBase } from '../../data/repositories/album-artwork-repository.base';
import { ApplicationPaths } from '../../common/application/application-paths';
import { Track } from '../../data/entities/track';

const PASTED_PREFIX = 'paste:';

const ALGO_NAME_PATTERNS: RegExp[] = [
    /^discover weekly$/i,
    /^release radar$/i,
    /^daily mix \d+$/i,
    /^your top songs( \d{4})?$/i,
    /^your all[- ]time top songs$/i,
    /^daylist/i,
    /^on repeat$/i,
    /^repeat rewind$/i,
];

function isAlgorithmic(summary: SpotifyPlaylistSummary): boolean {
    if (summary.ownerId === 'spotify') return true;
    return ALGO_NAME_PATTERNS.some((p) => p.test(summary.name));
}

@Injectable({ providedIn: 'root' })
export class SpotifyPlaylistService {
    private cachedPlaylists: SpotifyPlaylistViewModel[] = [];
    private detailCache: Map<string, SpotifyPlaylistDetail> = new Map();

    private playlistsChanged: Subject<void> = new Subject<void>();
    public playlistsChanged$: Observable<void> = this.playlistsChanged.asObservable();

    private connectionChanged: Subject<void> = new Subject<void>();
    public connectionChanged$: Observable<void> = this.connectionChanged.asObservable();

    public constructor(
        private api: SpotifyApi,
        private matcher: SpotifyTrackMatcher,
        private settings: SettingsBase,
        private albumArtworkRepository: AlbumArtworkRepositoryBase,
        private applicationPaths: ApplicationPaths,
        private logger: Logger,
    ) {}

    private buildAlbumKeyToArtworkUrlMap(): Map<string, string> {
        const map = new Map<string, string>();
        const all = this.albumArtworkRepository.getAllAlbumArtwork() ?? [];
        for (const aw of all) {
            if (aw.albumKey != undefined && aw.artworkId != undefined && aw.artworkId.length > 0) {
                map.set(aw.albumKey, 'file:///' + this.applicationPaths.coverArtFullPath(aw.artworkId));
            }
        }
        return map;
    }

    private albumKeyForTrack(track: Track): string {
        const idx = this.settings.albumKeyIndex;
        if (idx === '3') return track.albumKey3 ?? '';
        if (idx === '2') return track.albumKey2 ?? '';
        return track.albumKey ?? '';
    }

    public isConnected(): boolean {
        return this.api.isConnected();
    }

    public async connect(): Promise<{ ok: boolean; error?: string }> {
        const result = await this.api.authorize();
        if (result.ok) {
            this.cachedPlaylists = [];
            this.detailCache.clear();
            this.connectionChanged.next();
        }
        return result;
    }

    public async cancelConnect(): Promise<void> {
        await this.api.cancelAuthorize();
    }

    public disconnect(): void {
        this.api.signOut();
        this.cachedPlaylists = [];
        this.detailCache.clear();
        this.connectionChanged.next();
    }

    public getCachedPlaylists(): SpotifyPlaylistViewModel[] {
        return this.cachedPlaylists;
    }

    public getImportedPlaylistIds(): string[] {
        return this.parseImportedIds(this.settings.spotifyImportedPlaylistIds);
    }

    public getPastedPlaylists(): PastedPlaylistEntry[] {
        return this.parsePastedPlaylists(this.settings.spotifyPastedPlaylists);
    }

    public createPastedPlaylist(name: string, pastedText: string): { ok: boolean; error?: string; summary?: SpotifyPlaylistSummary } {
        const trimmedName = name.trim();
        if (trimmedName.length === 0) {
            return { ok: false, error: 'empty-name' };
        }

        const tracks = this.parsePastedTracks(pastedText);
        if (tracks.length === 0) {
            return { ok: false, error: 'empty-tracks' };
        }

        const id = `${PASTED_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        const entry: PastedPlaylistEntry = { id, name: trimmedName, tracks, createdAt: Date.now() };

        const existing = this.getPastedPlaylists();
        existing.push(entry);
        this.settings.spotifyPastedPlaylists = JSON.stringify(existing);

        const summary = this.pastedEntryToSummary(entry);
        this.cachedPlaylists = [
            { summary, isAlgorithmic: true, isImported: false, isPasted: true },
            ...this.cachedPlaylists,
        ];
        this.playlistsChanged.next();
        return { ok: true, summary };
    }

    public updatePastedPlaylist(id: string, patch: { name?: string; coverArtUrl?: string | null }): { ok: boolean; error?: string } {
        const all = this.getPastedPlaylists();
        const idx = all.findIndex((p) => p.id === id);
        if (idx < 0) return { ok: false, error: 'not-found' };

        const entry = all[idx];
        if (patch.name != undefined) {
            const trimmed = patch.name.trim();
            if (trimmed.length === 0) return { ok: false, error: 'empty-name' };
            entry.name = trimmed;
        }
        if (patch.coverArtUrl !== undefined) {
            const raw = patch.coverArtUrl;
            entry.coverArtUrl = raw == null || raw.length === 0 ? undefined : raw;
        }

        all[idx] = entry;
        this.settings.spotifyPastedPlaylists = JSON.stringify(all);

        const summary = this.pastedEntryToSummary(entry);
        this.cachedPlaylists = this.cachedPlaylists.map((p) =>
            p.isPasted && p.summary.id === id ? { ...p, summary } : p,
        );
        // Invalidate detail cache so the updated summary (and any other dependent state) gets refreshed.
        this.detailCache.delete(id);
        this.playlistsChanged.next();
        return { ok: true };
    }

    public deletePastedPlaylist(id: string): void {
        const remaining = this.getPastedPlaylists().filter((p) => p.id !== id);
        this.settings.spotifyPastedPlaylists = remaining.length === 0 ? '' : JSON.stringify(remaining);
        this.cachedPlaylists = this.cachedPlaylists.filter((p) => !(p.isPasted && p.summary.id === id));
        this.detailCache.delete(id);
        this.playlistsChanged.next();
    }

    public async importPlaylistByLink(linkOrId: string): Promise<{ ok: boolean; error?: string; summary?: SpotifyPlaylistSummary }> {
        const id = this.extractPlaylistId(linkOrId);
        if (id == undefined) {
            return { ok: false, error: 'invalid-link' };
        }

        const existing = this.getImportedPlaylistIds();
        if (existing.includes(id)) {
            return { ok: false, error: 'already-imported' };
        }

        const summary = await this.api.getPlaylist(id);
        if (summary == undefined) {
            return { ok: false, error: 'fetch-failed' };
        }

        const updated = [...existing, id];
        this.settings.spotifyImportedPlaylistIds = updated.join(';');

        this.cachedPlaylists = [{ summary, isAlgorithmic: true, isImported: true, isPasted: false }, ...this.cachedPlaylists];
        this.playlistsChanged.next();

        return { ok: true, summary };
    }

    public removeImportedPlaylist(id: string): void {
        const remaining = this.getImportedPlaylistIds().filter((x) => x !== id);
        this.settings.spotifyImportedPlaylistIds = remaining.join(';');
        this.cachedPlaylists = this.cachedPlaylists.filter((p) => !(p.isImported && p.summary.id === id));
        this.detailCache.delete(id);
        this.playlistsChanged.next();
    }

    public async refreshPlaylists(includeNonAlgorithmic: boolean = false): Promise<SpotifyPlaylistViewModel[]> {
        try {
            const apiPlaylists = await this.api.getUserPlaylists();
            const importedIds = this.getImportedPlaylistIds();
            const importedSet = new Set(importedIds);

            const view: SpotifyPlaylistViewModel[] = apiPlaylists.map((summary) => ({
                summary,
                isAlgorithmic: isAlgorithmic(summary),
                isImported: false,
                isPasted: false,
            }));

            const alreadyById = new Set(view.map((v) => v.summary.id));
            const importedResults = await Promise.all(
                importedIds
                    .filter((id) => !alreadyById.has(id))
                    .map(async (id) => {
                        try {
                            const summary = await this.api.getPlaylist(id);
                            return summary == undefined
                                ? undefined
                                : { summary, isAlgorithmic: true, isImported: true, isPasted: false };
                        } catch (e) {
                            this.logger.warn(`Failed to fetch imported playlist ${id}: ${e}`, 'SpotifyPlaylistService', 'refreshPlaylists');
                            return undefined;
                        }
                    }),
            );
            for (const result of importedResults) {
                if (result != undefined) view.push(result);
            }

            for (const v of view) {
                if (importedSet.has(v.summary.id)) {
                    v.isImported = true;
                    v.isAlgorithmic = true;
                }
            }

            // Pasted playlists — these don't go through the API, just local storage.
            for (const entry of this.getPastedPlaylists()) {
                view.push({
                    summary: this.pastedEntryToSummary(entry),
                    isAlgorithmic: true,
                    isImported: false,
                    isPasted: true,
                });
            }

            const filtered = includeNonAlgorithmic ? view : view.filter((v) => v.isAlgorithmic);
            const ordered = filtered.sort((a, b) => {
                if (a.isAlgorithmic !== b.isAlgorithmic) return a.isAlgorithmic ? -1 : 1;
                return a.summary.name.localeCompare(b.summary.name);
            });
            this.cachedPlaylists = ordered;
            this.detailCache.clear();
            this.playlistsChanged.next();
            return ordered;
        } catch (e) {
            this.logger.error(e, 'Failed to refresh Spotify playlists', 'SpotifyPlaylistService', 'refreshPlaylists');
            throw e;
        }
    }

    public async getPlaylistDetail(playlistId: string, forceRefresh: boolean = false): Promise<SpotifyPlaylistDetail | undefined> {
        const summary = this.cachedPlaylists.find((p) => p.summary.id === playlistId)?.summary;
        if (summary == undefined) return undefined;

        if (!forceRefresh) {
            const cached = this.detailCache.get(playlistId);
            if (cached != undefined && cached.summary.snapshotId === summary.snapshotId) {
                return cached;
            }
        }

        let tracks: SpotifyPlaylistTrack[];
        if (playlistId.startsWith(PASTED_PREFIX)) {
            const entry = this.getPastedPlaylists().find((p) => p.id === playlistId);
            if (entry == undefined) return undefined;
            tracks = entry.tracks.map((t, idx) => ({
                id: `${playlistId}:${idx}`,
                name: t.title,
                artists: t.artists.length > 0 ? t.artists : [''],
                albumName: t.albumName ?? '',
                durationMs: 0,
            }));
        } else {
            tracks = await this.api.getPlaylistTracks(playlistId);
        }

        const index = this.matcher.buildIndex();
        const artworkMap = this.buildAlbumKeyToArtworkUrlMap();
        const matched: EnrichedMatchedTrack[] = tracks.map((t) => {
            const base = this.matcher.match(t, index);
            if (base.matchedLocalTrack != undefined) {
                const albumKey = this.albumKeyForTrack(base.matchedLocalTrack);
                return {
                    ...base,
                    localCoverArtUrl: artworkMap.get(albumKey),
                    localDurationMs: base.matchedLocalTrack.duration,
                };
            }
            return base;
        });
        const presentCount = matched.filter((m) => m.matchedLocalTrack != undefined).length;
        const detail: SpotifyPlaylistDetail = {
            summary,
            tracks: matched,
            presentCount,
            missingCount: matched.length - presentCount,
        };
        this.detailCache.set(playlistId, detail);
        return detail;
    }

    private parseImportedIds(raw: string): string[] {
        if (raw == undefined || raw.length === 0) return [];
        return raw
            .split(';')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
    }

    private parsePastedPlaylists(raw: string): PastedPlaylistEntry[] {
        if (raw == undefined || raw.length === 0) return [];
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed
                .filter((p) => p != undefined && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.tracks))
                .map((p) => ({
                    id: String(p.id),
                    name: String(p.name),
                    tracks: p.tracks
                        .filter((t: any) => t != undefined && typeof t.title === 'string')
                        .map((t: any) => {
                            const artists: string[] = Array.isArray(t.artists)
                                ? t.artists.filter((a: unknown) => typeof a === 'string')
                                : typeof t.artist === 'string'
                                  ? [t.artist]
                                  : [];
                            return {
                                artists,
                                title: String(t.title),
                                albumName: typeof t.albumName === 'string' ? t.albumName : undefined,
                            };
                        }),
                    createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0,
                    coverArtUrl: typeof p.coverArtUrl === 'string' && p.coverArtUrl.length > 0 ? p.coverArtUrl : undefined,
                }));
        } catch {
            return [];
        }
    }

    private parsePastedTracks(text: string): PastedTrack[] {
        if (text == undefined) return [];

        const rows = this.parseCsvRows(text);
        if (rows.length === 0) return [];

        // Detect CSV/TSV with a header row by looking for known column names.
        const headerLower = rows[0].map((c) => c.trim().toLowerCase());
        const titleCol = this.findColumn(headerLower, ['name', 'title', 'track name', 'track', 'song', 'song name']);
        const artistCol = this.findColumn(headerLower, ['artists', 'artist', 'artist name(s)', 'artist name', 'artist names']);
        const albumCol = this.findColumn(headerLower, ['albumname', 'album name', 'album']);

        if (titleCol != undefined && artistCol != undefined) {
            const results: PastedTrack[] = [];
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (row.length === 0) continue;
                const title = (row[titleCol] ?? '').trim();
                const artistRaw = (row[artistCol] ?? '').trim();
                if (title.length === 0) continue;
                const artists = this.splitArtists(artistRaw);
                const albumName = albumCol != undefined ? (row[albumCol] ?? '').trim() : undefined;
                results.push({ artists, title, albumName: albumName && albumName.length > 0 ? albumName : undefined });
            }
            if (results.length > 0) return results;
        }

        // Fallback: line-based parsing for "Artist - Title" / "Title by Artist".
        const lines = text
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l.length > 0);
        const results: PastedTrack[] = [];
        for (const line of lines) {
            const parsed = this.parseTrackLine(line);
            if (parsed != undefined) results.push(parsed);
        }
        return results;
    }

    private parseTrackLine(line: string): PastedTrack | undefined {
        if (line.includes('\t')) {
            const parts = line.split('\t').map((s) => s.trim()).filter((s) => s.length > 0);
            if (parts.length >= 2) {
                return { artists: this.splitArtists(parts[0]), title: parts[1] };
            }
        }

        const dashMatch = line.match(/^(.+?)\s+[-–—]\s+(.+)$/);
        if (dashMatch) {
            return { artists: this.splitArtists(dashMatch[1].trim()), title: dashMatch[2].trim() };
        }

        const byMatch = line.match(/^(.+?)\s+by\s+(.+)$/i);
        if (byMatch) {
            return { artists: this.splitArtists(byMatch[2].trim()), title: byMatch[1].trim() };
        }

        return undefined;
    }

    private splitArtists(value: string): string[] {
        if (value == undefined || value.length === 0) return [];
        const trimmed = value.trim();
        if (trimmed.length === 0) return [];
        // Prefer ';' (what the user's plugin and Dopamine's own column delimiter use).
        // Fall back to ',' only if no ';' present, since ',' can appear inside single artist names.
        const parts = trimmed.includes(';') ? trimmed.split(';') : trimmed.split(',');
        return parts.map((s) => s.trim()).filter((s) => s.length > 0);
    }

    private findColumn(header: string[], candidates: string[]): number | undefined {
        for (let i = 0; i < header.length; i++) {
            if (candidates.includes(header[i])) return i;
        }
        return undefined;
    }

    private parseCsvRows(text: string): string[][] {
        const rows: string[][] = [];
        let row: string[] = [];
        let cell = '';
        let inQuotes = false;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (inQuotes) {
                if (c === '"') {
                    if (text[i + 1] === '"') {
                        cell += '"';
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    cell += c;
                }
            } else {
                if (c === '"') {
                    inQuotes = true;
                } else if (c === ',') {
                    row.push(cell);
                    cell = '';
                } else if (c === '\r') {
                    // ignore; \n triggers row end
                } else if (c === '\n') {
                    row.push(cell);
                    if (row.some((x) => x.length > 0)) rows.push(row);
                    row = [];
                    cell = '';
                } else {
                    cell += c;
                }
            }
        }
        if (cell.length > 0 || row.length > 0) {
            row.push(cell);
            if (row.some((x) => x.length > 0)) rows.push(row);
        }
        return rows;
    }

    private pastedEntryToSummary(entry: PastedPlaylistEntry): SpotifyPlaylistSummary {
        return {
            id: entry.id,
            name: entry.name,
            description: '',
            ownerId: 'pasted',
            ownerDisplayName: 'Pasted',
            imageUrl: entry.coverArtUrl,
            trackCount: entry.tracks.length,
            snapshotId: `${entry.createdAt}:${entry.name}:${entry.coverArtUrl ?? ''}`,
        };
    }

    private extractPlaylistId(input: string): string | undefined {
        const trimmed = (input ?? '').trim();
        if (trimmed.length === 0) return undefined;

        // open.spotify.com/playlist/<id>?si=...
        const urlMatch = trimmed.match(/spotify\.com\/playlist\/([A-Za-z0-9]+)/i);
        if (urlMatch) return urlMatch[1];

        // spotify:playlist:<id>
        const uriMatch = trimmed.match(/^spotify:playlist:([A-Za-z0-9]+)$/i);
        if (uriMatch) return uriMatch[1];

        // Raw ID (typically 22 base62 chars but we'll accept any reasonable alnum string).
        if (/^[A-Za-z0-9]{16,}$/.test(trimmed)) return trimmed;

        return undefined;
    }
}
