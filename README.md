# rabbit-communications

Configure two-way communication between microservices via RabbitMQ 📥 📤

* [Install](#install)
* [Test](#test)
* [Basic concepts](#basic-concepts)
* [Usage example](#usage-example)
* [API Reference](#api-reference)
* [Coming soon](#coming-soon)

## Install

```bash
npm i rabbit-communications
```

## Test

[See test files](./test)

```bash
$ docker run -d -p 5672:5672 rabbitmq
$ export RABBIT_URL=amqp://guest:guest@localhost:5672
$ npm test
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
there is a __CommunicationsManager__ in `rabbit-communications`,
which manages __pool of Communicators__ and provides helpful features
like outputListener's middleware, RabbitMQ connection sharing and other cool features.

Here is a diagram of the service architecture using the manager:

![CommunicationsManager example](./assets/4.png)

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
* [CommunicationsManager](#communicationsmanager)

---

### RabbitClient

```javascript
const { RabbitClient } = require('rabbit-communications');
```

`rabbit-communications` exports RabbitClient
class from [rabbit-client](https://www.npmjs.com/package/rabbit-client) npm package.
Documentation and usage examples can be found on the it's npm page.

You can pass RabbitClient instance to Service, Communicator and CommunicationsManager constructors,
if you don't, RabbitClient will be created under the hood (configured from rabbitOptions)

---

### Service

```javascript
const { Service } = require('rabbit-communications');
```

* [constructor(settings)](#constructorsettings)
* [.addInputListener(fn)](#addinputlistenerfn)
* [.addAskListener(subject, fn)](#addasklistenersubject-fn)
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
  metadata: {
    foo: 'bar',
  },
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
  metadata: {
    foo: 'bar',
  },
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
- __metadata__ - object, that would be sent with every output message
    and could be accessed via `ctx.metadata` in listener
- __metadata__ - object, that would be sent with every service input message
    and could be accessed via `ctx.metadata` in listener
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

#### .addAskListener(subject, fn)

Add [ask](#asksubject-data-metadata--) callback

_For this to work you need to enable both input and output channels_

```javascript
service.addAskListener('echo', async (ctx) => {
  // your awesome ask handler goes here, for example:
  
  await ctx.reply(ctx.data);
});
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

* [constructor(settings)](#constructorsettings-1)
* [.addOutputListener(fn)](#addoutputlistenerfn)
* [.send(data, metadata = {})](#senddata-metadata---1)
* [.ask(subject, data, metadata = {})](#asksubject-data-metadata--)
* [.start()](#start-1)

#### constructor(settings)

Create Communicator instance.

```javascript
const communicator1 = new Communicator({
  namespace: 'my-namespace',
  targetServiceName: 'my-service-1',
  useAsk: false,
  askTimeout: 5e3,
  isOutputEnabled: true,
  isInputEnabled: true,
  shouldDiscardMessages: false,
  metadata: {
    foo: 'bar',
  },
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
  useAsk: false,
  askTimeout: 5e3,
  isOutputEnabled: true,
  isInputEnabled: true,
  shouldDiscardMessages: false,
  metadata: {
    foo: 'bar',
  },
  rabbitClient,
});
```

##### Settings description:

- __namespace__ - the name of the service group used
    to distinguish them based on their part of your system,
    for example, `namespace "shop" -> service "accounts"`
    and `namespace "social" -> service "accounts"`
- __targetServiceName__ - name of the service to which communicator will be connected
- __useAsk__ - set it to true if you want to use [ask](#asksubject-data-metadata--) method,
    this will enable both input and output channels automatically
- __askTimeout__ - the number of milliseconds for which the service will have
    to respond when using the [ask](#asksubject-data-metadata--) method
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
});
```

#### .send(data, metadata = {})

Send message to service's __input queue__.

```javascript
await service.send({ foo: 'bar' });
```

#### .ask(subject, data, metadata = {})

`Ask` service (receive response from
service's [.addAskListener(subject, fn)](#addasklistenersubject-fn) callback)

```javascript
const { data, metadata } = await communicator.ask('ping', { foo: 'bar' });
```

#### .start()

Start communicator (connect to the target service input and output channels).

```javascript
await communicator.start();
```

---

## CommunicationsManager

```javascript
const { CommunicationsManager } = require('rabbit-communications');
```

* [constructor(settings)](#constructorsettings-2)
* [.registerCommunicator(targetServiceName, communicatorOptions, outputListener)](#registercommunicatortargetservicename-communicatoroptions-outputlistener)
* [.send(targetServiceName, data, metadata = {})](#sendtargetservicename-data-metadata--)
* [.ask(targetServiceName, subject, data, metadata = {})](#asktargetservicename-subject-data-metadata--)
* [.broadcast(data, metadata = {})](#broadcastdata-metadata--)
* [.applyMiddleware(...args)](#applymiddlewareargs)
* [.addOutputListener(targetServiceName, fn)](#addoutputlistenertargetservicename-fn)
* [.start()](#start-2)

#### constructor(settings)

Create CommunicationsManager instance.

```javascript
const manager1 = new CommunicationsManager({
  namespace: 'my-namespace',
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

const manager2 = new CommunicationsManager({
  namespace: 'my-namespace',
  rabbitClient,
});
```

_All manager’s communicators will use the same RabbitClient instance._

##### Settings description:

- __namespace__ - namespace in which all communicators controlled by the manager will work
- __rabbitOptions__ - settings for connecting to RabbitMQ
    (used if rabbitClient was not passed to the constructor)
- __rabbitClient__ - [RabbitClient](#rabbitclient) instance
    (if rabbitClient is passed, rabbitOptions are ignored)
    
#### .registerCommunicator(targetServiceName, communicatorOptions, outputListener)

Create and configure communicator.

_`outputListener` argument is optional, you can add
listener method later using `addOutputListener` or not add at all if you don't need_

```javascript
manager.registerCommunicator('my-service-1', {
  isInputEnabled: true,
  isOutputEnabled: false,
});

// or

manager.registerCommunicator(
  'my-service-2',
  {
    isInputEnabled: false,
    isOutputEnabled: true,
  },
  (ctx) => {
    // your awesome service output handler goes here..
  },
);
```

#### .send(targetServiceName, data, metadata = {})

Send message to specific service.

_Communicator for `targetServiceName` must be registered for this action_

```javascript
await manager.send('my-service-1', { foo: 'bar' });
```

#### .ask(targetServiceName, subject, data, metadata = {})

`Ask` service (receive response from
service's [.addAskListener(subject, fn)](#addasklistenersubject-fn) callback)

#### .broadcast(data, metadata = {})

Send message to all registered services.

```javascript
await manager.broadcast({ foo: 'bar' });
```

#### .applyMiddleware(...args)

Apply [async koa-like](https://www.npmjs.com/package/koa#async-functions-node-v76)
middleware functions for `outputListeners`.

There are several ways to use this method:

- `.applyMiddleware(func)` - single middleware for all listeners
- `.applyMiddleware([func1, func2, func3])` - multiple middleware functions for all listeners
- `.applyMiddleware(targetServiceName, func)` - single middleware for specific listener
- `.applyMiddleware(targetServiceName, [func1, func2, func3])` - multiple middleware functions for specific listener
- `.applyMiddleware([name1, name2], func)` - single middleware for several specific listeners
- `.applyMiddleware([name1, name2], [func1, func2, func3])` - multiple middleware functions for several specific listeners

```javascript
manager.applyMiddleware(async (ctx, next) => {
  console.time('Output listener execution time');
  
  await next(); // wait for all middleware chain to execute
  
  console.timeEnd('Output listener execution time');
});

manager.addOutputListener('my-service-1', async (ctx) => {
  await new Promise(resolve => setTimeout(resolve, 1500));
});
```

#### .addOutputListener(targetServiceName, fn)

Add output listener for specific registered communicator.

```javascript
manager.addOutputListener('my-service-1', (ctx) => {
  // your awesome service output handler goes here..
});
```

#### .start()

Start manager and all registered communicators.

```javascript
await manager.start();
```

## Coming soon

- Allow to pass custom input/output processing function
  (not just default JSON.parse/JSON.stringify)
- Add communicator.ask(type, data, metadata) method mapping
  service's output messages with input messages.
  For example, `authCommunicator.ask('login', { token: 'pih8gw1a32' })`
- Add JSDoc or TS-typings

## License

MIT.
