import { Component, ViewEncapsulation } from '@angular/core';
import { AppearanceServiceBase } from '../../../../services/appearance/appearance.service.base';
import { NavigationServiceBase } from '../../../../services/navigation/navigation.service.base';
import { SettingsBase } from '../../../../common/settings/settings.base';
import { TrackModel } from '../../../../services/track/track-model';
import { CollectionNavigationService } from '../../../../services/collection-navigation/collection-navigation.service';
import { ArtistsAlbumsPersister } from '../collection-artists/artists-albums-persister';
import { ArtistsPersister } from '../collection-artists/artists-persister';
import { AlbumServiceBase } from '../../../../services/album/album-service.base';
import { ArtistServiceBase } from '../../../../services/artist/artist.service.base';
import { AlbumModel } from '../../../../services/album/album-model';
import { ArtistModel } from '../../../../services/artist/artist-model';

@Component({
    selector: 'app-collection-playback-pane',
    host: { style: 'display: block' },
    templateUrl: './collection-playback-pane.component.html',
    styleUrls: ['./collection-playback-pane.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class CollectionPlaybackPaneComponent {
    public constructor(
        public appearanceService: AppearanceServiceBase,
        public settings: SettingsBase,
        private navigationService: NavigationServiceBase,
        private collectionNavigationService: CollectionNavigationService,
        private artistsAlbumsPersister: ArtistsAlbumsPersister,
        private artistsPersister: ArtistsPersister,
        private albumService: AlbumServiceBase,
        private artistService: ArtistServiceBase,
    ) {}

    public showPlaybackQueue(): void {
        this.navigationService.showPlaybackQueue();
    }

    public async showNowPlayingAsync(): Promise<void> {
        await this.navigationService.navigateToNowPlayingAsync();
    }

    public onTrackTitleClicked(track: TrackModel): void {
        // Check if we're on the artists view (page 0)
        if (this.collectionNavigationService.page !== 0) {
            return;
        }

        // Get the album for this track
        const albumKey = track.albumKey;
        if (!albumKey) {
            return;
        }

        // Get the artist type that's currently selected
        const selectedArtistType = this.artistsPersister.getSelectedArtistType();

        // Get artists for this track based on the current artist type
        const allArtists = this.artistService.getArtists(selectedArtistType);

        // Find artists that have this track
        const trackArtistNames = track.artists ? track.artists.split(/[;,]/).map(a => a.trim()) : [];
        const matchingArtists = allArtists.filter(artist =>
            trackArtistNames.some(trackArtistName =>
                artist.displayName.toLowerCase().includes(trackArtistName.toLowerCase()) ||
                trackArtistName.toLowerCase().includes(artist.displayName.toLowerCase())
            )
        );

        // Select the first matching artist (or keep current selection if no match)
        if (matchingArtists.length > 0) {
            this.artistsPersister.setSelectedArtists([matchingArtists[0]]);
        }

        // Get all albums to find the matching one
        const allAlbums = this.albumService.getAllAlbums();
        const matchingAlbum = allAlbums.find((album) => album.albumKey === albumKey);

        if (matchingAlbum) {
            // Select the album in the artists albums persister
            // This will trigger the tracks to be loaded for this album
            this.artistsAlbumsPersister.setSelectedAlbums([matchingAlbum]);
        }
    }

    public async showHighlightsAsync(): Promise<void> {
        await this.navigationService.navigateToHighlightsAsync();
    }
}
