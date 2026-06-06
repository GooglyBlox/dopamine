import { Component, OnDestroy, OnInit, ViewEncapsulation } from '@angular/core';
import { Subscription } from 'rxjs';
import { BlacklistService, BlacklistedArtistEntry } from '../../../../services/blacklist/blacklist.service';
import { TrackModel } from '../../../../services/track/track-model';

@Component({
    selector: 'app-blacklist-settings',
    host: { style: 'display: block; width: 100%;' },
    templateUrl: './blacklist-settings.component.html',
    styleUrls: ['./blacklist-settings.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class BlacklistSettingsComponent implements OnInit, OnDestroy {
    private subscription: Subscription = new Subscription();

    public constructor(public blacklistService: BlacklistService) {}

    public blacklistedArtists: BlacklistedArtistEntry[] = [];
    public blacklistedTracks: TrackModel[] = [];

    public ngOnInit(): void {
        this.refresh();

        this.subscription.add(
            this.blacklistService.blacklistChanged$.subscribe(() => {
                this.refresh();
            }),
        );
    }

    public ngOnDestroy(): void {
        this.subscription.unsubscribe();
    }

    public removeArtist(artist: BlacklistedArtistEntry): void {
        this.blacklistService.unblacklistArtist(artist.name);
    }

    public removeTrack(track: TrackModel): void {
        this.blacklistService.unblacklistTracks([track]);
    }

    private refresh(): void {
        this.blacklistedArtists = this.blacklistService.getBlacklistedArtists();
        this.blacklistedTracks = this.blacklistService.getBlacklistedTracks().tracks;
    }
}
