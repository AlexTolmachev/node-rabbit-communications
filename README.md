# rabbit-communications

Configure two-way communication between microservices via RabbitMQ 📥 📤

* [Install](#install)
* [Basic concepts](#basic-concepts)
* [Usage example](#usage-example)
* [API Reference](#api-reference)

## Install

```bash
npm i rabbit-communications
```

## Basic concepts

This library provides several abstractions for communication
between individual services via __RabbitMQ__.
There are two main entities: __service__ and __communicator__.

The scheme of their interaction is as follows:

![Service-Communicator basic scheme](./assets/1.png)

As you can see, the __Service__ and its interaction channels (arrows)
are marked with the same color (green).
This is because the __Service__ is the main entity in the system,
and the __Communicator__ is _only connected_ to its channels.

---

You can build any data pipelines and service architectures
using __Services__ and __Communicators__, there's a pair of examples:

![Architecture example 1](./assets/2.png)
![Architecture example 2](./assets/3.png)

---

For cases when you have a main application that interacts
with many services at the same time,
there is a __CommunicatorManager__ in `rabbit-communications`,
which manages __pool of Communicators__ and provides helpful features
like outputListener's middleware, RabbitMQ connection sharing and other cool features.

Here is a diagram of the service architecture using the manager:

![CommunicatorManager example](./assets/4.png)

## Usage example

Let's write a Service and Communicator that will exchange "ping-pong" messages and log it into the console.

__service.js__
```javascript
const { Service } = require('rabbit-communications');

(async () => {
  const service = new Service({
    namespace: 'my-services', // namespace must be the same
    name: 'example-1',
    isInputEnabled: true,
    isOutputEnabled: true,
    shouldDiscardMessages: true,
    rabbitOptions: {
      url: 'amqp://guest:guest@localhost:5672',
    },
  });
  
  service.addInputListener(async (ctx) => {
    console.log(`Received message from Communicator: ${ctx.data.message}`);
    
    // echo, will trigger Communicator's output listener
    await ctx.reply({ message: 'pong' });
  });
  
  await service.start(); // returns promise
})()
```

__communicator.js__
```javascript
const { Communicator } = require('rabbit-communications');

(async () => {
  const communicator = new Communicator({
    namespace: 'my-services', // namespace must be the same
    targetServiceName: 'example-1',
    isInputEnabled: true,
    isOutputEnabled: true,
    shouldDiscardMessages: true,
    rabbitOptions: { // and the RabbitMQ configuration, obviously, should also be the same :)
      url: 'amqp://guest:guest@localhost:5672',
    },
  });
  
  communicator.addOutputListener((ctx) => {
    console.log(`Received message from Service: ${ctx.data.message}`);
  });
  
  await communicator.start();
  
  // this will trigger Service's input listener
  await communicator.send({ message: 'ping' });
})();
```

In this example, the following happens:

1. __Service__ instance is created and started with _input callback added_ (`service.addInputListener(fn)` call)
2. __Communicator__ instance is created and started with _service's output callback added_ (`communicator.addOutputListener(fn)` call)
3. Communicator sends "ping" message to service's __input channel__ (`communicator.send(data)` call)
4. Service logs it and responds with "pong" message to it's __output channel__ (input listener callback invocation)
5. Communicator receives service's "pong" output and logs it (output listener callback invocation)

---

After writing these two simple applications,
you need to start RabbitMQ,
after which you need to start the applications themselves.

_In this example, we will use Docker to start RabbitMQ:_

```bash
$ docker run -d -p 5672:5672 -p 15672:15672 rabbitmq:management
```

Service app launch:
```bash
$ node service.js
```

Communicator app launch:
```bash
$ node communicator.js
```

Now, when all the necessary things are running,
in the service`s output you will see the following:

```text
Service "example-1" successfully started
﹂RabbitMQ connection url: amqp://guest:guest@localhost:5672
﹂Input queue name: my-services:example-1:input
﹂Output queue name: my-services:example-1:output

Received message from Communicator: ping
```

And in the output of the communicator is:

```text
Communicator for service "example-1" successfully started
﹂RabbitMQ connection url: amqp://guest:guest@localhost:5672
﹂Target service's input queue name: my-services:example-1:input
﹂Target service's output queue name: my-services:example-1:output

Received message from Service: pong
```

If you are interested in the queues topology in RabbitMQ,
then you can go to the browser at http://localhost:15672 (RabbitMQ management board)
with login "guest" and password "guest".

There you will see the __exchange `my-services`__
(this is the name of the __namespace__ from the service and communicator configurations),
to which __two queues__ are binded: `my-services:example-1:input`
and `my-services:example-1:output`
(these queues are generated automatically,
their names are in the application logs above)

## API Reference

* [RabbitClient](#rabbitclient)
* [Service](#service)
* [Communicator](#communicator)

---

### RabbitClient

```javascript
const { RabbitClient } = require('rabbit-communications');
```

`rabbit-communications` exports RabbitClient
class from [rabbit-client](https://www.npmjs.com/package/rabbit-client) npm package.
Documentation and usage examples can be found on the it's npm page.

You can pass RabbitClient instance to Service, Communicator and CommunicatorManager constructors,
if you don't, RabbitClient will be created under the hood (configured from rabbitOptions)

---

### Service

```javascript
const { Service } = require('rabbit-communications');
```

* [constructor(settings)](#constructorsettings)
* [.addInputListener(fn)](#addinputlistenerfn)
* [.send(data, metadata = {})](#senddata-metadata--)
* [.start()](#start)

#### constructor(settings)

Create Service instance.

```javascript
const service1 = new Service({
  namespace: 'my-namespace',
  name: 'my-service-1',
  isOutputEnabled: true,
  isInputEnabled: true,
  shouldDiscardMessages: false,
  rabbitOptions: {
    url: 'amqp://guest:guest@localhost:5672',
  },
});

// or

const rabbitClient = new RabbitClient('amqp://guest:guest@localhost:5672', {
  appName: 'my-rabbit-client',
  disableLogging: true,
  json: true,
});

const service2 = new Service({
  namespace: 'my-namespace',
  name: 'my-service-2',
  isOutputEnabled: true,
  isInputEnabled: true,
  shouldDiscardMessages: false,
  rabbitClient, // RabbitClient instance is passed instead of rabbitOptions
});
```

##### Settings description:

- __namespace__ - the name of the service group used
    to distinguish them based on their part of your system,
    for example, `namespace "shop" -> service "accounts"`
    and `namespace "social" -> service "accounts"`
- __name__ - service name used to connect Сommunicators
- __isOutputEnabled__ - whether the service should send messages to Communicator
- __isInputEnabled__ - whether the service should receive messages from the Communicator
- __shouldDiscardMessages__ - whether the service should delete messages instead of returning
    them back to the input queue if an error occurred during its processing
- __rabbitOptions__ - settings for connecting to RabbitMQ
    (used if rabbitClient was not passed to the constructor)
- __rabbitClient__ - [RabbitClient](#rabbitclient) instance
    (if rabbitClient is passed, rabbitOptions are ignored)

#### .addInputListener(fn)

Add callback to messages from __input queue__.

_If you passed `isInputEnabled: true` to the Service constructor,
you __must__ add input listener before `service.start()` is called._

```javascript
service.addInputListener((ctx) => {
  // your awesome input handler goes here..
})
```

#### .send(data, metadata = {})

Send message to __output queue__.

```javascript
await service.send({ foo: 'bar' });
```

#### .start()

Start service (input and output queues and channels are created).

```javascript
await service.start();
```

---

### Communicator

```javascript
const { Communicator } = require('rabbit-communications');
```

* [constructor(settings)](#constructorsettings)
* [.addOutputListener(fn)](#addoutputlistenerfn)
* [.send(data, metadata = {})](#senddata-metadata---1)
* [.start()](#start-1)

#### constructor(settings)

Create Service instance.

```javascript
const communicator1 = new Communicator({
  namespace: 'my-namespace',
  targetServiceName: 'my-service-1',
  isOutputEnabled: true,
  isInputEnabled: true,
  shouldDiscardMessages: false,
  rabbitOptions: {
    url: 'amqp://guest:guest@localhost:5672',
  },
});

// or

const rabbitClient = new RabbitClient('amqp://guest:guest@localhost:5672', {
  appName: 'my-rabbit-client',
  disableLogging: true,
  json: true,
});

const communicator2 = new Communicator({
  namespace: 'my-namespace',
  targetServiceName: 'my-service-1',
  isOutputEnabled: true,
  isInputEnabled: true,
  shouldDiscardMessages: false,
  rabbitClient,
});
```

##### Settings description:

- __namespace__ - the name of the service group used
    to distinguish them based on their part of your system,
    for example, `namespace "shop" -> service "accounts"`
    and `namespace "social" -> service "accounts"`
- __targetServiceName__ - name of the service to which communicator will be connected
- __isOutputEnabled__ - whether the communicator should listen service's output queue
- __isInputEnabled__ - will the communicator send messages to service's input queue
- __shouldDiscardMessages__ - whether the communicator should delete messages instead of returning
    them back to the service's output queue if an error occurred during its processing
- __rabbitOptions__ - settings for connecting to RabbitMQ
    (used if rabbitClient was not passed to the constructor)
- __rabbitClient__ - [RabbitClient](#rabbitclient) instance
    (if rabbitClient is passed, rabbitOptions are ignored)
    
#### .addOutputListener(fn)

Add callback to messages from __service's output queue__.

_If you passed `isOutputEnabled: true` to the Communicator constructor,
you __must__ add service output listener before `communicator.start()` is called._

```javascript
service.addOutputListener((ctx) => {
  // your awesome service output handler goes here..
})
```

#### .send(data, metadata = {})

Send message to service's __input queue__.

```javascript
await service.send({ foo: 'bar' });
```

#### .start()

Start communicator (connect to the target service input and output channels).

```javascript
await communicator.start();
```

## License

MIT.
