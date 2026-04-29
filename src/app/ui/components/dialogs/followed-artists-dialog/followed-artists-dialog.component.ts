/* eslint-disable @typescript-eslint/no-floating-promises */
import { Component, ViewEncapsulation } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { Logger } from '../../../../common/logger';
import { MbArtistResolutionStatus } from '../../../../data/entities/mb-artist';
import { MusicBrainzApi } from '../../../../common/api/musicbrainz/musicbrainz.api';
import { DialogServiceBase } from '../../../../services/dialog/dialog.service.base';
import { FollowedArtistsService } from '../../../../services/release-calendar/followed-artists.service';
import {
    FollowedArtistDetail,
    ReleaseCalendarService,
} from '../../../../services/release-calendar/release-calendar.service';

@Component({
    selector: 'app-followed-artists-dialog',
    templateUrl: './followed-artists-dialog.component.html',
    styleUrls: ['./followed-artists-dialog.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class FollowedArtistsDialogComponent {
    public details: FollowedArtistDetail[] = [];
    public busyMbid: string | undefined;
    public readonly resolutionStatus = MbArtistResolutionStatus;

    public constructor(
        private dialogRef: MatDialogRef<FollowedArtistsDialogComponent>,
        private followedArtistsService: FollowedArtistsService,
        private releaseCalendarService: ReleaseCalendarService,
        private musicBrainzApi: MusicBrainzApi,
        private dialogService: DialogServiceBase,
        private logger: Logger,
    ) {
        this.refresh();
    }

    public close(): void {
        this.dialogRef.close();
    }

    public unfollow(detail: FollowedArtistDetail): void {
        this.followedArtistsService.unfollow(detail.name);
        this.refresh();
    }

    public async changeMbidAsync(detail: FollowedArtistDetail): Promise<void> {
        this.busyMbid = detail.nameKey;
        try {
            const candidates = await this.musicBrainzApi.findArtistCandidatesByName(detail.name);
            const picked = await this.dialogService.showArtistMbidPickerAsync(detail.name, candidates);
            if (picked != undefined) {
                this.releaseCalendarService.bindArtistToMbid(detail.name, detail.nameKey, picked);
                this.releaseCalendarService.syncFollowedArtistsAsync(true).catch((e: unknown) => {
                    this.logger.error(
                        e,
                        'Failed to trigger sync after rebind',
                        'FollowedArtistsDialogComponent',
                        'changeMbidAsync',
                    );
                });
            }
        } catch (e) {
            this.logger.error(e, 'Failed to change MBID', 'FollowedArtistsDialogComponent', 'changeMbidAsync');
        } finally {
            this.busyMbid = undefined;
            this.refresh();
        }
    }

    public openMbPage(detail: FollowedArtistDetail, event: MouseEvent): void {
        event.stopPropagation();
        if (detail.mbid == undefined || detail.mbid.length === 0) {
            return;
        }
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const electron: typeof import('electron') = window.require('electron');
            void electron.shell.openExternal(`https://musicbrainz.org/artist/${detail.mbid}`);
        } catch {
            // ignore
        }
    }

    public infoLineFor(detail: FollowedArtistDetail): string {
        const parts: string[] = [];
        if (detail.mbType != undefined && detail.mbType.length > 0) {
            parts.push(detail.mbType);
        }
        if (detail.mbCountry != undefined && detail.mbCountry.length > 0) {
            parts.push(detail.mbCountry);
        }
        return parts.join(' · ');
    }

    public statusLabel(detail: FollowedArtistDetail): string {
        switch (detail.resolutionStatus) {
            case MbArtistResolutionStatus.resolved:
                return 'releases-status-resolved';
            case MbArtistResolutionStatus.notFound:
                return 'releases-status-not-found';
            case MbArtistResolutionStatus.failed:
                return 'releases-status-failed';
            case MbArtistResolutionStatus.unresolved:
            default:
                return 'releases-status-unresolved';
        }
    }

    public trackByKey(_: number, detail: FollowedArtistDetail): string {
        return detail.nameKey;
    }

    private refresh(): void {
        this.details = this.releaseCalendarService.getFollowedDetails().sort((a, b) => a.name.localeCompare(b.name));
    }
}
