# rabbit-communications

## Install

```bash
npm i rabbit-communications
```

## Basic concepts

This library provides several abstractions for communication between individual services.
There are two main entities: __service__ and __communicator__.

The scheme of their interaction is as follows:

![Service-Communicator basic scheme](./assets/1.png)

As you can see, the __Service__ and its interaction channels (arrows)
are marked with the same green color (green).
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
there is a __CommunicatorManager__ in `rabbit-communications`, here's the scheme:

![CommunicatorManager example](./assets/4.png)

## License

MIT.
