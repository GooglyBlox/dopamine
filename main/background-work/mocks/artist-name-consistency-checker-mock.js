class ArtistNameConsistencyCheckerMock {
    constructor() {
        this.checkAndFixConsistencyCalls = [];
    }

    checkAndFixConsistency(tracks) {
        this.checkAndFixConsistencyCalls.push(tracks);
    }
}

exports.ArtistNameConsistencyCheckerMock = ArtistNameConsistencyCheckerMock;
