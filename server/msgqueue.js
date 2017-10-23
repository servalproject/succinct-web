'use strict';

const fs = require('fs');

class MsgQueue {
    constructor(teamdata, msgdir) {
        this.teamdata = teamdata;
        this.msgdir = msgdir;
        this.pending_files = new Set();
        this.waiting = {};
        this.locked = new Set();

        this.watcher = fs.watch(msgdir+'/new', (type, filename) => {
            if (type != 'rename') return;
            this.process_file(filename);
        });

        // process any files currently in the directory
        fs.readdir(msgdir+'/new', (err, files) => {
            if (err) throw err;
            files.forEach(filename => this.process_file(filename), this);
        });
    }

    async process_file(filename) {
        if (this.pending_files.has(filename)) return;
        this.pending_files.add(filename);

        try {
            var json = await new Promise((resolve, reject) => {
                fs.readFile(this.msgdir+'/new/'+filename, {encoding: 'utf8'}, (err, data) => {
                    if (err) reject(err);
                    resolve(data);
                });
            });
        } catch (err) {
            this.pending_files.delete(filename);
            return;
        }

        try {
            var msg = JSON.parse(json);
        } catch (err) {
            this.pending_files.delete(filename);
            throw err;
        }

        console.log('received local message', msg);

        try {
            validate_msg(msg);
        } catch (err) {
            console.error(err.message);
            this.pending_files.delete(filename);
            return;
        }

        var teamid = msg.team;
        var msgtype = msg.type;

        // acquire lock for start/end/join/part messages
        // these messages shouldn't come more than once per team/member anyway
        var lock;
        if (msgtype == 'start' || msgtype == 'end') {
            lock = 'unlock/'+teamid+'/'+msgtype;
        } else if (msgtype == 'join' || msgtype == 'part') {
            lock = 'unlock/'+teamid+'/'+msgtype+'/'+msg.member;
        }

        if (lock && this.locked.has(lock)) {
            this.wait(lock, filename);
            return;
        }

        var unlock;
        if (lock) {
            this.locked.add(lock);
            unlock = function () {
                this.locked.delete(lock);
                this.trigger(lock);
            }.bind(this);
        } else {
            unlock = function () {};
        }

        var team = await this.teamdata.lookup(teamid);

        switch (team.state) {
            case 'unknown':
            case 'starting':
            case 'active':
            case 'inactive':
                break;
            default:
                console.error('unexpected team state '+team.state+' for team '+teamid);
                this.pending_files.delete(filename);
                unlock();
                return;
        }

        var done = function () {
            fs.rename(this.msgdir+'/new/'+filename, this.msgdir+'/done/'+filename, err => {
                if (err) {
                    console.error(filename, err.message);
                    throw err;
                }
                console.log(filename, 'moved to done directory');
                this.pending_files.delete(filename);
                unlock();
            });
        }.bind(this);

        if (msgtype == 'start') {
            if (team.state != 'starting' && team.state != 'unknown') {
                console.warn('unexpected start message for '+teamid+' while in state '+team.state);
                this.pending_files.delete(filename);
                unlock();
                return;
            }
            console.log('got team start message', teamid, msg.name);
            await this.teamdata.start(teamid, msg.name, msg.time);
            this.trigger('started/'+teamid);
            done();
            return;
        }

        // delay processing of non-start messages until team is started
        if (team.state == 'starting' || team.state == 'unknown') {
            this.wait('started/'+teamid, filename);
            unlock();
            return;
        }

        if (msgtype == 'end') {
            if (team.state != 'active') {
                console.warn('unexpected end message for '+teamid+' while in state '+team.state);
                this.pending_files.delete(filename);
                unlock();
                return;
            }
            if (msg.time < team.epoch) {
                console.warn('end time for '+teamid+' is before its start time');
                msg.time = team.epoch;
            }
            console.log('got team end message', teamid);
            await this.teamdata.end(teamid, msg.time);
            done();
            return;
        }

        // process location messages even if before some member join messages
        if (msgtype == 'location') {
            console.log('got '+msg.locations.length+' locations for '+teamid);
            await Promise.all(msg.locations.map(
                (loc) => this.teamdata.add_location(teamid, loc.member,
                    loc.lat, loc.lng, loc.acc, team.epoch + loc.reltime), this));
            done();
            return;
        }

        var member = await this.teamdata.lookup_member(teamid, msg.member);
        var msgtime = team.epoch + msg.reltime;

        if (msgtype == 'join') {
            if (member) {
                console.warn('unexpected join for '+teamid+'/'+msg.member+' (already joined)');
                this.pending_files.delete(filename);
                unlock();
                return;
            }
            console.log('got join', teamid+'/'+msg.member, msg.name, '('+msg.id+')');
            console.log(msgtime);
            await this.teamdata.join(teamid, msg.member, msg.name, msg.id, msgtime);
            this.trigger('joined/'+teamid+'/'+msg.member);
            done();
            return;
        }

        // for all other message types, wait until team member joined
        if (!member) {
            this.wait('joined/'+teamid+'/'+msg.member, filename);
            unlock();
            return;
        }

        if (msgtype == 'part') {
            if (member.parted !== null) {
                console.warn('already parted:', teamid+'/'+msg.member);
                this.pending_files.delete(filename);
                unlock();
                return;
            }
            console.log('got part', teamid+'/'+msg.member);
            await this.teamdata.part(teamid, msg.member, msgtime);
            done();
            return;
        }

        if (msgtype == 'chat') {
            console.log('got chat', teamid+'/'+msg.member, msg.message);
            await this.teamdata.chat(teamid, msg.member, msg.message, msgtime);
            done();
            return;
        }

        if (msgtype == 'magpi_form') {
            console.warn('processing for magpi forms not implemented here');
            this.pending_files.delete(filename);
            unlock();
            return;
        }
    }

