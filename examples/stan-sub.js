#!/usr/bin/env node

/* eslint-disable no-console, no-process-exit */
'use strict';

const STAN = require('../lib/stan.js');

const argv = require('minimist')(process.argv.slice(2));
const cluster_id = argv.c || "test-cluster";
const client_id = argv.i || "node-stan-pub";
const server = argv.s || 'nats://localhost:4222';
const queueGroup = argv.q || "";
const subject = argv._[0];

if (!subject) {
    usage();
}

function usage() {
    console.log('stan-sub [-c clusterId] [-i clientId] [-s server] [-q queueGroup] <subject>');
    process.exit();
}


const stan = STAN.connect(cluster_id, client_id, server);
stan.on('connect', function() {
    console.log("STAN connected!");
    const opts = stan.subscriptionOptions();
    opts.setStartWithLastReceived();

    const subscription = stan.subscribe(subject, queueGroup, opts);
    subscription.on('error', (err) => {
        console.log(`subscription for ${subject} raised an error: ${err}`);
    });
    subscription.on('unsubscribed', () => {
        console.log(`unsubscribed to ${subject}`);
    });
    subscription.on('ready', () => {
        console.log(`subscribed to ${subject}`);
    });
    subscription.on('message', (msg) => {
        console.log(msg.getSubject(), `[${msg.getSequence()}]`, msg.getData());
    });
});

stan.on('error', function(reason) {
    console.log(reason);
});
