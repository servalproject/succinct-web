'use strict';

const shellescape = require('shell-escape');
const child_process = require('child_process');

class OutQueue {
    constructor(config) {
        this.config = config;
    }

    async queue_chat(team, msg, epoch) {
        console.log('queue_chat', team, msg, epoch);
        await new Promise(function(resolve, reject) {
            child_process.exec('./msgwrite chat 0 '+shellescape([epoch, msg])
                +' | ./queue_message '+shellescape([this.config.spool, team, '/dev/stdin']),
                {cwd: this.config.decode, encoding: 'utf8'},
                (err, stdout, stderr) => {
                    if (err) {
                        console.warn('failed to queue message:', stderr);
                        reject(err);
                    }
                    resolve();
                });
        }.bind(this));
    }
}

module.exports = OutQueue;
