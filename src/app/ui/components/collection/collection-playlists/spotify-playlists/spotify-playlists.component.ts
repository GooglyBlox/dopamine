/* eslint-disable @typescript-eslint/no-floating-promises */
import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { MatMenuTrigger } from '@angular/material/menu';
import { Subscription } from 'rxjs';
import { Logger } from '../../../../../common/logger';
import { SettingsBase } from '../../../../../common/settings/settings.base';
import { SpotifyPlaylistService } from '../../../../../services/spotify/spotify-playlist.service';
import {
    EnrichedMatchedTrack,
    SpotifyPlaylistDetail,
    SpotifyPlaylistViewModel,
} from '../../../../../services/spotify/spotify-playlist-models';
import { PlaybackService } from '../../../../../services/playback/playback.service';
import { TrackModelFactory } from '../../../../../services/track/track-model-factory';
import { TrackModel } from '../../../../../services/track/track-model';
import { CollectionNavigationService } from '../../../../../services/collection-navigation/collection-navigation.service';
import { ArtistsPersister } from '../../collection-artists/artists-persister';
import { ArtistsAlbumsPersister } from '../../collection-artists/artists-albums-persister';
import { ContextMenuOpener } from '../../../context-menu-opener';
import { Constants } from '../../../../../common/application/constants';

@Component({
    selector: 'app-spotify-playlists',
    host: { style: 'display: block; width: 100%; height: 100%;' },
    templateUrl: './spotify-playlists.component.html',
    styleUrls: ['./spotify-playlists.component.scss'],
})
export class SpotifyPlaylistsComponent implements OnInit, OnDestroy {
    private subscription: Subscription = new Subscription();

    @ViewChild('trackContextMenuTrigger', { read: MatMenuTrigger, static: false })
    public trackContextMenu!: MatMenuTrigger;

    public constructor(
        public spotifyPlaylistService: SpotifyPlaylistService,
        private settings: SettingsBase,
        private playbackService: PlaybackService,
        private trackModelFactory: TrackModelFactory,
        private collectionNavigationService: CollectionNavigationService,
        private artistsPersister: ArtistsPersister,
        private artistsAlbumsPersister: ArtistsAlbumsPersister,
        public contextMenuOpener: ContextMenuOpener,
        private logger: Logger,
    ) {}

    public playlists: SpotifyPlaylistViewModel[] = [];
    public selectedPlaylistId: string = '';
    public currentDetail: SpotifyPlaylistDetail | undefined;
    public isAuthorizing: boolean = false;
    public isLoadingPlaylists: boolean = false;
    public isLoadingTracks: boolean = false;
    public errorMessage: string = '';
    public showAllPlaylists: boolean = false;
    public importMode: 'closed' | 'link' | 'paste' | 'edit' = 'closed';
    public importInput: string = '';
    public pasteName: string = '';
    public pasteText: string = '';
    public editingId: string = '';
    public editName: string = '';
    public editCoverUrl: string = '';
    public isImporting: boolean = false;
    public importError: string = '';

    public async ngOnInit(): Promise<void> {
        this.subscription.add(
            this.spotifyPlaylistService.connectionChanged$.subscribe(() => {
                this.playlists = [];
                this.currentDetail = undefined;
                this.selectedPlaylistId = '';
                if (this.spotifyPlaylistService.isConnected()) {
                    this.refreshPlaylists();
                }
            }),
        );

        if (this.spotifyPlaylistService.isConnected()) {
            const cached = this.spotifyPlaylistService.getCachedPlaylists();
            if (cached.length > 0) {
                this.playlists = cached;
                const savedId = this.settings.playlistsTabSelectedSpotifyPlaylist;
                if (savedId.length > 0 && cached.some((p) => p.summary.id === savedId)) {
                    await this.selectPlaylist(savedId);
                }
            } else {
                await this.refreshPlaylists();
            }
        }
    }

    public ngOnDestroy(): void {
        this.subscription.unsubscribe();
    }

    public get isConnected(): boolean {
        return this.spotifyPlaylistService.isConnected();
    }

