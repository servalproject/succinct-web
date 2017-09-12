'use strict';

function add_team_cursors(teams, before) {
    var team_fields = ['id', 'name', 'started', 'finished'];
    var member_fields = ['member_id', 'name', 'identity', 'joined', 'parted', 'lat', 'lng', 'accuracy', 'time'];
    var chat_fields = ['id', 'time', 'sender', 'message'];

    var out = {
        data: [],
        links: {}
    };

    if (typeof before == 'string') {
        out.links['self'] = ['/teams', {before: before}];
    } else if (before instanceof Date) {
        out.links['self'] = ['/teams', {before: before.toISOString()}];
    } else {
        out.links['self'] = ['/teams', {}];
        out.links['older'] = ['/teams', {before: 'now'}];
    }

    for (let team of teams) {
        let oteam = copy_fields(team, team_fields);
        oteam.members = [];
        for (let member of team.members) {
            oteam.members.push(copy_fields(member, member_fields));
        }
        oteam.chat = {
            data: [],
            links: {
                'self': ['/team/'+team.id+'/chat', {}],
            }
        };
        for (let chat of team.chats) {
            oteam.chat.data.push(copy_fields(chat, chat_fields));
        }
        if (team.chats.length && !team.chats[team.chats.length-1].is_last_record) {
            oteam.chat.links.older = ['/team/'+team.id+'/chat', {before: team.chats[team.chats.length-1].time}];
        }
        out.data.push(oteam);
    }

    if (before && teams.length && !teams[teams.length-1].is_last_record) {
        out.links.older = ['/teams', {before: teams[teams.length-1].finished}];
    }

    return out;
}

function add_chat_cursors(chats, id, before) {
    var chat_fields = ['id', 'time', 'sender', 'message'];

    var out = {
        data: [],
        links: {
            'self': ['/team/'+id+'/chat', {}]
        }
    };

    if (before instanceof Date) {
        out.links['self'][1].before = before.toISOString();
    }

    chats.forEach(chat => out.data.push(copy_fields(chat, chat_fields)));

    if (chats.length && !chats[chats.length-1].is_last_record) {
        out.links.older = ['/team/'+id+'/chat', {before: chats[chats.length-1].time}];
    }

    return out;
}

module.exports = {
    add_team_cursors: add_team_cursors,
    add_chat_cursors: add_chat_cursors
};

function copy_fields(input, fields) {
    var output = {};
    for (let field of fields) {
        output[field] = input[field];
    }
    return output;
}
