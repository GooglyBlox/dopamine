"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiscordApi = void 0;
const discord_rpc_1 = require("discord-rpc");
const electron_log_1 = require("electron-log");
class DiscordApi {
    constructor(clientId) {
        this._isReconnecting = false;
        this._clientId = clientId;
    }
    reconnect() {
        if (this._isReconnecting) {
            electron_log_1.default.info('[DiscordApi] [reconnect] Already attempting to reconnect. Skipping...');
            return;
        }
        this._isReconnecting = true;
        this._isReady = false;
        this._client = new discord_rpc_1.Client({ transport: 'ipc' });
        this._client.on('ready', () => {
            electron_log_1.default.info('[DiscordApi] [ready] Discord client is ready!');
            this._isReady = true;
            if (this._presenceToSetWhenReady) {
                this.setPresence(this._presenceToSetWhenReady);
                this._presenceToSetWhenReady = undefined;
            }
        });
        this._client.on('disconnected', () => {
            electron_log_1.default.info('[DiscordApi] [disconnected] Discord client disconnected. Attempting to reconnect...');
            this._isReady = false;
            this.login();
        });
        this.login();
    }
    login() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield this._client.login({ clientId: this._clientId });
                electron_log_1.default.info('[DiscordApi] [login] Successfully logged into Discord client');
            }
            catch (error) {
                electron_log_1.default.error(`[DiscordApi] [login] Failed to log into Discord client: ${error}`);
            }
            finally {
                this._isReconnecting = false;
            }
        });
    }
    setPresence(args) {
        if (!this._isReady) {
            electron_log_1.default.warn('[DiscordApi] [setPresence] Discord client is not ready. Attempting reconnect.');
            this._presenceToSetWhenReady = args;
            this.reconnect();
            return;
        }
        const presence = {
            details: `${args.title}`,
            state: `${args.artists}`,
            largeImageKey: args.largeImageKey,
            largeImageText: args.largeImageText,
            smallImageKey: args.smallImageKey,
            smallImageText: args.smallImageText,
        };
        if (args.shouldSendTimestamps && args.startTime) {
            presence.startTimestamp = Math.floor(args.startTime / 1000);
        }
        if (!this._client) {
            electron_log_1.default.error('[DiscordApi] [setPresence] Discord client not found.');
            return;
        }
        this._client.setActivity(presence);
        electron_log_1.default.info(`[DiscordApi] [setPresence] Rich Presence updated: ${presence.state} - ${presence.details} (${presence.smallImageKey})`);
    }
    clearPresence() {
        this._presenceToSetWhenReady = undefined;
        if (!this._isReady) {
            electron_log_1.default.warn('[DiscordApi] [clearPresence] Discord client is not ready. Cannot clear presence.');
            return;
        }
        if (!this._client) {
            electron_log_1.default.error('[DiscordApi] [clearPresence] Discord client not found.');
            return;
        }
        this._client.clearActivity();
        electron_log_1.default.info('[DiscordApi] [clearPresence] Rich Presence cleared.');
    }
    shutdown() {
        this._presenceToSetWhenReady = undefined;
        if (!this._client) {
            electron_log_1.default.warn('[DiscordApi] [shutdown] Discord client not found.');
            return;
        }
        this._client.destroy();
        electron_log_1.default.info('[DiscordApi] [shutdown] Discord client destroyed.');
    }
}
exports.DiscordApi = DiscordApi;
//# sourceMappingURL=discord-api.js.map