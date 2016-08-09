# node-nats-streaming - Node.js NATS Streaming Client

Node NATS Streaming is an extremely performant, lightweight reliable streaming platform powered by [NATS](http://nats.io) for [Node.js](http://nodejs.org/).

[![License MIT](https://img.shields.io/npm/l/express.svg)](http://opensource.org/licenses/MIT)
[![Build Status](https://travis-ci.org/nats-io/node-nats-streaming.svg?branch=master)](http://travis-ci.org/nats-io/node-nats-streaming) [![npm version](https://badge.fury.io/js/nats.svg)](http://badge.fury.io/js/nats)[![Coverage Status](https://coveralls.io/repos/nats-io/node-nats-streaming/badge.svg)](https://coveralls.io/r/nats-io/node-nats-streaming?branch=master)

NATS Streaming provides the following high-level feature set:
- Log based persistence
- At-Least-Once Delivery model, giving reliable message delivery
- Rate matched on a per subscription basis
- Replay/Restart
- Last Value Semantics

## Installation

```bash
npm install nats
```

## Basic Usage
```javascript
var stan = require('stan').connect('test-cluster', 'test');

stan.on('connect', function () {
    // Simple Publisher (all publishes are async in the node version of the client)
    stan.publishAsync('foo', 'Hello World!', function(err, guid){
        if(err) {
          console.log('publish failed: ' + err);
        } else {
          console.log('published message with guid: ' + guid);
        }
    });
    
    // Subscriber can specify how many existing messages to get.
    var subscription = stan.subscribe('foo');
    subscription.on('message', function (msg) {
      console.log('Received a message: ' + msg.getData());
    });
    
    // Unsubscribe
    subscription.unsubscribe();
    
    // Close connection
    stan.close();
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
  Date d = new Date(2016, 7, 8); // August 8th, 2016
  var opts = stan.subscriptionOptions();
  opts.setStartTime(d);
  var subscription = stan.subscribe('foo', opts);
  
  // Subscribe starting at a specific amount of time in the past (e.g. 30 seconds ago)
  var opts = stan.subscriptionOptions();
  opts.setStartAtTimeDelta(30*1000); // 30 seconds ago
  var subscription = stan.subscribe('foo', opts);
```

### Durable Subscriptions

Replay of messages offers great flexibility for clients wishing to begin processing at some earlier point in the data stream.
However, some clients just need to pick up where they left off from an earlier session, without having to manually track their position in the stream of messages.
Durable subscriptions allow clients to assign a durable name to a subscription when it is created.
Doing this causes the NATS Streaming server to track the last acknowledged message for that clientID + durable name, so that only messages since the last acknowledged message will be delivered to the client.

```javascript
var stan = require('stan').connect('test-cluster', 'client-123');


// Subscribe with durable name
var opts = stan.subscriptionOptions();
opts.setDeliverAllAvailable();
opts.setDurableName('my-durable');

var durableSub = stan.subscribe('foo', opts);
durableSub.on('message', function(msg) {
  console.log('Received a message: ' + msg.getData());
});
...
// client receives message sequence 1-40, and disconnects
stan.close();

// client reconnects in the future with same clientID
var stan = require('stan').connect('test-cluster', 'client-123');
var durableSub = stan.subscribe('foo', opts);
durableSub.on('message', function(msg) {
  console.log('Received a message: ' + msg.getData());
});
```

### Queue Groups

Subscriptions with the same queue name will form a queue group. Each message is only delivered to a single subscriber per queue group. You can have as many queue groups as you wish. Normal subscribers are not affected by queue group semantics.

Note that you cannot have a queue group that is also a durable subscriber.

```javascript
    var opts = stan.subscriptionOptions();
    opts.setStartWithLastReceived();
    var subscription = stan.subscribe('foo', 'foo.workers', opts);
```

### Asynchronous Publishing

For each message published, a [NUID](https://github.com/nats-io/nuid) is generated for the message on creation. When the message is received by the server, the client library is notified on its optional callback:

```javascript
    var guid = stan.publishAsync('foo', 'Hello World!', function(err, aGuid){
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


## License

(The MIT License)

Copyright (c) 2012-2016 Apcera Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
