// ensure Array.isArray is implemented
if (!Array.isArray) { Array.isArray = function(arg) { return Object.prototype.toString.call(arg) === '[object Array]'; }; }

var map = L.map('map', {attributionControl: false}).setView([-34.929, 138.601], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
var marker = L.marker([-34.9, 138.6]).addTo(map);

var teams = {};
var teamorder = [];
var teamlinks = null;

var Chat = function () {};
Chat.TYPE_MESSAGE = 0;
Chat.TYPE_JOIN = 1;
Chat.TYPE_PART = 2;
Chat.TYPE_START = 3;
Chat.TYPE_FINISH = 4;
Chat.sortorder = [3,1,2,0,4];

supportsWebSockets = 'WebSocket' in window || 'MozWebSocket' in window;
window.WebSocket = window.WebSocket || window.MozWebSocket;

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

function new_teams(t) {
    var now = new Date();
    var firstpush = false;
    if (t.links && t.links['self'] && t.links['self'][0] == '/teams') {
        if (teamlinks === null) firstpush = true;
        teamlinks = t.links;
    }

    for (var i=0; i<t.data.length; i++) {
        var team = t.data[i];
        var id = team.id;
        var newteam = false;
        if (!teams[id]) {
            newteam = true;
            teams[id] = {chats: [], members: [], chatlinks: null};
        }
        console.log(team);
        for (var key in team) {
            if (!team.hasOwnProperty(key)) continue;
            if (key == 'id') continue;
            if (key == 'chat' || key == 'members') {
                // handle after this loop
                continue;
            }
            if ((key == 'started' || key == 'finished') && team[key]) {
                teams[id][key] = new Date(team[key]);
                var chat = {};
                chat.type = (key == 'started') ? Chat.TYPE_START : Chat.TYPE_FINISH;
                chat.id = key;
                chat.time = new Date(teams[id][key]);
                new_chat(id, chat);
                continue;
            }
            teams[id][key] = team[key];
        }
        if ('members' in team) {
            var members = team['members'];
            for (var j=0; j<members.length; j++) {
                new_member(id, members[j]);
            }
        }
        if ('chat' in team) {
            var chats = team['chat'];
            if (chats.links) {
                teams[id].chatlinks = chats.links;
            }
            for (var j=0; j<chats.data.length; j++) {
                var chat = chats.data[j];
                chat.type = Chat.TYPE_MESSAGE;
                new_chat(id, chat);
            }
        }
        if (!newteam) {
            teams[id].lastpush = now;
        }
        team_update_order(id);
        team_ui(id);
    }

    if (firstpush) {
        $('#teams-loading').hide();
    }
}

function new_chat(tid, chat) {
    chat = $.extend({}, chat);
    chat.time = new Date(chat.time);
    if (typeof chat.sender == 'number' && chat.sender > 0) {
        chat.member = teams[tid].members.find(function (m) { return m.member_id == chat.sender; });
    }

    console.log('new chat', tid, chat);

    append_sorted(teams[tid].chats, chat, cmp_chat, true);
}

function new_member(tid, member) {
    member = $.extend({}, member);
    if (member.joined) member.joined = new Date(member.joined);
    if (member.parted) member.parted = new Date(member.parted);
    if (member.time)   member.time   = new Date(member.time);

    console.log('new member', tid, member);

    append_sorted(teams[tid].members, member, cmp_member);

    if (member.joined) {
        new_chat(tid, {type: Chat.TYPE_JOIN, time: new Date(member.joined), sender: member.member_id, id: 'join-'+member.member_id});
    }
    if (member.parted) {
        new_chat(tid, {type: Chat.TYPE_PART, time: new Date(member.parted), sender: member.member_id, id: 'part-'+member.member_id});
    }
}

function team_update_order(id) {
    var oldpos = teamorder.indexOf(id);
    if (oldpos >= 0) {
        teamorder.splice(oldpos, 1);
    }
    var cmp = function (a,b) { return cmp_team(teams[a], teams[b]); };
    var newpos = insert_sorted(teamorder, id, cmp, true);
    if (oldpos != newpos) {
        console.log('position of team '+id+' changed from '+oldpos+' to '+newpos);
    }
}

function team_ui(id) {
    console.log('update team ui for', id);
    var node = $('#team-'+id);
    var should_insert = false;
    var team = teams[id];
    if (node.length == 0) {
        node = $('#team-template').clone().removeClass('template').attr('id', 'team-'+id);
        should_insert = true;
    }
    node.find('.teamname').contents().first().each(function (idx, el) { el.textContent = team.name; });
    var members;
    if (team.finished) {
        node.removeClass('active').addClass('finished');
        members = team.members.map(function (m) {return m.name;}).join(', ');
    } else {
        node.removeClass('finished').addClass('active');
        members = team.members.filter(function (m) {return !m.parted;}).map(function (m) {return m.name;}).join(', ');
    }
    node.find('.teammembers').text(members);
    if (!team.chats.length) {
        node.find('.lastmsg').hide();
    } else {
        var chat = team.chats[team.chats.length-1];
        var lastmsg = node.find('.lastmsg');
        lastmsg.find('time').attr('datetime', chat.time.toISOString()).attr('title', chat.time.toString()).text(elapsed(chat.time));
        var sender;
        console.log(chat);
        if (chat.member) {
            sender = chat.member.name;
        } else if (chat.sender === 0) {
            sender = 'EOC';
        } else {
            sender = chat.sender;
        }
        switch (chat.type) {
            case Chat.TYPE_MESSAGE:
                lastmsg.find('.sender').text(sender).show();
                lastmsg.find('.message').text(chat.message).attr('class', 'message');
                lastmsg.show();
                break;
            case Chat.TYPE_JOIN:
                lastmsg.find('.sender').hide();
                lastmsg.find('.message').text(sender + ' joined the team').attr('class', 'message join');
                lastmsg.show();
                break;
            case Chat.TYPE_PART:
                lastmsg.find('.sender').hide();
                lastmsg.find('.message').text(sender + ' left the team').attr('class', 'message part');
                lastmsg.show();
                break;
            case Chat.TYPE_START:
                lastmsg.find('.sender').hide();
                lastmsg.find('.message').text('Team started').attr('class', 'message teamstart');
                lastmsg.show();
                break;
            case Chat.TYPE_FINISH:
                lastmsg.find('.sender').hide();
                lastmsg.find('.message').text('Team finished').attr('class', 'message teamfinish');
                lastmsg.show();
                break;
            default:
                lastmsg.hide();
        }
    }
    var pos = teamorder.indexOf(id);
    node.click(function() { show_chat(id); });
    if (pos < 0) {
        console.error('id not found in teamorder');
    } else if (pos == 0) {
        node.prependTo('#teamlist');
    } else {
        node.insertAfter('#team-'+teamorder[pos-1]);
    }
}

function show_chat(id) {
    var team = teams[id];
    var chatbox = $('#chat');
    if (chatbox.data('teamid') == ''+id) {
        console.log('already showing team', id);
        return;
    }
    chatbox.find('.card-header').text(team.name);
    chatbox.find('#members li').not('.template').remove();
    for (var i=0; i<team.members.length; i++) {
        var member = team.members[i];
        if (team.finished === null && member.parted !== null) {
            // only show active members of active team
            // todo: maybe present parted members separately?
            continue;
        }
        var li = chatbox.find('#member-template').clone().removeClass('template').attr('id', 'member-'+member.member_id);
        if (member.member_id == 1) {
            li.addClass('leader');
        }
        li.text(member.name);
        li.data('id', member.member_id);
        li.insertBefore('#member-template');
    }
    chatbox.find('#chatlog > div').not('.template').remove();
    var lastdate = '';
    for (var i=0; i<team.chats.length; i++) {
        var chat = team.chats[i];
        var node;
        if (chat.type == Chat.TYPE_MESSAGE) {
            if (chat.sender === 0) {
                node = chatbox.find('#msg-sent-template').clone();
            } else {
                node = chatbox.find('#msg-template').clone();
            }
        } else {
            node = chatbox.find('#msg-notice-template').clone();
        }
        node.removeClass('template').attr('id', 'chat-'+id+'-'+chat.id);
        fill_chat_template(node, chat, id);
        var chatdate = chat.time.toDateString();
        if (chatdate != lastdate) {
            node.find('div.date').show();
            lastdate = chatdate;
        }
        if (i == 0) {
            node.prependTo('#chatlog');
        } else {
            node.insertAfter('#chat-'+id+'-'+team.chats[i-1].id);
        }
    }
    chatbox.data('teamid', ''+id);
    chatbox.show();
}

function fill_chat_template(node, chat, tid) {
    var sender;
    var cls;
    var notice;

    if (chat.member) {
        sender = chat.member.name;
    } else if (chat.sender === 0) {
        sender = 'EOC';
    } else {
        sender = chat.sender;
    }

    switch (chat.type) {
        case Chat.TYPE_MESSAGE:
            cls = 'chat-message';
            break;
        case Chat.TYPE_JOIN:
            cls = 'chat-join';
            notice = sender + ' joined the team';
            break;
        case Chat.TYPE_PART:
            cls = 'chat-part';
            notice = sender + ' left the team';
            break;
        case Chat.TYPE_START:
            cls = 'chat-start';
            notice = 'Team started';
            break;
        case Chat.TYPE_FINISH:
            cls = 'chat-finish';
            notice = 'Team finished';
            break;
        default:
            console.error('Unexpected chat message type', chat.type);
            return;
    }

    if (notice) {
        node.find('.notice').text(notice).show();
        node.find('.sender').hide();
        node.find('.message').hide();
    } else {
        node.find('.notice').hide();
        node.find('.sender').text(sender).show();
        node.find('.message').text(chat.message).show();
    }

    var timenodes = node.find('time.abbreviated');
    if (timenodes.length) {
        timenodes.attr('datetime', chat.time.toISOString()).attr('title', chat.time.toString()).text(elapsed(chat.time));
    }
    timenodes = node.find('time.date');
    if (timenodes.length) {
        var d = new Date(chat.time);
        d.setHours(0,0,0,0);
        timenodes.attr('datetime', d.toISOString()).attr('title', null).text(fulldate(d));
    }
    timenodes = node.find('time.time');
    if (timenodes.length) {
        timenodes.attr('datetime', chat.time.toISOString()).attr('title', chat.time.toString()).text(shorttime(chat.time));
    }

    node.addClass(cls);
}

function cmp_chat(a, b) {
    atime = a.time.getTime();
    btime = b.time.getTime();
    if (atime < btime) {
        return -1;
    } else if (atime > btime) {
        return 1;
    } else if (a.type != b.type) {
        return Chat.sortorder[a.type] - Chat.sortorder[b.type];
    } else {
        return (a.id < b.id) ? -1 : ((a.id == b.id) ? 0 : 1);
    }
}

function cmp_member(a, b) {
    // team leader should appear first
    if (a.member_id == 1) return -1;
    if (b.member_id == 1) return 1;
    // otherwise alphabetical
    if (a.name < b.name) {
        return -1;
    } else if (a.name > b.name) {
        return 1;
    } else if (typeof a.identity != 'string' || typeof b.identity != 'string' || a.identity == b.identity) {
        return (a.member_id < b.member_id) ? -1 : ((a.member_id == b.member_id) ? 0 : 1);
    } else if (a.identity < b.identity) {
        return -1;
    } else {
        return 1;
    }
}

function cmp_team(a, b) {
    console.log('comparing teams', a, b);
    // finished teams appear last
    if (a.finished === null && b.finished !== null) {
        return -1;
    } else if (a.finished !== null && b.finished === null) {
        return 1;
    }
    if (!a.chats.length || !b.chats.length) {
        return -1 * (a.id - b.id);
    }
    var atime = (a.lastpush || a.chats[a.chats.length-1].time).getTime();
    var btime = (b.lastpush || b.chats[b.chats.length-1].time).getTime();
    if (atime == btime) {
        return -1 * (a.id - b.id);
    } else {
        return -1 * (atime - btime);
    }
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
    } else if (Array.isArray(json) && json[0] === 'push' && json.length == 3) {
        handle_push(json);
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

function handle_push(json) {
    var path = json[1];
    var data = json[2];

    if (typeof path != 'string') {
        console.log('Malformed push message');
        return;
    }

    if (path == '/teams') {
        new_teams(data);
    }
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

function append_sorted(a, item, cmp, trylast) {
    // modified binary search - final value of low will be insert index
    var low = 0;
    var high = a.length - 1;

    if (trylast && high >= 0) {
        // hinted that item should likely go after all others
        var c = cmp(item, a[high]);
        if (c >= 0) {
            low = high+1;
        }
    }

    while (low <= high) {
        var mid = low + high >> 1;
        var c = cmp(item, a[mid]);
        if (c < 0) {
            high = mid-1;
        } else {
            // both if c > 0 and c == 0
            // for the latter, this ensures item is appended after all items to which it is equal
            low = mid+1;
        }
    }

    a.splice(low, 0, item);
    return low;
}

function insert_sorted(a, item, cmp, tryfirst) {
    // modified binary search - final value of low will be insert index
    var low = 0;
    var high = a.length - 1;

    if (tryfirst && low < a.length) {
        // hinted that item should likely go before all others
        var c = cmp(item, a[low]);
        if (c <= 0) {
            high = low-1;
        }
    }

    while (low <= high) {
        var mid = low + high >> 1;
        var c = cmp(item, a[mid]);
        if (c <= 0) {
            // both if c < 0 and c == 0
            // for the latter, this ensures item is inserted before all items to which it is equal
            high = mid-1;
        } else {
            low = mid+1;
        }
    }

    a.splice(low, 0, item);
    return low;
}

var Date_days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var Date_months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul',' Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var Date_showampm = /(am|pm)/.test(new Date().toLocaleTimeString());
var Date_showAMPM = /(AM|PM)/.test(new Date().toLocaleTimeString());

function elapsed(date) {
    var duration = (Date.now() - date.getTime())/1000;
    if (duration < 90) {
        return 'now';
    } else if (duration < 55*60) {
        return Math.round(duration/60)+' min';
    } else if (duration < 23*3600) {
        return Math.round(duration/3600)+' hr';
    } else if (duration < 7*24*3600) {
        return Date_days[date.getDay()];
    } else if (duration < 300*24*3600) {
        return date.getDate()+' '+Date_months[date.getMonth()];
    } else {
        return date.getDate()+' '+Date_months[date.getMonth()]+' '+date.getFullYear();
    }
}

function fulldate(date) {
    // FIXME Date.toLocaleDateString() should work but seemingly does not work properly on Firefox
    return Date_days[date.getDay()]+' '+date.getDate()+' '+Date_months[date.getMonth()]+' '+date.getFullYear();
}

function shorttime(date) {
    // FIXME Date.toLocaleTimeString() should work with appropriate options but is not well supported
    var hour = date.getHours();
    var min = date.getMinutes();
    var pm = false;
    if (Date_showampm || Date_showAMPM) {
        if (hour >= 12) {
            hour -= 12;
            pm = true;
        }
        if (hour == 0) hour = 12;
    }
    if (hour < 10) hour = '0' + hour;
    if (min < 10) min = '0' + min;
    if (Date_showampm) {
        return hour + ':' + min + ' ' + (pm ? 'pm' : 'am');
    } else if (Date_showAMPM) {
        return hour + ':' + min + ' ' + (pm ? 'PM' : 'AM');
    } else {
        return hour + ':' + min;
    }
}