    wait(ev, filename) {
        if (typeof this.waiting[ev] != 'object') {
            this.waiting[ev] = [];
        }
        console.log('waiting for trigger '+ev+' to process '+filename);
        this.waiting[ev].push(filename);
    }

    trigger(ev) {
        if (typeof this.waiting[ev] != 'object') return;
        console.log('processing messages waiting for trigger', ev);
        var wait = this.waiting[ev];
        delete this.waiting[ev];
        wait.forEach(file => {
            this.pending_files.delete(file);
            this.process_file(file)
        }, this);
    }
}

module.exports = MsgQueue;

function validate_msg(msg) {
    if (typeof msg != 'object')
        throw new Error('message is not an object');
    if (typeof msg.team != 'string' || msg.team.length == 0)
        throw new Error('no team value in message');
    if (typeof msg.type != 'string')
        throw new Error('no type value in message');
    switch (msg.type) {
        case 'start':
            if (typeof msg.time != 'number' || msg.time < 0)
                throw new Error('no time in team start message');
            if (typeof msg.name != 'string' || msg.name.length == 0)
                throw new Error('no name in team start message');
            break;
        case 'end':
            if (typeof msg.time != 'number' || msg.time < 0)
                throw new Error('no time in team end message');
            break;
        case 'join':
            validate_member(msg);
            if (msg.member == 0)
                throw new Error('cannot have join message for EOC');
            validate_reltime(msg);
            if (typeof msg.name != 'string' || msg.name.length == 0)
                throw new Error('no name in join message');
            if (typeof msg.id != 'string')
                throw new Error('no id in join message');
            break;
        case 'part':
            validate_member(msg);
            if (msg.member == 0)
                throw new Error('cannot have part message for EOC');
            validate_reltime(msg);
            break;
        case 'location':
            if (!Array.isArray(msg.locations))
                throw new Error('invalid locations in location message');

            msg.locations.forEach(loc => {
                validate_member(loc);
                if (loc.member == 0)
                    throw new Error('cannot specify location of member 0');
                validate_reltime(loc);
                if (typeof loc.lat != 'number' || typeof loc.lng != 'number'
                        || typeof loc.acc != 'number' || loc.acc < 0)
                    throw new Error('bad lat/lng/acc in location message');
            });
            break;
        case 'chat':
            validate_member(msg);
            validate_reltime(msg);
            if (typeof msg.message != 'string' || msg.message.length == 0)
                throw new Error('bad message string in chat message');
            break;
        case 'magpi_form':
            validate_member(msg);
            validate_reltime(msg);
            if (typeof msg.hexdata != 'string' || !/^(?:[0-9a-f]{2})*$/.test(msg.hexdata))
                throw new Error('bad hexdata in magpi message');
            break;
        default:
            throw new Error('unknown message type '+msg.type);
    }
}

function validate_member(msg) {
    if (typeof msg.member != 'number' || !Number.isInteger(msg.member) || msg.member < 0)
        throw new Error('invalid member position in '+msg.type+' message');
}

function validate_reltime(msg) {
    if (typeof msg.reltime != 'number' || msg.reltime < 0)
        throw new Error('invalid reltime in '+msg.type+' message');
}
