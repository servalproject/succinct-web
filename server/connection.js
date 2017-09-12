'use strict';

var nconnections = 0;
var connmap = new WeakMap();

class Connection {
    constructor(ws, req, path) {
        this.ws = ws;
        this.timers = new Set();
        this.rpc_handlers = {};
        this.paths = new Map();

        this.id = this.gen_id();
        this.log('Setting up connection')

        this.on('get', this.default_get_handler);

        ws.on('close', this.on_close.bind(this));
        ws.on('error', this.on_error.bind(this));
        ws.on('message', this.on_message.bind(this));

        // finally, after construction, add to map
        connmap.set(ws, this);
    }

    on_close() {
        this.timers.forEach(timer => clearTimeout(timer));
        this.timers.clear();
        this.log('WebSocket was closed');
    }

    on_error(e) {
        this.error(e);
    }

    on_message(message) {
        var json = parse_json(message);
        if (!is_valid_rpc(json)) {
            this.log('received invalid message');
            return;
        }
        var [cmd, data, id] = json;
        if (typeof this.rpc_handlers[cmd] == 'function') {
            this.handle_rpc(this.rpc_handlers[cmd], cmd, data, id);
        } else {
            this.log('unknown rpc:', json);
            var done = this.new_done_callback(id);
            done('fail', 'unknown rpc command or lack of authorisation');
        }
    }

    on(cmd, callback) {
        this.rpc_handlers[cmd] = callback;
    }

    at(path, callback) {
        if (!(typeof path == 'string' || typeof path == 'function' || path instanceof RegExp)) {
            throw new Error('unknown path type', path);
        }
        this.paths.set(path, callback);
    }

    async push(path, data) {
        var payload = ['push', path, data];
        await this.send(payload);
    }

    timer(callback, delay, ...args) {
        var conn = this;
        var t;
        t = setTimeout(function () {
            conn.timers.delete(t);
            callback(...args);
        }, delay);
        this.timers.add(t);
    }

    async handle_rpc(handler, cmd, data, id) {
        var done = this.new_done_callback(id);
        try {
            var result = await handler(data, this);
            if (typeof result == 'boolean') {
                if (result) {
                    await done('ok');
                } else {
                    await done('fail');
                }
            } else if (Array.isArray(result) && result.length == 2) {
                await done(result[0], result[1]);
            } else {
                await done('ok', result);
            }
        } catch (e) {
            this.error(e);
        }
    }

    new_done_callback(id) {
        var conn = this;
        return async function (s, data) {
            var payload = ['rpc-response', id, s, data];
            return await conn.send(payload);
        };
    }

    send(data) {
        if (this.ws.readyState == this.ws.CLOSING || this.ws.readyState == this.ws.CLOSED) {
            this.warn('could not send data as socket is closing/closed.');
            return;
        }
        if (typeof data == 'object') {
            return this.ws.send(JSON.stringify(data));
        } else {
            return this.ws.send(data);
        }
    }

    default_get_handler(data, conn) {
        conn.log('get', data);
        if (!Array.isArray(data) || data.length < 1 || data.length > 2
                || typeof data[0] != 'string' || data[0].length == 0
                || (data.length == 2 && typeof data[1] != 'object')) {
            return ['fail', 'invalid request'];
        }
        var path = data[0];
        var options = {};
        if (data.length == 2) options = data[1];
        for (let [pathmatch, handler] of conn.paths) {
            if (typeof pathmatch == 'string' && path == pathmatch) {
                return handler(options, conn, path);
            } else if (typeof pathmatch == 'function' && pathmatch(path)) {
                return handler(options, conn, path);
            } else if (pathmatch instanceof RegExp && pathmatch.test(path)) {
                return handler(options, conn, path, pathmatch.exec(path));
            }
        }
        conn.log('unknown path', path);
        return ['fail', 'not found or lack of authorisation'];
    }

    close(code, msg) {
        if (this.ws.readyState == this.ws.CLOSING || this.ws.readyState == this.ws.CLOSED) return;
        this.ws.close(code, msg);
    }

    gen_id() {
        nconnections++;
        return '#' + nconnections;
    }

    log(...args) {
        console.log(this.id, ...args);
    }

    warn(...args) {
        console.warn(this.id, ...args);
    }

    error(...args) {
        console.error(this.id, ...args);
    }
}

module.exports = Connection;

// ignore errors thrown in JSON.parse
function parse_json(json) {
    var parsed;
    try {
        parsed = JSON.parse(json);
    } catch (e) {
    }
    return parsed;
}

function is_valid_rpc(data) {
    return (Array.isArray(data)
        && data.length == 3
        && typeof data[0] == 'string'
        && data[0].length > 0
        && Number.isInteger(data[2]));
}
