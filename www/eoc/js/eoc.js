// polyfills
if (!Array.isArray) { Array.isArray = function(arg) { return Object.prototype.toString.call(arg) === '[object Array]'; }; }
if (!Array.prototype.find) {
    Object.defineProperty(Array.prototype, 'find', {
        value: function(predicate) {
            if (this == null) throw new TypeError('"this" is null or not defined');
            var o = Object(this);
            var len = o.length >>> 0;
            if (typeof predicate !== 'function') throw new TypeError('predicate must be a function');
            var thisArg = arguments[1];
            for (var k=0; k < len; k++) {
                var kValue = o[k];
                if (predicate.call(thisArg, kValue, k, o)) return kValue;
            }
            return undefined;
        }
    });
}
if (!Array.prototype.findIndex) {
    Object.defineProperty(Array.prototype, 'findIndex', {
        value: function(predicate) {
            if (this == null) throw new TypeError('"this" is null or not defined');
            var o = Object(this);
            var len = o.length >>> 0;
            if (typeof predicate !== 'function') throw new TypeError('predicate must be a function');
            var thisArg = arguments[1];
            for (var k=0; k < len; k++) {
                var kValue = o[k];
                if (predicate.call(thisArg, kValue, k, o)) return k;
            }
            return -1;
        }
    });
}

// todo choose map centre more cleverly
var map = L.map('map', {attributionControl: false}).setView([-34.929, 138.601], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

var teams = {};
var teamorder = [];
var teamlinks = null;
var chatlog_onscroll_installed = false;

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

function connect_socket() {
    if (socket)
        return;

    socket = new WebSocket('ws://' + location.host + '/eoc-ws');

    socket.onmessage = handle_message;

    socket.onopen = authenticate;

    socket.onclose = function () {
        window.location.reload();
    };
}

// todo remove this delay
// only there to ensure FireFox web tools have a chance to see the WS connection
setTimeout(connect_socket, 1000);

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
            teams[id] = {chats: [], members: [], chatlinks: null, layergroup: L.layerGroup().addTo(map)};
        }
        console.log(team);
        for (var key in team) {
            if (!team.hasOwnProperty(key)) continue;
            if (key == 'id') continue;
            if (key == 'links') continue;
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
                new_chat_message(id, chat);
                continue;
            }
            teams[id][key] = team[key];
        }
        if ('members' in team) {
            var members = team['members'];
            for (var j=0; j<members.length; j++) {
                if (typeof members[j].joined == 'undefined') {
                    update_member(id, members[j]);
                } else {
                    new_member(id, members[j]);
                }
            }
        }
        if ('chat' in team) {
            var chats = team['chat'];
            new_chat_messages('ok', chats, id);
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

    var pos = append_sorted(teams[tid].chats, chat, cmp_chat, true);

    return pos;
}

function new_member(tid, member) {
    member = $.extend({}, member);
    var member_id = member.member_id;
    if (member.joined) member.joined = new Date(member.joined);
    if (member.parted) member.parted = new Date(member.parted);
    if (member.time)   member.time   = new Date(member.time);

    console.log('new member', tid, member);
    append_sorted(teams[tid].members, member, cmp_member);

    if (member.joined) {
        new_chat_message(tid, {type: Chat.TYPE_JOIN, time: new Date(member.joined), sender: member.member_id, id: 'join-'+member.member_id});
    }
    if (member.parted) {
        new_chat_message(tid, {type: Chat.TYPE_PART, time: new Date(member.parted), sender: member.member_id, id: 'part-'+member.member_id});
    }

    if (member.time && member.parted === null) {
        // have location and should show on map
        update_location(tid, member);
    }
}

function update_member(tid, update) {
    var member_id = update.member_id;

    var member = teams[tid].members.find(function (m) { return m.member_id == member_id; });
    if (typeof member == 'undefined') {
        console.warn('update_member: member not found', tid, member_id);
        return
    }

    if (update.joined) {
        console.warn('update_member: unexpected joined field in update', tid, update);
        return
    }
    if (update.parted) update.parted = new Date(update.parted);
    if (update.time)   update.time   = new Date(update.time);

    console.log('update member', tid, update);
    $.extend(member, update);

    if (update.parted) {
        new_chat_message(tid, {type: Chat.TYPE_PART, time: new Date(member.parted), sender: member.member_id, id: 'part-'+member.member_id});
    }

    if (update.time && member.parted === null) {
        // have location and should show on map
        update_location(tid, member);
    }
}

