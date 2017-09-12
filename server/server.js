'use strict';

const express = require('express');
const app = express();
const webroot = '../www/';
const max_payload = 2048;
const expressWs = require('express-ws')(app, null, {wsOptions: {maxPayload: max_payload}});
const wss = expressWs.getWss();
const config = require('./config');

const Db = require('./db');
const Connection = require('./connection');
const teamdata = require('./teamdata');

const auth_timeout = 30*1000;

const db = new Db(config.mysql);

var active;

app.use(express.static(webroot));

app.ws('/test', function (ws, req) {
    // todo check origin and disconnect if invalid
    console.log('socket', req.headers.origin);

    try {
        var conn = new Connection(ws);
        wait_for_auth(conn);
    } catch (e) {
        console.error(e);
    }
});

db.connect()
    .then(init_teams)
    .then(() => { app.listen(3000); })
    .catch(err => {
        console.error(err);
        db.disconnect();
    });

function wait_for_auth(conn) {
    conn.authenticated = false;
    conn.on('auth', authenticate);
    conn.timer(() => {
        if (conn.authenticated) return;
        conn.log('authentication timeout reached');
        conn.close(4401, 'No authentication received');
    }, auth_timeout);
}

function authenticate(data, conn) {
    // todo check token
    conn.log('got auth:', data);
    conn.authenticated = true;
    if (!conn.authenticated) {
        conn.close(4403, 'forbidden');
        return false;
    }

    grant_access(conn);
    // try to ensure that rpc-response arrives before push data
    conn.timer(function () {
        conn.subscribed = true;
        conn.push('/teams', teamdata.add_team_cursors(active));
    }, 50);

    return true;
}

function grant_access(conn) {
    conn.on('chat', message);
    conn.at('/teams', get_teams);
    conn.at(/^\/team\/([1-9][0-9]{0,8})\/chat/, get_team_chat);
}

async function init_teams() {
    active = await db.active_teams();
    console.log(require('util').inspect(active, false, null));
}

async function message(data, conn) {
    conn.warn('message() not implemented');
    return false;
}

async function get_teams(options, conn) {
    var before = null;
    for (let option in options) {
        let value = options[option];
        switch (option) {
            case 'before':
                if (value === 'now') {
                    before = 'now';
                } else if (typeof value == 'string' && !Number.isNaN(Date.parse(value))) {
                    before = new Date(value);
                } else {
                    return ['fail', 'invalid before= value'];
                }
                break;
            default:
                conn.warn('unknown option', option);
                return ['fail', 'unknown option'];
        }
    }
    if (before === null) {
        // active "/teams" are pushed after authentication, it shouldn't be requested manually
        return ['fail', 'not implemented'];
    }
    conn.log('getting teams before', before);
    var teams = await db.teams_before(before, 20);
    return teamdata.add_cursors(teams, before);
}

async function get_team_chat(options, conn, path, match) {
    // note regex in grant_access ensures we have a proper integer here
    var id = parseInt(match[1]);
    conn.warn('get_team_chat() not implemented');
    return false;
}
