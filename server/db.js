'use strict';

const mysql = require('mysql2/promise');

class Db {
    constructor(config) {
        this.config = config;
        this.conn = null;
        this.connected = false;
    }

    async connect() {
        this.conn = await mysql.createConnection(this.config);
        this.connected = true;
        console.log('mysql connected');
    }

    async disconnect() {
        if (!this.connected) return;
        await this.conn.end();
        this.connected = false;
    }

    async active_teams() {
        if (!this.connected) {
            throw new Error('mysql not connected');
        }
        var [teams] = await this.execute('SELECT * FROM teams WHERE finished IS NULL');
        await fill_team_data(this, teams, 1);
        return to_normal_object(teams);
    }

    async teams_before(date, teamlimit) {
        if (!Number.isInteger(teamlimit) || teamlimit < 1) {
            throw new Error('unexpected team limit');
        }
        var limit = teamlimit+1; // add 1 to limit to ensure that next record has a different timestamp
        var teams;
        if (date === 'now') {
            [teams] = await this.execute('SELECT * FROM teams WHERE finished IS NOT NULL ORDER BY finished DESC LIMIT '+limit);
        } else if (date instanceof Date) {
            [teams] = await this.execute('SELECT * FROM teams WHERE finished < FROM_UNIXTIME(?) ORDER BY finished DESC LIMIT '+limit, [date.getTime()/1000]);
        } else {
            throw new Error('unexpected date');
        }
        if (teams.length == 0) {
            // no special handling required
        } else if (teams.length < limit) {
            teams[teams.length-1].is_last_record = true;
        } else if (teams[teams.length-1].finished.getTime() != teams[teams.length-2].finished.getTime()) {
            // extra record has different timestamp
            // just remove it
            teams.splice(-1,1);
        } else {
            // extra record has the same timestamp
            // need to get all other records with the same timestamp
            let lastfinished = teams[teams.length-1].finished.getTime();
            let idlist = [];
            teams.forEach(team => { if (team.finished.getTime() == lastfinished) idlist.push(team.id); });
            let [moreteams] = await this.query('SELECT * FROM teams WHERE finished = FROM_UNIXTIME(?) AND id NOT IN ('+idlist.join(',')+')', [lastfinished/1000]);
            teams = teams.concat(moreteams);
        }
        await fill_team_data(this, teams, 1);
        return to_normal_object(teams);
    }

    // does not use mysql2 cached statements
    async query(sql, vals, ...args) {
        var result = await this.conn.query(sql, vals, ...args);
        if (this.config.log_queries) {
            let rows = result[0].length;
            if (typeof vals === 'undefined') vals = '';
            console.log('mysql query ['+rows+' row(s)]:', sql, vals);
        }
        return result;
    }

    // uses mysql2 cached statements
    async execute(sql, vals, ...args) {
        var result = await this.conn.execute(sql, vals, ...args);
        if (this.config.log_queries) {
            let rows = result[0].length;
            if (typeof vals === 'undefined') vals = '';
            console.log('mysql execute ['+rows+' row(s)]:', sql, vals);
        }
        return result;
    }
}

module.exports = Db;

async function fill_team_data(db, teams, chatlimit) {
    if (!Number.isInteger(chatlimit) || chatlimit < 0) {
        throw new Error('unexpected chat limit');
    }
    teams.forEach(team => { team.members = []; });
    var idlist = teams.map(team => team.id);
    var idmap = swap_array_keys(idlist);
    var [members] = await db.query('SELECT members.*, time, lat, lng, accuracy FROM members LEFT JOIN locations ON last_location = locations.id WHERE members.team IN (' + idlist.join(',') + ')');
    for (let i=0; i<members.length; i++) {
        let member = members[i];
        teams[idmap[member.team]].members.push(member);
    }
    if (chatlimit == 0) {
        return;
    }
    for (let i=0; i<teams.length; i++) {
        let team = teams[i];
        let limit = chatlimit + 1; // get one extra record to ensure different timestamp
        let [chats] = await db.execute('SELECT * FROM chat WHERE team = ? ORDER BY time DESC LIMIT '+limit, [team.id]);
        if (chats.length == 0) {
            // no special handling required
        } else if (chats.length < limit) {
            chats[chats.length-1].is_last_record = true;
        } else if (chats[chats.length-1].time.getTime() != chats[chats.length-2].time.getTime()) {
            // extra record has different timestamp
            // just remove it
            chats.splice(-1,1);
        } else {
            // extra record has same timestamp
            // need to get all other chat messages with the same timestamp
            let lastchat = chats[chats.length-1].time.getTime();
            let idlist = [];
            chats.forEach(chat => { if (chat.time.getTime() == lastchat) idlist.push(chat.id); });
            let [morechats] = await db.query('SELECT * FROM chat WHERE team = ? AND time = FROM_UNIXTIME(?) AND id NOT IN ('+idlist.join(',')+')', [team.id, lastchat/1000]);
            chats = chats.concat(morechats);
        }
        team.chats = chats;
    }
}

// return object where array's keys are now its values and vice versa
function swap_array_keys(a) {
    var s = {};
    for (let i=0; i<a.length; i++) {
        s[a[i]] = i;
    }
    return s;
}

// is there a better way to get plain objects rather than the custom objects from mysql2?
function to_normal_object(o) {
    return JSON.parse(JSON.stringify(o));
}