    public get userDisplayName(): string {
        return this.settings.spotifyUserDisplayName;
    }

    public get hasClientId(): boolean {
        return this.settings.spotifyClientId.trim().length > 0;
    }

    public async connect(): Promise<void> {
        if (!this.hasClientId) {
            return;
        }
        this.isAuthorizing = true;
        this.errorMessage = '';
        try {
            const result = await this.spotifyPlaylistService.connect();
            if (!result.ok) {
                this.errorMessage = result.error ?? 'Authorization failed';
            }
        } finally {
            this.isAuthorizing = false;
        }
    }

    public async cancelConnect(): Promise<void> {
        await this.spotifyPlaylistService.cancelConnect();
    }

    public disconnect(): void {
        this.spotifyPlaylistService.disconnect();
    }

    public async refreshPlaylists(): Promise<void> {
        if (!this.isConnected) return;
        this.isLoadingPlaylists = true;
        this.errorMessage = '';
        try {
            this.playlists = await this.spotifyPlaylistService.refreshPlaylists(this.showAllPlaylists);
            if (this.selectedPlaylistId.length > 0 && !this.playlists.some((p) => p.summary.id === this.selectedPlaylistId)) {
                this.selectedPlaylistId = '';
                this.currentDetail = undefined;
            } else if (this.selectedPlaylistId.length > 0) {
                await this.selectPlaylist(this.selectedPlaylistId, true);
            }
        } catch (e: unknown) {
            this.errorMessage = (e as Error)?.message ?? 'Failed to load playlists';
            this.logger.error(e, 'refreshPlaylists', 'SpotifyPlaylistsComponent', 'refreshPlaylists');
        } finally {
            this.isLoadingPlaylists = false;
        }
    }

    public async toggleShowAll(): Promise<void> {
        this.showAllPlaylists = !this.showAllPlaylists;
        await this.refreshPlaylists();
    }

    public async selectPlaylist(playlistId: string, forceRefresh: boolean = false): Promise<void> {
        this.selectedPlaylistId = playlistId;
        this.settings.playlistsTabSelectedSpotifyPlaylist = playlistId;
        this.currentDetail = undefined;
        this.isLoadingTracks = true;
        this.errorMessage = '';
        try {
            this.currentDetail = await this.spotifyPlaylistService.getPlaylistDetail(playlistId, forceRefresh);
        } catch (e: unknown) {
            this.errorMessage = (e as Error)?.message ?? 'Failed to load tracks';
            this.logger.error(e, 'selectPlaylist', 'SpotifyPlaylistsComponent', 'selectPlaylist');
        } finally {
            this.isLoadingTracks = false;
        }
    }

    public async refreshCurrentDetail(): Promise<void> {
        if (this.selectedPlaylistId.length === 0) return;
        await this.selectPlaylist(this.selectedPlaylistId, true);
    }

    public openImport(mode: 'link' | 'paste'): void {
        this.importMode = this.importMode === mode ? 'closed' : mode;
        this.importError = '';
        this.editingId = '';
        if (this.importMode !== 'closed') {
            this.importInput = '';
            this.pasteName = '';
            this.pasteText = '';
        }
    }

    public openEdit(playlist: { summary: { id: string; name: string; imageUrl?: string }; isPasted: boolean }, event: MouseEvent): void {
        event.stopPropagation();
        if (!playlist.isPasted) return;
        this.importMode = 'edit';
        this.editingId = playlist.summary.id;
        this.editName = playlist.summary.name;
        this.editCoverUrl = playlist.summary.imageUrl ?? '';
        this.importError = '';
    }

    public closeImport(): void {
        this.importMode = 'closed';
        this.editingId = '';
        this.importError = '';
    }

    public clearEditCover(): void {
        this.editCoverUrl = '';
    }

    public async onEditCoverFileSelected(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (file == undefined) return;
        try {
            this.editCoverUrl = await this.fileToDataUrl(file);
        } catch {
            this.importError = 'cover-read-failed';
        } finally {
            input.value = '';
        }
    }

