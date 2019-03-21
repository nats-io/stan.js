# NATS Streaming - Node.js Client

Node NATS Streaming is an extremely performant, lightweight reliable streaming platform powered by [NATS](http://nats.io) for [Node.js](http://nodejs.org/).

[![license](https://img.shields.io/github/license/nats-io/node-nats-streaming.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Travis branch](https://img.shields.io/travis/nats-io/node-nats-streaming/master.svg)]()
[![Coverage Status](https://coveralls.io/repos/github/nats-io/node-nats-streaming/badge.svg?branch=master)](https://coveralls.io/github/nats-io/node-nats-streaming?branch=master)[![npm](https://img.shields.io/npm/v/node-nats-streaming.svg)](https://www.npmjs.com/package/node-nats-streaming)
[![npm](https://img.shields.io/npm/dt/node-nats-streaming.svg)](https://www.npmjs.com/package/node-nats-streaming)




NATS Streaming provides the following high-level feature set:
- Log based persistence
- At-Least-Once Delivery model, giving reliable message delivery
- Rate matched on a per subscription basis
- Replay/Restart
- Last Value Semantics

## Installation

```bash
npm install node-nats-streaming
```

## Basic Usage
```javascript
#!/usr/bin/env node

"use-strict";

var stan = require('node-nats-streaming').connect('test-cluster', 'test');

stan.on('connect', function () {

  // Simple Publisher (all publishes are async in the node version of the client)
  stan.publish('foo', 'Hello node-nats-streaming!', function(err, guid){
    if(err) {
      console.log('publish failed: ' + err);
    } else {
      console.log('published message with guid: ' + guid);
    }
  });

  // Subscriber can specify how many existing messages to get.
  var opts = stan.subscriptionOptions().setStartWithLastReceived();
  var subscription = stan.subscribe('foo', opts);
  subscription.on('message', function (msg) {
    console.log('Received a message [' + msg.getSequence() + '] ' + msg.getData());
  });

  // After one second, unsubscribe, when that is done, close the connection
  setTimeout(function() {
    subscription.unsubscribe();
    subscription.on('unsubscribed', function() {
      stan.close();
    });
  }, 1000);
});

stan.on('close', function() {
  process.exit();
});
```

### Subscription Start (i.e. Replay) Options

NATS Streaming subscriptions are similar to NATS subscriptions, but clients may start their subscription at an earlier point in the message stream, allowing them to receive messages that were published before this client registered interest.

The options are described with examples below:

```javascript
  // Subscribe starting with the most recently published value
  var opts = stan.subscriptionOptions();
  opts.setStartWithLastReceived();
  var subscription = stan.subscribe('foo', opts);
  
  // Receive all stored values in order
  var opts = stan.subscriptionOptions();
  opts.setDeliverAllAvailable();
  var subscription = stan.subscribe('foo', opts);
  
  // Receive all messages starting at a specific sequence number
  var opts = stan.subscriptionOptions();
  opts.setStartAtSequence(22);
  var subscription = stan.subscribe('foo', opts);
  
  // Subscribe starting at a specific time
  var d = new Date(2016, 7, 8); // August 8th, 2016
  var opts = stan.subscriptionOptions();
  opts.setStartTime(d);
  var subscription = stan.subscribe('foo', opts);
  
  // Subscribe starting at a specific amount of time in the past (e.g. 30 seconds ago)
  var opts = stan.subscriptionOptions();
  opts.setStartAtTimeDelta(30*1000); // 30 seconds ago
  var subscription = stan.subscribe('foo', opts);
```

### Wildcard Subscriptions

NATS Streaming subscriptions **do not** support wildcards.

### Durable Subscriptions

Replay of messages offers great flexibility for clients wishing to begin processing at some earlier point in the data stream.
However, some clients just need to pick up where they left off from an earlier session, without having to manually track their position in the stream of messages.
Durable subscriptions allow clients to assign a durable name to a subscription when it is created.
Doing this causes the NATS Streaming server to track the last acknowledged message for that clientID + durable name, so that only messages since the last acknowledged message will be delivered to the client.

```javascript
var stan = require('node-nats-streaming').connect('test-cluster', 'client-123');

stan.on('connect', function () {
  // Subscribe with durable name
  var opts = stan.subscriptionOptions();
  opts.setDeliverAllAvailable();
  opts.setDurableName('my-durable');

  var durableSub = stan.subscribe('foo', opts);
  durableSub.on('message', function(msg) {
    console.log('Received a message: ' + msg.getData());
  });

  //... 
  // client suspends durable subscription
  //
  durableSub.close();

  //...
  // client resumes durable subscription
  //
  durableSub = stan.subscribe('foo', opts);
  durableSub.on('message', function(msg) {
    console.log('Received a message: ' + msg.getData());
  });

  // ...
  // client receives message sequence 1-40, and disconnects
  stan.close();

  // client reconnects in the future with same clientID
  var stan = require('node-nats-streaming').connect('test-cluster', 'client-123');
  var durableSub = stan.subscribe('foo', opts);
  durableSub.on('message', function(msg) {
    console.log('Received a message: ' + msg.getData());
  });
});
```

### Queue Groups

Subscriptions with the same queue name will form a queue group. Each message is only delivered to a single subscriber per queue group. You can have as many queue groups as you wish. Normal subscribers are not affected by queue group semantics.

```javascript
    var opts = stan.subscriptionOptions();
    opts.setStartWithLastReceived();
    var subscription = stan.subscribe('foo', 'foo.workers', opts);
```

### Asynchronous Publishing

For each message published, a [NUID](https://github.com/nats-io/nuid) is generated for the message on creation. When the message is received by the server, the client library is notified on its optional callback:

```javascript
    var guid = stan.publish('foo', 'Hello World!', function(err, aGuid){
      // err will be undefined if the message was accepted by the 
      // NATS streaming server
      if(err) {
        console.log('Error publishing: ' + aGuid + ' - ' + err);
      }
    });
```

#### Message Acknowledgements and Redelivery

NATS Streaming offers At-Least-Once delivery semantics, meaning that once a message has been delivered to an eligible subscriber, if an acknowledgement is not received within the configured timeout interval, NATS Streaming will attempt redelivery of the message.
This timeout interval is specified by the subscription option `SubscriptionOptions#setAckWait(millis)`, which defaults to 30 seconds.

By default, messages are automatically acknowledged by the NATS Streaming client library after the subscriber's message handler is invoked. However, there may be cases in which the subscribing client wishes to accelerate or defer acknowledgement of the message.
To do this, the client must set manual acknowledgement mode on the subscription, and invoke `Message#ack()` on the `Message`.

```javascript
    var opts = stan.subscriptionOptions();
    opts.setManualAckMode(true);
    opts.setAckWait(60*1000); //60s

    var sub = stan.subscribe('Foo', opts);

    sub.on('message', function (msg) {
      // do something with the message
      msg.ack();        
    });
```

### Synchronous Publishing

The Nodejs client does not support synchronous publishing.

### Rate limiting/matching

A classic problem of publish-subscribe messaging is matching the rate of message producers with the rate of message consumers.
Message producers can often outpace the speed of the subscribers that are consuming their messages.
This mismatch is commonly called a "fast producer/slow consumer" problem, and may result in dramatic resource utilization spikes in the underlying messaging system as it tries to buffer messages until the slow consumer(s) can catch up.

Under Nodejs, this is even more important, as in Nodejs is a single-threaded environment. This means that if your application is CPU bound, it is possible for your application to block the processing of outgoing or incoming messages.

### Publisher rate limiting

NATS Streaming provides a connection option called `maxPubAcksInflight` that effectively limits the number of unacknowledged messages that a publisher may have in-flight at any given time. When this maximum is reached, your publisher's callback will be invoked with an error. If not callback was defined, an error will be thrown until the number of unacknowledged messages fall below the specified limit. 

### Subscriber rate limiting

Rate limiting may also be accomplished on the subscriber side, on a per-subscription basis, using a subscription option called `SubscriptionOptions#setMaxInFlight(number)`. This option specifies the maximum number of outstanding acknowledgements (messages that have been delivered but not acknowledged) that NATS Streaming will allow for a given subscription.
When this limit is reached, NATS Streaming will suspend delivery of messages to this subscription until the number of unacknowledged messages falls below the specified limit.

### Connection Status

The fact that the NATS Streaming server and clients are not directly connected poses a challenge when it comes to know if a client is still valid. When a client disconnects, the streaming server is not notified, hence the importance of calling `stan#close()`. The server sends heartbeats to the client's private inbox and if it misses a certain number of responses, it will consider the client's connection lost and remove it from its state.

Before version `0.1.0`, the client library was not sending PINGs to the streaming server to detect connection failure. This was problematic especially if an application was never sending data (had only subscriptions for instance). Picture the case where a client connects to a NATS Server which has a route to a NATS Streaming server (either connecting to a standalone NATS Server or the server it embeds). If the connection between the streaming server and the client's NATS Server is broken, the client's NATS connection would still be ok, yet, no communication with the streaming server is possible.

Starting version `0.1.0` of this library and server `0.10.0`, the client library will now send PINGs at regular intervals (default is `5000` milliseconds) and will close the streaming connection after a certain number of PINGs have been sent without any response (default is `3`). When that happens, a callback - if one is registered - will be invoked to notify the user that the connection is permanently lost, and the reason for the failure.

Here is how you would specify your own PING values and the callback:

```javascript
var STAN = require('node-nats-streaming');
sc.connect('test-cluster', 'test', {
    stanMaxPingOut: 3, 
    stanPingInterval: 1000
});

sc.on('connect', function () {
    sc.on('connection_lost', function(error) {
        console.log('disconnected from stan', error);
    });
    ...
```

Note that the only way to be notified is to set the callback. If the callback is not set, PINGs are still sent and the connection will be closed if needed, but the application won't know if it has only subscriptions.

When the connection is lost, your application would have to re-create it and all subscriptions if any.

When no NATS connection is provided via the connection options, the library creates its own NATS connection and will now set the reconnect attempts (`maxReconnectAttempts`) to "infinite" (`-1`), which was not the case before. It should therefore be possible for the library to always reconnect, but this does not mean that the streaming connection will not be closed, even if you set a very high threshold for the PINGs max out value. Keep in mind that while the client is disconnected, the server is sending heartbeats to the clients too, and when not getting any response, it will remove that client from its state. When the communication is restored, the PINGs sent to the server will allow to detect this condition and report to the client that the connection is now closed.

Also, while a client is "disconnected" from the server, another application with connectivity to the streaming server may connect and uses the same client ID. The server, when detecting the duplicate client ID, will try to contact the first client to know if it should reject the connect request of the second client. Since the communication between the server and the first client is broken, the server will not get a response and therefore will replace the first client with the second one.

Prior to client `0.1.0` and server `0.10.0`, if the communication between the first client and server were to be restored, and the application would send messages, the server would accept those because the published messages client ID would be valid, although the client is not. With client at `0.1.0`+ and server `0.10.0`+, additional information is sent with each message to allow the server to reject messages from a client that has been replaced by another client.


## Supported Node Versions

Support policy for Nodejs versions follows 
[Nodejs release support]( https://github.com/nodejs/Release).
We will support and build node-nats-streaming on even Nodejs versions that are current 
or in maintenance.

## License

Unless otherwise noted, the NATS source files are distributed under the Apache Version 2.0 license found in the LICENSE file.

