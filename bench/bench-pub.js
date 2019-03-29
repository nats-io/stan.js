#!/usr/bin/env node

/* eslint-disable no-console, no-process-exit */

'use strict';

const STAN = require('../lib/stan.js');

const argv = require('minimist')(process.argv.slice(2));
const cluster_id = argv.c || "test-cluster";
const client_id = argv.i || "bench-pub";
const server = argv.s || 'nats://localhost:4222';
let count = argv.m || 100000;
count = parseInt(count, 10);
const maxPubAcks = argv.x || 0;

const subject = argv._[0];
const body = argv._[1] || '';

if (!subject) {
    usage();
}

function usage() {
    console.log('bench-pub [-c clusterId] [-i clientId] [-s server] [-m messageCount] <subject> <msg>');
    process.exit();
}

const opts = {
    url: server
};

if (maxPubAcks) {
    opts.maxPubAcksInflight = maxPubAcks;
}

const sc = STAN.connect(cluster_id, client_id, opts);

let start;
let sent = 0;
sc.on('connect', () => {
    start = Date.now();
    sendMore();
});


function send(n) {
    for (let i = 0; i < n; i++) {
        // publishing will dominate the event loop, so acks won't get
        // a chance to process, only pub as many as we can, and then
        // allow the event loop to do something else
        if (sc.pubAckOutstanding < sc.options.maxPubAcksInflight) {
            sc.publish(subject, body);
            sent++;
            if (sent % 10000 === 0) {
                process.stdout.write('+');
            }
        } else {
            break;
        }
    }
    setTimeout(sendMore, 0);
}


function sendMore() {
    if (sent === count) {
        const end = Date.now();
        const time = end - start;
        const msgPerSec = Math.round((count * 1000) / time);
        console.log(`\nReceived ${count} msgs in ${time}ms (${msgPerSec} msgs/sec)`);
        sc.nc.flush(() => {
            sc.close();
        });
        return;
    }

    if (sent <= count) {
        const left = count - sent;
        const toSend = left < 10000 ? left : 10000;
        send(toSend);
    }
}
