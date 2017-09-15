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
        var teams;
        if (date === 'now') {
            teams = await auto_query_more(this, 'SELECT * FROM teams', 'finished IS NOT NULL', 'finished', null, 'id', [], teamlimit);
        } else if (date instanceof Date) {
            teams = await auto_query_more(this, 'SELECT * FROM teams', '', 'finished', date, 'id', [], teamlimit);
        } else {
            throw new Error('unexpected date');
        }
        await fill_team_data(this, teams, 1);
        return to_normal_object(teams);
    }

    async chats_before(teamid, date, chatlimit) {
        if (!Number.isInteger(chatlimit) || chatlimit < 1) {
            throw new Error('unexpected team limit');
        }
        var chats = await auto_query_more(this, 'SELECT * FROM chat', 'team = ?', 'time', date, 'id', [teamid], chatlimit);
        return to_normal_object(chats);
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
        teams[i].chats = await db.chats_before(teams[i].id, null, chatlimit);
    }
}

/* to be able to query data with time < TIMESTAMP, we need to guarantee that
 * the timestamp of the last returned record is not shared by any records other
 * than those in the result set.
 *
 * in practice, we resolve this by requesting 1 more record than requested, and
 * requesting additional records only when necessary.
 *
 * if we receive fewer than n+1 records, the results contain the final record.
 *
 * if we receive n+1 records and the nth and (n+1)th record have different
 * timestamps, we throw away the (n+1)th record.
 *
 * if the nth and (n+1)th record have identical timestamps, we make one further
 * database request to get all the other records with this timestamp.
 */
async function auto_query_more(db, basequery, where, timefield, before, idfield, params, n) {
    if (n <= 0) throw new Error('invalid n');

    if (typeof params == 'undefined' || params === null) params = [];

    var limit = n+1; // request one extra record
    var args = (params ? params.slice() : []);

    if (args.length != ((where || '').match(/\?/g) || []).length) {
        throw new Error ('params do not match where query placeholders');
    }

    var sql = basequery;
    if (where || before) {
        sql += ' WHERE ';
    }
    if (where) {
        sql += where;
        if (before) sql += ' AND ';
    }
    if (before) {
        sql += timefield + ' < FROM_UNIXTIME(?)';
        args.push(before.getTime()/1000);
    }
    sql += ' ORDER BY ' + timefield + ' DESC, ' + idfield + ' DESC LIMIT ' + limit;

    var [rows] = await db.execute(sql, args);

    if (rows.length == 0) {
        // no special handling required
    } else if (rows.length < limit) {
        // add is_last_record property
        rows[rows.length-1].is_last_record = true;
    } else if (rows[rows.length-1][timefield].getTime() != rows[rows.length-2][timefield].getTime()) {
        // extra record has a different timestamp, just remove it
        rows.pop();
    } else {
        // extra record has the same timestamp
        // need to get all other records with the same timestamp
        let lasttime = rows[rows.length-1][timefield].getTime();
        let idlist = []; // ids of all results in the current set with this timestamp
        rows.forEach(row => { if (row[timefield].getTime() == lasttime) idlist.push(row[idfield]); });
        let moresql = basequery + ' WHERE ' + (where ? where + ' AND ' : '')
            + timefield + ' = FROM_UNIXTIME(?)'
            + ' AND ' + idfield + ' NOT IN (' + idlist.join(',') + ')'
            + ' ORDER BY ' + idfield + ' DESC';
        if (before) {
            // remove before parameter added earlier
            args.pop();
        }
        args.push(lasttime/1000);
        let [more] = await db.query(moresql, args);
        rows = rows.concat(more);
    }

    return rows;
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
