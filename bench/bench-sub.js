#!/usr/bin/env node

/* eslint-disable no-console, no-process-exit */

'use strict';

const STAN = require('../lib/stan.js');

const argv = require('minimist')(process.argv.slice(2));
const cluster_id = argv.c || "test-cluster";
const client_id = argv.i || "bench-pub";
const server = argv.s || 'nats://localhost:4222';
const qGroup = argv.g || "";
let count = argv.m || 100000;
count = parseInt(count, 10);
const subject = argv._[0];

if (!subject) {
    usage();
}

function usage() {
    console.log('bench-sub [-c clusterId] [-i clientId] [-s server] [-m messageCount] [-q qGroup] <subject>');
    process.exit();
}

const stan = STAN.connect(cluster_id, client_id, {
    url: server
});

let start;
stan.on('connect', () => {
    start = Date.now();
    const opts = stan.subscriptionOptions();
    opts.setDeliverAllAvailable();
    if (qGroup) {
        opts.setQGroup(qGroup);
    }
    const sub = stan.subscribe(subject, opts);
    sub.on('error', (err) => {
        console.log('subscription for ' + sub.subject + " raised an error: " + err);
    });
    sub.on('unsubscribed', () => {
        stan.close();
    });
    sub.on('ready', () => {
        console.log('subscribed to', sub.subject, sub.qGroup ? 'qGroup ' + qGroup : '');
    });

    let received = 0;

    sub.on('message', (msg) => {
        received++;
        if (received === count) {
            const end = Date.now();
            const time = end - start;
            stan.nc.flush(() => {
                const msgPerSec = Math.round(count / (time / 1000));
                console.log(`\nReceived ${count} msgs in ${time}ms (${msgPerSec} msgs/sec)`);
                sub.unsubscribe();
            });
        }
    });
});


stan.on('close', function() {
    process.exit(0);
});
