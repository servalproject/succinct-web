'use strict';

class TeamData {

    constructor(db, active) {
        this.db = db;
        this.map = new Map();
        this.active = active;
        active.forEach((team, index) => this.map.set(team.teamid, {
            id: team.id,
            state: 'active',
            team: team,
            members: membercache(team.members),
            epoch: Date.parse(team.started)
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
            members: {}
        };
        this.map.set(teamid, team);
        return update_team_promise(this.db, teamid, team);
    }

    async lookup_member(teamid, member) {
        var team = await this.lookup(teamid);
        if (team.members[member] instanceof Promise) {
            await team.members[member];
        }
        if (typeof team.members[member] == 'object') {
            return team.members[member];
        }
        if (team.id < 0) {
            console.warn('Cannot lookup member of team with no ID in database', teamid+'/'+member);
            team.members[member] = null;
        } else {
            let done;
            team.members[member] = new Promise((resolve, reject) => { done = resolve; });
            let m = await this.db.member_by_pos(team.id, member);
            if (m === null) {
                team.members[member] = null;
            } else {
                let cache = membercache([m]);
                Object.assign(team.members, cache);
            }
            done();
        }
        return team.members[member];
    }

    async start(teamid, name, time) {
        var team = await this.lookup(teamid);
        if (!(team.state == 'unknown' || team.state == 'starting'))
            throw new Error('unexpected team state for start: '+team.state);

        var done;
        team.state = 'pending';
        team.promise = new Promise((resolve, reject) => { done = resolve; });

        await this.db.team_start(teamid, name, time);
        await update_team_promise(this.db, teamid, team, false, true);
        if (team.state != 'active') {
            console.error('team not registered properly as started', teamid);
        }
        console.log('adding active team', team);
        this.active.push(team.team);
        done(team);
    }

    async end(teamid, time) {
        throw new Error('TeamData.end() not implemented yet');
    }

    async add_location(teamid, member, lat, lng, acc, time) {
        var team = await this.lookup(teamid);
        if (!(team.state == 'active' || team.state == 'inactive'))
            throw new Error('unexpected team state for add_location: '+team.state);

        var m = await this.lookup_member(teamid, member);
        if (m === null) {
            // unknown team member, just insert anyway
            console.warn('add_location: unknown team member, inserting new location anyway');
            await this.db.update_location(team.id, member, lat, lng, acc, time, false);
            return;
        }

        var islatest;
        if (m.last_location === null) {
            islatest = true;
        } else {
            if (m.last_location_time === null) {
                let lastfix = await this.db.location_time(m.last_location);
                if (lastfix === null) {
                    throw new Error('Could not get location timestamp for id', m.last_location);
                }
                m.last_location_time = lastfix.getTime();
            }
            if (time === m.last_location_time) {
                console.warn('Timestamp collision in add_location, ignoring new location');
                return;
            }
            islatest = (time > m.last_location_time);
        }
        var locid = await this.db.update_location(team.id, member, lat, lng, acc, time, islatest);
        if (islatest) {
            m.last_location = locid;
            m.last_location_time = time;
        }
    }

    async join(teamid, member, name, id, time) {
        var team = await this.lookup(teamid);
        if (!(team.state == 'active' || team.state == 'inactive'))
            throw new Error('unexpected team state for join: '+team.state);

        var m = await this.lookup_member(teamid, member);
        if (m !== null)
            throw new Error('already have team member '+teamid+'/'+member);

        var done;
        team.members[member] = new Promise((resolve, reject) => { done = resolve; });

        await this.db.member_join(team.id, member, name, id, time);
        await this.db.member_fix_last_location(team.id, member);
        var m = await this.db.member_by_pos(team.id, member, (team.state == 'active'));
        if (m === null) {
            throw new Error('failed to join team member '+teamid+'/'+member);
        }
        if (team.state == 'active') {
            console.log('adding member to active team roster', m);
            team.team.members.push(m);
        }
        var cache = membercache([m]);

        delete team.members[member];
        Object.assign(team.members, cache);
        done();
    }

    async part(teamid, member, time) {
        throw new Error('TeamData.part() not implemented yet');
    }

    async chat(teamid, member, message, time) {
        var team = await this.lookup(teamid);
        if (!(team.state == 'active' || team.state == 'inactive'))
            throw new Error('unexpected team state for chat: '+team.state);

        var m = await this.lookup_member(teamid, member);
        if (m === null)
            throw new Error('unknown team member for chat: '+teamid+'/'+member);

        await this.db.insert_chat(team.id, member, message, time);
    }

    active_teams_with_cursors() {
        return TeamData.add_team_cursors(this.active);
    }

    static async init(db) {
        var teams =  await db.active_teams()
        return new this(db, teams);
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

function update_team_promise(db, teamid, team, warn_active=true, fill=false) {
    team.promise = db.team_by_teamid(teamid, fill).then(t => {
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
            if (warn_active) {
                console.warn('TeamData', 'unexpected active team in database');
            }
            team.state = 'active';
            team.epoch = Date.parse(t.started);
            team.team = t;
            return team;
        }
    });
    return team.promise;
}

function membercache(members) {
    var cache = {};
    members.forEach(m => {
        cache[m.member_id] = {
            joined: (m.joined !== null ? Date.parse(m.joined) : null),
            parted: (m.parted !== null ? Date.parse(m.parted) : null),
            last_location: m.last_location,
            last_location_time: (typeof m.time == 'string' ? Date.parse(m.time) : null)
        };
    });
    return cache;
}
