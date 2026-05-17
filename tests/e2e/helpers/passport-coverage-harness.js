// @ts-check
const express = require('express');
const fs = require('fs');
const http = require('http');
const Module = require('module');
const os = require('os');
const path = require('path');
const v8 = require('v8');

const appRoot = path.resolve(__dirname, '../../..');
const passportConfigPath = path.join(appRoot, 'src/config/passport.js');
const userModelPath = path.join(appRoot, 'src/models/User.js');
const certPath = path.join(os.tmpdir(), `biocbot-passport-coverage-${process.pid}.pem`);
const app = express();

fs.writeFileSync(certPath, '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n');

/** @type {any} */
let captured;
let ubcStyle = 'missing';
let samlConstructorThrows = false;
let ubcConstructorThrows = false;

function resetCaptured() {
    captured = {
        strategies: {},
        serialize: null,
        deserialize: null,
        calls: [],
    };
}

resetCaptured();

class LocalStrategyMock {
    constructor(options, verify) {
        this.name = 'local';
        this.options = options;
        this.verify = verify;
    }
}

class SamlStrategyMock {
    constructor(options, verify) {
        if (samlConstructorThrows) {
            throw new Error('SAML constructor boom');
        }
        this.name = 'saml';
        this.options = options;
        this.verify = verify;
    }
}

class UbcStrategyMock {
    constructor(options, verify) {
        if (ubcConstructorThrows) {
            throw new Error('UBC constructor boom');
        }
        this.name = 'ubcshib';
        this.options = options;
        this.verify = verify;
    }
}

function helper(name) {
    return function passportCoverageHelper(req, res, next) {
        if (typeof next === 'function') next();
        return name;
    };
}

function makeUbcModule() {
    if (ubcStyle === 'missing') {
        throw new Error('Cannot find module passport-ubcshib');
    }
    if (ubcStyle === 'invalid') {
        return { noStrategyHere: true };
    }
    if (ubcStyle === 'direct') {
        return UbcStrategyMock;
    }
    if (ubcStyle === 'default') {
        return {
            default: {
                Strategy: UbcStrategyMock,
                ensureAuthenticated: helper('default-ensure'),
                logout: helper('default-logout'),
                conditionalAuth: helper('default-conditional'),
            },
        };
    }
    if (ubcStyle === 'named-no-helpers') {
        return { Strategy: UbcStrategyMock };
    }
    return {
        Strategy: UbcStrategyMock,
        ensureAuthenticated: helper('named-ensure'),
        logout: helper('named-logout'),
        conditionalAuth: helper('named-conditional'),
    };
}

const passportMock = {
    _strategies: captured.strategies,
    use(name, strategy) {
        captured.strategies[name] = strategy;
        this._strategies = captured.strategies;
        return this;
    },
    serializeUser(fn) {
        captured.serialize = fn;
    },
    deserializeUser(fn) {
        captured.deserialize = fn;
    },
};

const userMock = {
    async authenticateUser(db, username, password) {
        captured.calls.push({ method: 'authenticateUser', db, username, password });
        if (username === 'throw-local') {
            throw new Error('local auth boom');
        }
        if (password === 'correct-password') {
            return { success: true, user: { userId: 'local-user', username } };
        }
        return { success: false, error: 'Invalid credentials' };
    },

    async createOrGetSAMLUser(db, samlData) {
        captured.calls.push({ method: 'createOrGetSAMLUser', db, samlData });
        if (samlData.email === 'throw@test.local') {
            throw new Error('saml user boom');
        }
        if (samlData.email === 'fail@test.local') {
            return { success: false, error: 'SAML user rejected' };
        }
        return {
            success: true,
            user: {
                userId: `saml-${samlData.username}`,
                ...samlData,
            },
        };
    },

    async getUserById(db, userId) {
        captured.calls.push({ method: 'getUserById', db, userId });
        if (userId === 'throw-deserialize') {
            throw new Error('deserialize boom');
        }
        if (userId === 'missing-user') {
            return null;
        }
        return { userId, username: `user-${userId}` };
    },
};

const moduleWithLoad = /** @type {any} */ (Module);
const originalLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(request, parent, isMain) {
    const parentFile = parent && parent.filename;
    if (parentFile === passportConfigPath) {
        if (request === 'passport') return passportMock;
        if (request === 'passport-local') return { Strategy: LocalStrategyMock };
        if (request === 'passport-saml') return { Strategy: SamlStrategyMock };
        if (request === 'passport-ubcshib') return makeUbcModule();
        if (request === '../models/User' || path.resolve(path.dirname(parentFile), request) === userModelPath) {
            return userMock;
        }
    }
    return originalLoad.apply(this, [request, parent, isMain]);
};

