#!/usr/bin/env node

/* jslint node: true */
/* jshint esversion: 6 */
'use strict';

var util = require('util');

var args = process.argv.slice(2);
var cluster_id = getFlagValue('-c') || 'test-cluster';
var client_id = getFlagValue('-id') || 'node-stan-pub';
var server = getFlagValue('-s') || 'nats://localhost:4222';

var subject = args[0];
var body = args.length > 1 ? args[1] : "";
if(!subject) {
  usage();
}

function getFlagValue(k) {
  var i=args.indexOf(k);
  if(i > -1) {
    var v = args[i+1];
    args.splice(i,2);
    return v;
  }
}

function usage() {
  console.log('stan-pub [-c clusterId] [-id clientId] [-s server] [-s server] <subject> [msg]');
  process.exit();
}

var stan = require('../lib/stan.js').connect(cluster_id, client_id, server);
stan.on('connect', function() {
  start();
});

stan.on('error', function(reason) {
  console.log(reason);
});

function start() {
  stan.publish(subject, body, function(err, guid){
    if(err) {
      console.log(err);
      process.exit(1);
    } else {
      console.log('published ' + subject + ' (' + guid + ')');
    }
    process.exit(0);
  });
}