    public async submitEdit(): Promise<void> {
        if (this.isImporting || this.editingId.length === 0) return;
        this.isImporting = true;
        this.importError = '';
        try {
            const result = this.spotifyPlaylistService.updatePastedPlaylist(this.editingId, {
                name: this.editName,
                coverArtUrl: this.editCoverUrl.length === 0 ? null : this.editCoverUrl,
            });
            if (!result.ok) {
                this.importError = result.error ?? 'import-failed';
                return;
            }
            const editedId = this.editingId;
            this.playlists = this.spotifyPlaylistService.getCachedPlaylists();
            this.importMode = 'closed';
            this.editingId = '';
            if (this.selectedPlaylistId === editedId) {
                await this.selectPlaylist(editedId, true);
            }
        } finally {
            this.isImporting = false;
        }
    }

    private fileToDataUrl(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result ?? ''));
            reader.onerror = () => reject(reader.error ?? new Error('read failed'));
            reader.readAsDataURL(file);
        });
    }

    public async submitLinkImport(): Promise<void> {
        const value = this.importInput.trim();
        if (value.length === 0 || this.isImporting) {
            return;
        }
        this.isImporting = true;
        this.importError = '';
        try {
            const result = await this.spotifyPlaylistService.importPlaylistByLink(value);
            if (!result.ok) {
                this.importError = result.error ?? 'import-failed';
                return;
            }
            this.importInput = '';
            this.importMode = 'closed';
            this.playlists = this.spotifyPlaylistService.getCachedPlaylists();
            if (result.summary) {
                await this.selectPlaylist(result.summary.id);
            }
        } finally {
            this.isImporting = false;
        }
    }

    public async onCsvFileSelected(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (file == undefined) return;

        const text = await file.text();
        this.pasteText = text;
        if (this.pasteName.trim().length === 0) {
            this.pasteName = file.name.replace(/\.(csv|tsv|txt)$/i, '');
        }
        input.value = '';
    }

    public async submitPasteImport(): Promise<void> {
        if (this.isImporting) return;
        this.isImporting = true;
        this.importError = '';
        try {
            const result = this.spotifyPlaylistService.createPastedPlaylist(this.pasteName, this.pasteText);
            if (!result.ok) {
                this.importError = result.error ?? 'import-failed';
                return;
            }
            this.pasteName = '';
            this.pasteText = '';
            this.importMode = 'closed';
            this.playlists = this.spotifyPlaylistService.getCachedPlaylists();
            if (result.summary) {
                await this.selectPlaylist(result.summary.id);
            }
        } finally {
            this.isImporting = false;
        }
    }

    public removePlaylist(playlist: { summary: { id: string }; isImported: boolean; isPasted: boolean }, event: MouseEvent): void {
        event.stopPropagation();
        if (playlist.isPasted) {
            this.spotifyPlaylistService.deletePastedPlaylist(playlist.summary.id);
        } else if (playlist.isImported) {
            this.spotifyPlaylistService.removeImportedPlaylist(playlist.summary.id);
        }
        this.playlists = this.spotifyPlaylistService.getCachedPlaylists();
        if (this.selectedPlaylistId === playlist.summary.id) {
            this.selectedPlaylistId = '';
            this.currentDetail = undefined;
        }
    }

    public formatDuration(ms: number): string {
        const totalSec = Math.round(ms / 1000);
        const minutes = Math.floor(totalSec / 60);
        const seconds = totalSec % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    public artistsText(artists: string[]): string {
        return artists.join(', ');
    }

    public hasPlayableTracks(): boolean {
        return this.currentDetail != undefined && this.currentDetail.presentCount > 0;
    }

    public displayDuration(item: EnrichedMatchedTrack): string {
        const ms = item.localDurationMs ?? item.spotifyTrack.durationMs;
        if (ms <= 0) return '—';
        return this.formatDuration(ms);
    }

    public displayCover(item: EnrichedMatchedTrack): string | undefined {
        return item.localCoverArtUrl ?? item.spotifyTrack.albumImageUrl;
    }

    public async playAllMatched(): Promise<void> {
        if (this.currentDetail == undefined) return;
        const tracks = this.buildMatchedTrackModels(this.currentDetail);
        if (tracks.length === 0) return;
        await this.playbackService.enqueueAndPlayTracksAsync(tracks);
    }

    public async playFrom(item: EnrichedMatchedTrack): Promise<void> {
        if (item.matchedLocalTrack == undefined || this.currentDetail == undefined) return;
        const tracks = this.buildMatchedTrackModels(this.currentDetail);
        const startPath = item.matchedLocalTrack.path;
        const start = tracks.find((t) => t.path === startPath);
        if (start == undefined) return;
        await this.playbackService.enqueueAndPlayTracksStartingFromGivenTrackAsync(tracks, start);
    }

    private buildMatchedTrackModels(detail: SpotifyPlaylistDetail): TrackModel[] {
        const albumKeyIndex = this.settings.albumKeyIndex;
        const models: TrackModel[] = [];
        for (const item of detail.tracks) {
            if (item.matchedLocalTrack != undefined) {
                models.push(this.trackModelFactory.createFromTrack(item.matchedLocalTrack, albumKeyIndex));
            }
        }
        return models;
    }

    public onTrackContextMenu(event: MouseEvent, item: EnrichedMatchedTrack): void {
        this.contextMenuOpener.open(this.trackContextMenu, event, item as unknown as { isSelected: boolean });
    }

    public canOpenAlbum(item: EnrichedMatchedTrack): boolean {
        return item.matchedLocalTrack != undefined && this.albumKeyForTrack(item) !== '';
    }

    public openArtistFromTrack(item: EnrichedMatchedTrack): void {
        const artistName = this.preferredArtistName(item, 'track');
        if (artistName.length === 0) return;

        this.artistsPersister.setSelectedArtistTypeByName('trackArtists');
        this.artistsAlbumsPersister.selectAlbumByKey('');
        this.artistsPersister.selectArtistByName(artistName);
        this.collectionNavigationService.navigateTo(0);
    }

    public openAlbumFromTrack(item: EnrichedMatchedTrack): void {
        if (!this.canOpenAlbum(item)) return;
        const albumKey = this.albumKeyForTrack(item);
        const artistName = this.preferredArtistName(item, 'album');
        if (artistName.length === 0 || albumKey.length === 0) return;

        // Album browsing uses albumArtists; switch the artist type so the chosen album shows up.
        this.artistsPersister.setSelectedArtistTypeByName('albumArtists');
        this.artistsPersister.selectArtistByName(artistName);
        this.artistsAlbumsPersister.selectAlbumByKey(albumKey);
        this.collectionNavigationService.navigateTo(0);
    }

    private albumKeyForTrack(item: EnrichedMatchedTrack): string {
        const t = item.matchedLocalTrack;
        if (t == undefined) return '';
        const idx = this.settings.albumKeyIndex;
        if (idx === '3') return t.albumKey3 ?? '';
        if (idx === '2') return t.albumKey2 ?? '';
        return t.albumKey ?? '';
    }

    private preferredArtistName(item: EnrichedMatchedTrack, source: 'track' | 'album'): string {
        const local = item.matchedLocalTrack;
        if (local != undefined) {
            const field = source === 'album' ? local.albumArtists : local.artists;
            const first = this.firstNonEmptyDelimited(field);
            if (first.length > 0) return first;
            // Fall back: if album artists empty, use track artists.
            const fallback = this.firstNonEmptyDelimited(local.artists);
            if (fallback.length > 0) return fallback;
        }
        const fromSpotify = item.spotifyTrack.artists.find((a) => a.trim().length > 0);
        return (fromSpotify ?? '').trim();
    }

    private firstNonEmptyDelimited(value: string | undefined): string {
        if (value == undefined) return '';
        for (const part of value.split(Constants.columnValueDelimiter)) {
            const trimmed = part.trim();
            if (trimmed.length > 0) return trimmed;
        }
        return '';
    }
}
