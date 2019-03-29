#!/usr/bin/env node


/* eslint-disable no-console, no-process-exit */
'use strict';

const STAN = require('../lib/stan.js');

const argv = require('minimist')(process.argv.slice(2));
const cluster_id = argv.c || "test-cluster";
const client_id = argv.i || "node-stan-pub";
const server = argv.s || 'nats://localhost:4222';
const subject = argv._[0];
const body = argv._[1] || '';

if (!subject) {
    usage();
}


function usage() {
    console.log('stan-pub [-c clusterId] [-i clientId] [-s server] <subject> [msg]');
    process.exit();
}

const sc = STAN.connect(cluster_id, client_id, server);
sc.on('connect', () => {
    sc.publish(subject, body, (err, guid) => {
        if (err) {
            console.log(err);
            process.exit(1);
        } else {
            console.log(`published ${subject} (${guid})`);
        }
        sc.close();
    });
});

sc.on('error', function(reason) {
    console.log(reason);
});
