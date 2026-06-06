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
exports.runSpotifyAuthFlow = exports.cancelSpotifyAuthFlow = exports.refreshAccessToken = exports.SPOTIFY_REDIRECT_URI = void 0;
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
const electron_1 = require("electron");
const http = require("http");
const crypto = require("crypto");
const url = require("url");
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
let activeFlowCancel;
const REDIRECT_HOST = '127.0.0.1';
const REDIRECT_PORT = 8888;
const REDIRECT_PATH = '/spotify-callback';
exports.SPOTIFY_REDIRECT_URI = `http://${REDIRECT_HOST}:${REDIRECT_PORT}${REDIRECT_PATH}`;
const SCOPES = ['playlist-read-private', 'playlist-read-collaborative', 'user-library-read'].join(' ');
function base64UrlEncode(buffer) {
    return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function createPkcePair() {
    const verifier = base64UrlEncode(crypto.randomBytes(48));
    const challenge = base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
    return { verifier, challenge };
}
function successHtml() {
    return `<!doctype html><html><head><meta charset="utf-8"><title>Spotify connected</title>
<style>body{font-family:-apple-system,Segoe UI,sans-serif;background:#121212;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
.card{text-align:center;padding:32px 48px;}h1{color:#1db954;margin:0 0 12px 0;}p{opacity:.8;}</style></head>
<body><div class="card"><h1>Connected</h1><p>You can close this window and return to Dopamine.</p></div></body></html>`;
}
function errorHtml(message) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>Spotify error</title>
<style>body{font-family:-apple-system,Segoe UI,sans-serif;background:#121212;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
.card{text-align:center;padding:32px 48px;}h1{color:#e22134;margin:0 0 12px 0;}p{opacity:.8;}</style></head>
<body><div class="card"><h1>Authorization failed</h1><p>${message}</p></div></body></html>`;
}
function exchangeCodeForTokens(clientId, code, verifier) {
    return __awaiter(this, void 0, void 0, function* () {
        const body = new url.URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: exports.SPOTIFY_REDIRECT_URI,
            client_id: clientId,
            code_verifier: verifier,
        }).toString();
        const response = yield tokenPost(body);
        return parseTokenResponse(response);
    });
}
function refreshAccessToken(clientId, refreshToken) {
    return __awaiter(this, void 0, void 0, function* () {
        const body = new url.URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId,
        }).toString();
        const response = yield tokenPost(body);
        const parsed = parseTokenResponse(response);
        if (parsed.refreshToken.length === 0) {
            parsed.refreshToken = refreshToken;
        }
        return parsed;
    });
}
exports.refreshAccessToken = refreshAccessToken;
function tokenPost(body) {
    return new Promise((resolve, reject) => {
        const req = require('https').request({
            method: 'POST',
            hostname: 'accounts.spotify.com',
            path: '/api/token',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body),
            },
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                var _a, _b;
                const raw = Buffer.concat(chunks).toString('utf-8');
                try {
                    const json = JSON.parse(raw);
                    if (res.statusCode < 200 || res.statusCode >= 300) {
                        reject(new Error((_b = (_a = json.error_description) !== null && _a !== void 0 ? _a : json.error) !== null && _b !== void 0 ? _b : `HTTP ${res.statusCode}`));
                        return;
                    }
                    resolve(json);
                }
                catch (e) {
                    reject(new Error(`Invalid token response: ${raw.slice(0, 200)}`));
                }
            });
        });
        req.on('error', (e) => reject(e));
        req.write(body);
        req.end();
    });
}
function parseTokenResponse(json) {
    const accessToken = typeof json.access_token === 'string' ? json.access_token : '';
    const refreshToken = typeof json.refresh_token === 'string' ? json.refresh_token : '';
    const expiresInSec = typeof json.expires_in === 'number' ? json.expires_in : 3600;
    if (accessToken.length === 0) {
        throw new Error('No access_token returned');
    }
    return {
        accessToken,
        refreshToken,
        // Refresh a minute early to avoid edge-case expirations.
        expiresAt: Date.now() + (expiresInSec - 60) * 1000,
    };
}
function cancelSpotifyAuthFlow() {
    if (activeFlowCancel != undefined) {
        activeFlowCancel();
    }
}
exports.cancelSpotifyAuthFlow = cancelSpotifyAuthFlow;
function runSpotifyAuthFlow(clientId) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!clientId || clientId.length === 0) {
            throw new Error('Spotify client ID is not configured');
        }
        if (activeFlowCancel != undefined) {
            activeFlowCancel();
        }
        const { verifier, challenge } = createPkcePair();
        const state = base64UrlEncode(crypto.randomBytes(16));
        const authUrl = new URL('https://accounts.spotify.com/authorize');
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('redirect_uri', exports.SPOTIFY_REDIRECT_URI);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        authUrl.searchParams.set('code_challenge', challenge);
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('scope', SCOPES);
        let server;
        let timeoutHandle;
        let settled = false;
        return new Promise((resolve, reject) => {
            const cleanup = () => {
                if (timeoutHandle) {
                    clearTimeout(timeoutHandle);
                    timeoutHandle = undefined;
                }
                if (server) {
                    try {
                        server.close();
                    }
                    catch (_a) {
                        // ignore
                    }
                    server = undefined;
                }
                if (activeFlowCancel === cancelFn) {
                    activeFlowCancel = undefined;
                }
            };
            const settle = (fn) => {
                if (settled)
                    return;
                settled = true;
                fn();
                cleanup();
            };
            const cancelFn = () => settle(() => reject(new Error('Authorization cancelled')));
            activeFlowCancel = cancelFn;
            server = http.createServer((req, res) => {
                if (!req.url) {
                    res.statusCode = 400;
                    res.end();
                    return;
                }
                const parsed = url.parse(req.url, true);
                if (parsed.pathname !== REDIRECT_PATH) {
                    res.statusCode = 404;
                    res.end();
                    return;
                }
                const returnedState = typeof parsed.query.state === 'string' ? parsed.query.state : '';
                const code = typeof parsed.query.code === 'string' ? parsed.query.code : '';
                const error = typeof parsed.query.error === 'string' ? parsed.query.error : '';
                if (returnedState !== state) {
                    res.statusCode = 400;
                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    res.end(errorHtml('State mismatch — possible CSRF.'));
                    settle(() => reject(new Error('State mismatch')));
                    return;
                }
                if (error.length > 0) {
                    res.statusCode = 400;
                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    res.end(errorHtml(error));
                    settle(() => reject(new Error(error)));
                    return;
                }
                if (code.length === 0) {
                    res.statusCode = 400;
                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    res.end(errorHtml('No authorization code returned.'));
                    settle(() => reject(new Error('No code')));
                    return;
                }
                res.statusCode = 200;
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.end(successHtml());
                exchangeCodeForTokens(clientId, code, verifier)
                    .then((tokens) => settle(() => resolve(tokens)))
                    .catch((err) => settle(() => reject(err)));
            });
            server.on('error', (err) => settle(() => reject(err)));
            server.listen(REDIRECT_PORT, REDIRECT_HOST, () => {
                timeoutHandle = setTimeout(() => {
                    settle(() => reject(new Error('Authorization timed out. Please try again.')));
                }, AUTH_TIMEOUT_MS);
                electron_1.shell.openExternal(authUrl.toString()).catch((err) => settle(() => reject(err)));
            });
        });
    });
}
exports.runSpotifyAuthFlow = runSpotifyAuthFlow;
//# sourceMappingURL=spotify-auth.js.map