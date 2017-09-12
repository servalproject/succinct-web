// ensure Array.isArray is implemented
if (!Array.isArray) { Array.isArray = function(arg) { return Object.prototype.toString.call(arg) === '[object Array]'; }; }

var map = L.map('map', {attributionControl: false}).setView([-34.929, 138.601], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
var marker = L.marker([-34.9, 138.6]).addTo(map);

supportsWebSockets = 'WebSocket' in window || 'MozWebSocket' in window;

if (!supportsWebSockets) {
    // todo handle more gracefully
    alert('Please use a browser with support for WebSockets.');
}

var socket;

// todo remove this delay
// only there to ensure FireFox web tools have a chance to see the WS connection
setTimeout(function () {
    socket = new WebSocket('ws://' + location.host + '/test');

    socket.onmessage = handle_message;

    socket.onopen = function () {
        authenticate();
    };
}, 1000);

function authenticate() {
    // todo send real authentication token
    var token = 'abc123';
    rpc(socket, 'auth', {'token': token}, function (s, data) {
        if (s != 'ok') {
            alert('Authentication failed');
            return;
        }
    });
}

function rpc(socket, cmd, data, callback) {
    if (!rpc.initialised) {
        rpc.callbacks = [];
        rpc.nextid = 1;
        rpc.initialised = true;
    }
    var payload = [cmd, data, rpc.nextid];
    rpc.callbacks.push([rpc.nextid, callback]);
    rpc.nextid++;
    socket.send(JSON.stringify(payload));
}

function get(socket, path, options, callback) {
    return rpc(socket, 'get', [path, options], callback);
}

function handle_message(message) {
    var json = parse_json(message.data);
    if (Array.isArray(json) && json[0] === 'rpc-response' && json.length == 4) {
        handle_rpc_response(json);
    } else {
        console.log('Unrecognised message type');
        console.log(json);
    }
}

function handle_rpc_response(json) {
    if (!rpc.initialised) {
        console.log('Got RPC response before RPC calls made');
        return;
    }
    var id = json[1];
    var s = json[2];
    var data = json[3];
    if (typeof id != 'number' || typeof s != 'string') {
        console.log('Malformed RPC response');
        return;
    }
    for (var i=0; i<rpc.callbacks.length; i++) {
        if (rpc.callbacks[i][0] == id) {
            var callback = rpc.callbacks[i][1];
            rpc.callbacks.splice(i--, 1);
            callback(s, data);
            return;
        }
    }
    console.log('No callback found for RPC response');
    console.log(json);
}

// ignore errors thrown in JSON.parse
function parse_json(json) {
    var parsed;
    try {
        parsed = JSON.parse(json);
    } catch (e) {
    }
    return parsed;
}