function update_location(tid, member) {
    var member_id = member.member_id;

    if (member.marker) {
        member.marker.setLatLng([member.lat, member.lng]);
        return
    }

    // first location for member, create new marker
    member.marker = L.marker([member.lat, member.lng]);
    var tooltip = function () {
        var timehtml = '<time class="abbreviated" datetime="'+member.time.toISOString()+'">' + elapsed(member.time) + '</time>';
        return member.name + ' (<b>' + teams[tid].name + '</b>, ' + timehtml +  ')';
    };
    member.marker.bindTooltip(tooltip);
    member.marker.on('click', function() { show_chat(tid, member_id); });
    member.marker.addTo(teams[tid].layergroup);
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
    node.off("click");
    node.click(function() { show_chat(id); });
    if (pos < 0) {
        console.error('id not found in teamorder');
    } else if (pos == 0) {
        node.prependTo('#teamlist');
    } else {
        node.insertAfter('#team-'+teamorder[pos-1]);
    }
}

function show_chat(id, memberid) {
    var team = teams[id];
    var haveall = (typeof team.chatlinks.older == 'undefined');
    var chatbox = $('#chat');
    if (chatbox.data('teamid') == ''+id) {
        chatbox.show();
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
    chatbox.find('#chatlog > div.msg').not('.template').remove();
    var spinner = chatbox.find('#chatlog > div.spinner');
    var chatlog = chatbox.find('#chatlog');
    spinner.hide();

    var shownotices = haveall;
    var lastid = null;
    for (var i=0; i<team.chats.length; i++) {
        var chat = team.chats[i];
        if (chat.type == Chat.TYPE_MESSAGE) {
            shownotices = true;
        } else if (!shownotices) {
            continue;
        }
        insert_chat_node(chat, id, lastid);
        lastid = chat.id;
    }

    if (!haveall) {
        spinner.show();
        if (!chatlog_onscroll_installed) {
            chatlog.scroll(check_chat_loader);
            chatlog_onscroll_installed = true;
        }
        setTimeout(check_chat_loader, 500);
    }

    chatbox.data('teamid', ''+id);
    chatbox.show();
    scroll_to_bottom(chatlog);

    var send = $('#send');
    var msg = $('#msg');

    msg.val('');

    send.off("click");
    send.click(function () {
        send_chat_message(id, msg);
    });
}

function insert_chat_node(chat, tid, lastid) {
    var chatlog = $('#chatlog');
    var node;
    if (chat.type == Chat.TYPE_MESSAGE) {
        if (chat.sender === 0) {
            node = chatlog.find('#msg-sent-template').clone();
        } else {
            node = chatlog.find('#msg-template').clone();
        }
    } else {
        node = chatlog.find('#msg-notice-template').clone();
    }
    node.removeClass('template').attr('id', 'chat-'+tid+'-'+chat.id);
    fill_chat_template(node, chat, tid);
    var prevdate = '';
    if (lastid !== null) {
        var prevnode = $('#chat-'+tid+'-'+lastid);
        if (prevnode.length == 0) {
            lastid = null;
        } else {
            prevdate = prevnode.find('div.date').text();
        }
    }
    var chatdate = node.find('div.date').text();
    if (chatdate != prevdate) {
        node.find('div.date').show();
        prevdate = chatdate;
    }
    if (lastid === null) {
        node.insertAfter(chatlog.find('div.spinner'));
    } else {
        node.insertAfter('#chat-'+tid+'-'+lastid);
    }
    var next = node.next();
    if (!next.hasClass('template') && chatdate == next.find('div.date').text()) {
        next.find('div.date').hide();
    }
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

function check_chat_loader() {
    var chatbox = $('#chat');
    if (!chatbox.is(':visible')) {
        return;
    }
    var spinner = chatbox.find('#chatlog > div.spinner');
    if (!element_in_view(spinner[0])) {
        return;
    }
    get_older_chats(parseInt(chatbox.data('teamid')));
}

function get_older_chats(tid) {
    if (!tid || !teams[tid]) return;
    if (typeof teams[tid].chatlinks.older != 'object') return;
    if (teams[tid].loading) return;
    teams[tid].loading = true;
    get(socket, teams[tid].chatlinks.older[0], teams[tid].chatlinks.older[1], function (s,d) {new_chat_messages(s, d, tid);});
    console.log('loading more chats', tid, teams[tid].chatlinks.older[0], teams[tid].chatlinks.older[1]);
}

function send_chat_message(tid, input) {
    var msg = input.val();
    if (typeof msg != 'string' || msg == '') return false;
    if (input.prop('disabled')) return false;

    input.prop('disabled', true);
    console.debug('sending chat message', tid, msg);
    rpc(socket, 'chat', [tid, msg], function (s, data) {
        input.prop('disabled', false);
        if (s == 'ok') {
            console.debug('send chat message ok');
            input.val('');
        } else {
            // todo do this more nicely
            console.debug('send chat message failed');
            alert('could not send message at this time');
        }
    });
    return true;
}

function new_chat_messages(s, chats, tid) {
    if (s != 'ok') {
        console.error('get new chat data', s, chats);
        // todo show error message or try again?
        return;
    }

    var hadall = teams[tid].chatlinks && (typeof teams[tid].chatlinks.older == 'undefined');

    var first_shown = -1;
    if (hadall && teams[tid].chats.length > 0) {
        first_shown = 0;
    } else {
        first_shown = teams[tid].chats.findIndex(function (c) { return c.type == Chat.TYPE_MESSAGE; });
    }

    if (chats.links) {
        teams[tid].chatlinks = chats.links;
    }

    // data set changes

    var inserted = [];
    for (var i=0; i<chats.data.length; i++) {
        var chat = chats.data[i];
        if (typeof chat.type == 'undefined') chat.type = Chat.TYPE_MESSAGE;
        var pos = new_chat(tid, chat);

        if (first_shown >= 0 && pos <= first_shown) first_shown++;
        for (var j=0; j<inserted.length; j++) {
            if (pos <= inserted[j]) inserted[j]++;
        }
        inserted.push(pos);
    }

    // FIXME split out UI handling

    // UI changes

    var chatbox = $('#chat');
    if (chatbox.data('teamid') != ''+tid) {
        return;
    }

    var haveall = (typeof teams[tid].chatlinks.older == 'undefined');

    if (haveall && !hadall) {
        $('#chatlog > div.spinner').hide();
    }

    var chatlog = chatbox.find('#chatlog');
    var atbottom = is_scrolled_to_bottom(chatlog);

    if (!teams[tid].chats.length) return;

    inserted.sort(function (a,b) {return a-b;});

    var start = (haveall || inserted.length == 0) ? 0 : inserted[0];
    if (first_shown < 0) first_shown = teams[tid].chats.length;

    for (var i=start; i<first_shown; i++) {
        var prev = (i == 0 ? null : teams[tid].chats[i-1].id);
        insert_chat_node(teams[tid].chats[i], tid, prev);
    }

    for (var i=0; i<inserted.length; i++) {
        var pos = inserted[i];
        if (pos < first_shown) continue;
        var prev = (pos == 0 ? null : teams[tid].chats[pos-1].id);
        insert_chat_node(teams[tid].chats[pos], tid, prev);
    }

    // let DOM settle before being able to load more content
    if (atbottom) {
        setTimeout(function () {scroll_to_bottom(chatlog);}, 50);
    }
    setTimeout(function () { teams[tid].loading = false; check_chat_loader(); }, 500);
}

function new_chat_message(tid, chat) {
    new_chat_messages('ok', {data: [chat]}, tid);
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
    if (!socket){
        return;
    }
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

    var m;

    if (path == '/teams') {
        new_teams(data);
    } else if ((m = path.match(/^\/team\/([0-9]+)$/))) {
        console.log('team data pushed', m[1], data);
        var teamdata = {data: [$.extend({id: parseInt(m[1])}, data.data)]};
        new_teams(teamdata);
    } else if ((m = path.match(/^\/team\/([0-9]+)\/member\/([0-9]+)$/))) {
        console.log('member data pushed', m[1], m[2], data);
        var teamdata = {data: [{id: parseInt(m[1]), members: [$.extend({}, data.data, {member_id: parseInt(m[2])})]}]};
        new_teams(teamdata);
    } else if ((m = path.match(/^\/team\/([0-9]+)\/chat\/([0-9]+)$/))) {
        console.log('chat data pushed', m[1], m[2], data);
        var teamdata = {data: [{id: parseInt(m[1]), chat: {data: [data.data]}}]};
        new_teams(teamdata);
    } else {
        console.error('unhandled push for path:', path, data);
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

function element_in_view(el) {
    var rect = el.getBoundingClientRect();
    var top = rect.top;
    var height = rect.height;
    do {
        el = el.parentNode;
        rect = el.getBoundingClientRect();
        if (top > rect.bottom) return false;
        // check if the element is out of view due to a container scrolling
        if ((top + height) <= rect.top) return false;
    } while (el.parentNode != document.body);
    // Check its within the document viewport
    return top <= document.documentElement.clientHeight;
}

function scroll_to_bottom(jq) {
    jq.scrollTop(jq.prop('scrollHeight'));
}

function is_scrolled_to_bottom(jq) {
    return (jq.prop('scrollHeight')-jq.scrollTop() == jq.prop('clientHeight'));
}
