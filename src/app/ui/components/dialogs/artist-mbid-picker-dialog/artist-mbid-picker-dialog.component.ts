import { Component, Inject, ViewEncapsulation } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MbArtistCandidate } from '../../../../common/api/musicbrainz/musicbrainz-types';
import { ArtistMbidPickerData } from '../../../../services/dialog/artist-mbid-picker-data';

@Component({
    selector: 'app-artist-mbid-picker-dialog',
    templateUrl: './artist-mbid-picker-dialog.component.html',
    styleUrls: ['./artist-mbid-picker-dialog.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class ArtistMbidPickerDialogComponent {
    public selected: MbArtistCandidate | undefined;

    public constructor(
        @Inject(MAT_DIALOG_DATA) public data: ArtistMbidPickerData,
        private dialogRef: MatDialogRef<ArtistMbidPickerDialogComponent, MbArtistCandidate | undefined>,
    ) {}

    public select(candidate: MbArtistCandidate): void {
        this.selected = candidate;
    }

    public confirm(): void {
        if (this.selected != undefined) {
            this.dialogRef.close(this.selected);
        }
    }

    public cancel(): void {
        this.dialogRef.close(undefined);
    }

    public lifeSpanFor(candidate: MbArtistCandidate): string {
        const begin = candidate.beginYear ?? '';
        const end = candidate.endYear ?? '';
        if (begin.length === 0 && end.length === 0) {
            return '';
        }
        if (begin.length > 0 && end.length === 0) {
            return `${begin} –`;
        }
        if (begin.length === 0 && end.length > 0) {
            return `– ${end}`;
        }
        return `${begin} – ${end}`;
    }

    public openMusicBrainzPage(candidate: MbArtistCandidate, event: MouseEvent): void {
        event.stopPropagation();
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const electron: typeof import('electron') = window.require('electron');
            void electron.shell.openExternal(`https://musicbrainz.org/artist/${candidate.mbid}`);
        } catch {
            // ignore
        }
    }
}
