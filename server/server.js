'use strict';

const WebSocket = require('ws');

const config = require('./config');
const Db = require('./db');
const Connection = require('./connection');
const TeamData = require('./teamdata');
const MsgQueue = require('./msgqueue');

const db = new Db(config.mysql);

var wss;
var teamdata;
var msgqueue;

db.connect()
    .then(init_teamdata)
    .then(() => {
        wss = new WebSocket.Server({ port: config.ws_port, maxPayload: config.max_payload});
        wss.on('connection', function (ws, req) {
            try {
                var conn = new Connection(ws);
                wait_for_auth(conn);
            } catch (e) {
                console.error(e);
            }
        });

        msgqueue = new MsgQueue(teamdata, config.json_dir);
    })
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
    }, config.auth_timeout);
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
        conn.push('/teams', teamdata.active_teams_with_cursors());
    }, 50);

    return true;
}

function grant_access(conn) {
    conn.on('chat', message);
    conn.at('/teams', get_teams);
    conn.at(/^\/team\/([1-9][0-9]{0,8})\/chat/, get_team_chat);
}

async function init_teamdata() {
    teamdata = await TeamData.init(db);
    console.log(require('util').inspect(teamdata.active, false, null));
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
                conn.warn('unknown option for /teams', option);
                return ['fail', 'unknown option'];
        }
    }
    if (before === null) {
        // active "/teams" are pushed after authentication, it shouldn't be requested manually
        return ['fail', 'not implemented'];
    }
    conn.log('getting teams before', before);
    var teams = await db.teams_before(before, 20);
    return TeamData.add_team_cursors(teams, before);
}

async function get_team_chat(options, conn, path, match) {
    // note regex in grant_access ensures we have a proper integer here
    var id = parseInt(match[1]);
    var before = null;
    for (let option in options) {
        let value = options[option];
        switch (option) {
            case 'before':
                if (typeof value == 'string' && !Number.isNaN(Date.parse(value))) {
                    before = new Date(value);
                } else {
                    return ['fail', 'invalid before= value'];
                }
                break;
            default:
                conn.warn('unknown option for /team/<id>/chat', option);
                return ['fail', 'unknown option'];
        }
    }
    if (before === null) {
        // published with team data, shouldn't be requested manually
        return ['fail', 'not implemented'];
    }
    conn.log('getting chats for team '+id+' before', before);
    var chats = await db.chats_before(id, before, 20);
    return TeamData.add_chat_cursors(chats, id, before);
}
