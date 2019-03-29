#!/usr/bin/env node

/* eslint-disable no-console, no-process-exit */

'use strict';

const STAN = require('../lib/stan.js');

const args = process.argv.slice(2);
const cluster_id = getFlagValue('-c') || "test-cluster";
const client_id = getFlagValue('-id') || "node-stan-sub";
const queue_group = getFlagValue('-q') || '';
const server = getFlagValue('-s') || 'nats://localhost:4222';

const subject = args[0];
if (!subject) {
    usage();
}

function usage() {
    console.log('stan-sub [-c clusterId] [-id clientId] [-s server] [-q queueGroup] [-s server] <subject>');
    process.exit();
}

function getFlagValue(k) {
    const i = args.indexOf(k);
    if (i > -1) {
        const v = args[i + 1];
        args.splice(i, 2);
        return v;
    }
}

const sc = STAN.connect(cluster_id, client_id, server);
sc.on('connect', () => {
    console.log("STAN connected!");
    const opts = sc.subscriptionOptions();
    opts.setStartAtSequence(3);

    const subscription = sc.subscribe(subject, queue_group, opts);
    subscription.on('error', function(err) {
        console.log(`subscription for ${subject} raised an error: ${err}`);
    });
    subscription.on('unsubscribed', function() {
        console.log(`unsubscribed to ${subject}`);
    });
    subscription.on('ready', () => {
        console.log(`subscribed to ${subject}`);
    });
    subscription.on('message', (msg) => {
        console.log(msg.getSubject(), `[${msg.getSequence()}]`, msg.getData());
    });
});

sc.on('error', (reason) => {
    console.log(reason);
});
