const { expect } = require('chai');
const { Service, Communicator, RabbitClient } = require('../src');

describe('Communicator (connects to specific Service for two-way communication)', () => {
  before(async () => {

  });

  after(async () => {

  });


  it('allows to turn off input or output functionality (ex. ignore service, stop consuming it\'s messages)', async () => {

  });

  it('start method waits for target Service to start (if no Service\'s queues found)', async () => {

  });

  it('start method throws exception if service output channel is not turned off but no listener provided', async () => {

  });

  it('calls listener on service\'s output queue messages', async () => {

  });

  it('sends messages to service\'s input queue', async () => {

  });

  it('requeues messages to service\'s output queue on listener\'s exceptions', async () => {

  });

  it('passes itself to service\'s output listener and allows to send messages to service\'s input queue using it', async () => {

  });
});