const samlEnvKeys = [
    'SAML_ENTRY_POINT',
    'SAML_ISSUER',
    'SAML_CALLBACK_URL',
    'SAML_CERT_PATH',
    'SAML_PRIVATE_KEY',
    'SAML_PRIVATE_KEY_PATH',
    'SAML_SIGNATURE_ALGORITHM',
    'SAML_DIGEST_ALGORITHM',
    'SAML_CLOCK_SKEW_MS',
    'SAML_VALIDATE_IN_RESPONSE_TO',
    'SAML_DISABLE_REQUEST_ACS_URL',
    'SAML_ENVIRONMENT',
    'SAML_LOGOUT_URL',
    'ENABLE_SLO',
];

function applyEnv(env) {
    for (const key of samlEnvKeys) {
        delete process.env[key];
    }
    for (const [key, value] of Object.entries(env || {})) {
        if (value === null || value === undefined) continue;
        process.env[key] = value === '__CERT__' ? certPath : String(value);
    }
}

function normalizeDoneArgs(args) {
    const [err, user, info] = args;
    return {
        err: err ? { message: err.message || String(err) } : null,
        user: user || false,
        info: info || null,
    };
}

function flushCoverage() {
    try {
        v8.takeCoverage();
    } catch {
        // Best-effort coverage flush only.
    }
}

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
    }
    next();
});
app.use(express.json());

app.get('/__ping', (req, res) => {
    res.json({ ok: true });
});

app.post('/__load', (req, res) => {
    resetCaptured();
    passportMock._strategies = captured.strategies;
    ubcStyle = req.body.ubcStyle || 'missing';
    samlConstructorThrows = !!req.body.samlConstructorThrows;
    ubcConstructorThrows = !!req.body.ubcConstructorThrows;
    applyEnv(req.body.env || {});

    delete require.cache[passportConfigPath];

    const initializePassport = require(passportConfigPath);
    const configuredPassport = initializePassport({ name: 'coverage-db' });
    const helpers = configuredPassport.ubcShibHelpers || null;
    res.json({
        strategies: Object.keys(captured.strategies),
        localOptions: captured.strategies.local && captured.strategies.local.options,
        samlOptions: captured.strategies.saml && captured.strategies.saml.options,
        ubcOptions: captured.strategies.ubcshib && captured.strategies.ubcshib.options,
        helperTypes: helpers && {
            ensureAuthenticated: typeof helpers.ensureAuthenticated,
            logout: typeof helpers.logout,
            conditionalAuth: typeof helpers.conditionalAuth,
        },
    });
});

app.post('/__invoke/local', async (req, res) => {
    const strategy = captured.strategies.local;
    if (!strategy) return res.status(404).json({ error: 'local strategy missing' });
    const result = await new Promise((resolve) => {
        strategy.verify(req.body.username, req.body.password, (...args) => resolve(normalizeDoneArgs(args)));
    });
    res.json({ result, calls: captured.calls });
});

app.post('/__invoke/saml', async (req, res) => {
    const strategy = captured.strategies.saml;
    if (!strategy) return res.status(404).json({ error: 'saml strategy missing' });
    const result = await new Promise((resolve) => {
        strategy.verify(req.body.profile || {}, (...args) => resolve(normalizeDoneArgs(args)));
    });
    res.json({ result, calls: captured.calls });
});

app.post('/__invoke/ubcshib', async (req, res) => {
    const strategy = captured.strategies.ubcshib;
    if (!strategy) return res.status(404).json({ error: 'ubcshib strategy missing' });
    const result = await new Promise((resolve) => {
        strategy.verify(req.body.profile || {}, (...args) => resolve(normalizeDoneArgs(args)));
    });
    res.json({ result, calls: captured.calls });
});

app.post('/__serialize', async (req, res) => {
    const result = await new Promise((resolve) => {
        captured.serialize(req.body.user, (...args) => resolve(normalizeDoneArgs(args)));
    });
    res.json({ result });
});

app.post('/__deserialize', async (req, res) => {
    const result = await new Promise((resolve) => {
        captured.deserialize(req.body.userId, (...args) => resolve(normalizeDoneArgs(args)));
    });
    res.json({ result, calls: captured.calls });
});

app.get('/__state', (req, res) => {
    res.json({
        strategies: Object.keys(captured.strategies),
        calls: captured.calls,
    });
});

process.on('SIGTERM', () => {
    flushCoverage();
    server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
    flushCoverage();
    server.close(() => process.exit(0));
});

const port = Number(process.env.PASSPORT_HARNESS_PORT || 0);
const server = http.createServer(app);
server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    console.log(`[passport-coverage-harness] listening on ${actualPort}`);
});
