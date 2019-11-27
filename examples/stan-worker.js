#!/usr/bin/env node

/* eslint-disable no-console, no-process-exit */
'use strict';

const STAN = require('../lib/stan.js');
const nuid = require('nuid');

const argv = require('minimist')(process.argv.slice(2));
const cluster_id = argv.c || "test-cluster";
const client_id = argv.i || "node-stan-pub";
const durable_name = argv.d || "worker";
const server = argv.s || 'nats://localhost:4222';
let maxWait = argv.m || "5000";
maxWait = parseInt(maxWait, 10);
const queueGroup = argv.q || "";
const subject = argv._[0];

if (!subject) {
    usage();
}

function usage() {
    console.log('stan-sub [-c clusterId] [-i clientId] [-s server] [-q queueGroup] [-d durableName] [-m maxWaitMillis] <subject>');
    process.exit();
}


const sc = STAN.connect(cluster_id, client_id, server);
sc.on('connect', function() {
    console.log("STAN connected!");
    const opts = sc.subscriptionOptions();
    opts.setDurableName(durable_name);
    opts.setDeliverAllAvailable();
    opts.setManualAckMode(true);
    // if message not processed (acknowledged) in 5 seconds, re-deliver it
    opts.setAckWait(maxWait);
    opts.setMaxInFlight(1);

    // publish some messages to the stream - these would come
    // from some other process
    for (let i = 0; i < 100; i++) {
        sc.publish(subject, nuid.next());
    }

    // create a subscriber that will act as a queue worker, potentially
    // dividing up the queue into multiple workers via a queueGoup
    const subscription = sc.subscribe(subject, queueGroup, opts);
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
        console.log("> processing", `[${msg.getSequence()}]`, msg.getData());
        setTimeout(() => {
            console.log("< done processing", `[${msg.getSequence()}]`);
            msg.ack();
        }, 500);
    });
});

sc.on('error', function(reason) {
    console.log(reason);
});
