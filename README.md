# rabbit-communications

Configure two-way communication between microservices via RabbitMQ 📥 📤

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
like outputListener's middleware and RabbitMQ connection sharing.

Here is a diagram of the service architecture using the manager:

![CommunicatorManager example](./assets/4.png)

## Usage

### Service/Communicator

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
    
    await ctx.reply({ message: 'pong' }); // echo, will trigger Communicator's output listener
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
    rabbitOptions: {
      url: 'amqp://guest:guest@localhost:5672', // and the RabbitMQ configuration, obviously, should also be the same :)
    },
  });
  
  communicator.addOutputListener((ctx) => {
    console.log(`Received message from Service: ${ctx.data.message}`);
  });
  
  await communicator.start();
  
  await communicator.send({ message: 'ping' }); // this will trigger Service's input listener
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

## License

MIT.
