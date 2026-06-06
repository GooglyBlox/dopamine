import { Component, Input } from '@angular/core';
import { ArtistModel } from '../../../../../services/artist/artist-model';
import { AppearanceServiceBase } from '../../../../../services/appearance/appearance.service.base';
import { SemanticZoomServiceBase } from '../../../../../services/semantic-zoom/semantic-zoom.service.base';
import { BlacklistService } from '../../../../../services/blacklist/blacklist.service';

@Component({
    selector: 'app-artist',
    host: { style: 'display: block' },
    templateUrl: './artist.component.html',
    styleUrls: ['./artist.component.scss'],
})
export class ArtistComponent {
    public constructor(
        public appearanceService: AppearanceServiceBase,
        public semanticZoomService: SemanticZoomServiceBase,
        public blacklistService: BlacklistService,
    ) {}

    @Input() public artist: ArtistModel;

    public requestZoomOut(): void {
        this.semanticZoomService.requestZoomOut();
    }
}
