'use strict';

class TeamData {

    constructor(db, active) {
        this.db = db;
        this.map = new Map();
        this.active = active;
        active.forEach((team, index) => this.map.set(team.teamid, {
            id: team.id,
            state: 'active',
            team: team
        }));
    }

    lookup(teamid, may_promise=true) {
        var team = this.map.get(teamid);
        if (typeof team != 'undefined') {
            if (team.state == 'pending') {
                return may_promise ? team.promise : null;
            }
            return team;
        }
        if (!may_promise) return null;
        team = {
            id: -1,
            state: 'pending',
        };
        this.map.set(teamid, team);
        team.promise = this.db.team_by_teamid(teamid).then(t => {
            delete team.promise;
            if (t == null) {
                team.state = 'unknown';
                return team;
            }
            team.id = t.id;
            if (t.started === null) {
                team.state = 'starting';
                return team;
            }
            if (t.finished !== null) {
                team.state = 'inactive';
                return team;
            } else {
                console.warn('TeamData', 'unexpected active team in database');
                team.state = 'active';
                team.team = t;
                return team;
            }
        });
        return team.promise;
    }

    active_teams_with_cursors() {
        return TeamData.add_team_cursors(this.active);
    }

    static async init(db) {
        return new this(db, await db.active_teams());
    }

    static add_team_cursors(teams, before) {
        var team_fields = ['id', 'name', 'started', 'finished'];
        var member_fields = ['member_id', 'name', 'identity', 'joined', 'parted', 'lat', 'lng', 'accuracy', 'time'];

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

            oteam.chat = this.add_chat_cursors(team.chats, team.id);

            out.data.push(oteam);
        }

        if (before && teams.length && !teams[teams.length-1].is_last_record) {
            out.links.older = ['/teams', {before: teams[teams.length-1].finished}];
        }

        return out;
    }

    static add_chat_cursors(chats, id, before) {
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
}

module.exports = TeamData;

function copy_fields(input, fields) {
    var output = {};
    for (let field of fields) {
        output[field] = input[field];
    }
    return output;
}
