const { DismissMessage } = require('./messages/dismiss-message');

class Indexer {
    constructor(collectionChecker, trackIndexer, trackUpdater, trackRepository, workerProxy, logger) {
        this.collectionChecker = collectionChecker;
        this.trackIndexer = trackIndexer;
        this.trackUpdater = trackUpdater;
        this.trackRepository = trackRepository;
        this.workerProxy = workerProxy;
        this.logger = logger;
    }

    async indexCollectionIfOutdatedAsync() {
        this.logger.info('Indexing collection.', 'Indexer', 'indexCollectionIfOutdatedAsync');

        const collectionIsOutdated = await this.collectionChecker.isCollectionOutdatedAsync();

        if (collectionIsOutdated) {
            this.logger.info('Collection is outdated.', 'Indexer', 'indexCollectionIfOutdatedAsync');
            await this.trackIndexer.indexTracksAsync(false);
        } else {
            this.logger.info('Collection is not outdated.', 'Indexer', 'indexCollectionIfOutdatedAsync');
        }

        this.workerProxy.postMessage(new DismissMessage());
    }

    async indexCollectionAlwaysAsync() {
        this.logger.info('Indexing collection.', 'Indexer', 'indexCollectionAlwaysAsync');

        // NOTE: Intentional divergence from upstream. Upstream passes `true` here, which forces a full
        // re-read of every track's tags on every manual Refresh (and on folder changes / artist rename) —
        // a multi-minute pass for large libraries. We pass `false` so Refresh stays incremental: only new
        // and changed files (by size / modified-time) are read. ReplayGain for existing songs can still be
        // backfilled on demand via the dedicated "Refresh ReplayGain" action (reindexReplayGainForExistingTracks).
        await this.trackIndexer.indexTracksAsync(false);

        this.workerProxy.postMessage(new DismissMessage());
    }

    reindexReplayGainForExistingTracks() {
        this.logger.info('Reindexing ReplayGain for existing tracks.', 'Indexer', 'reindexReplayGainForExistingTracks');

        this.trackUpdater.reindexReplayGainForExistingTracks();

        this.workerProxy.postMessage(new DismissMessage());
    }
}

exports.Indexer = Indexer;
