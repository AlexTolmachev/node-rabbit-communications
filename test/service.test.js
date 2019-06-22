const { expect } = require('chai');
const { Service, RabbitClient } = require('../src');

const { RABBIT_URL } = process.env;


// TODO: add namespace constant and after hook exchange deletion

describe('Service (allows to exchange messages with it in both directions)', () => {
  const NAMESPACE = 'service.test.js';

  const createdQueues = [];
  let rabbitClient;

  before(() => {
    rabbitClient = new RabbitClient(RABBIT_URL, {
      appName: NAMESPACE,
      json: true,
    });
  });

  after(async () => {
    const channel = await rabbitClient.getChannel();

    await Promise.all(createdQueues.map(queueName => channel.deleteQueue(queueName)));
    await channel.deleteExchange(NAMESPACE);
  });

  it('start method throws exception if input channel is enabled but no listener provided', async () => {
    const service = new Service({
      name: `${NAMESPACE}-0`,
      isOutputEnabled: false,
      isInputEnabled: true,
      namespace: NAMESPACE,
      rabbitClient,
    });

    // no service.addInputListener(fn) call here..

    let isErrorCaught = false;

    try {
      await service.start();
    } catch (e) {
      isErrorCaught = true;
    }

    const { inputQueueName, outputQueueName } = service;

    createdQueues.push(inputQueueName);
    createdQueues.push(outputQueueName);

    expect(isErrorCaught).to.be.equal(true);
  });

  it('creates input and output queues', async () => {
    const serviceName = `${NAMESPACE}-1`;

    const service = new Service({
      isOutputEnabled: true,
      isInputEnabled: true,
      namespace: NAMESPACE,
      name: serviceName,
      rabbitClient,
    });

    service.addInputListener(() => {}); // required to start service

    await service.start();

    const { inputQueueName, outputQueueName } = service;

    createdQueues.push(inputQueueName);
    createdQueues.push(outputQueueName);

    expect(inputQueueName).to.be.a('string');
    expect(outputQueueName).to.be.a('string');
    expect(inputQueueName).to.be.equal(`${serviceName}:input`);
    expect(outputQueueName).to.include(`${serviceName}:output`);

    const doesInputQueueExist = await service.inputChannel.checkQueue(inputQueueName);
    const doesOutputQueueExist = await service.outputChannel.checkQueue(outputQueueName);

    expect(doesInputQueueExist).not.to.be.equal(undefined);
    expect(doesOutputQueueExist).not.to.be.equal(undefined);
  });

  it('allows to turn off input or output functionality', async () => {

  });

  it('calls listener on input queue messages', async () => {

  });

  it('sends messages to output queue', async () => {

  });

  it('requeues message to input queue on listener\'s exceptions', async () => {

  });

  it('passes itself to input listener and allows to send output messages using it', async () => {

  });
});
