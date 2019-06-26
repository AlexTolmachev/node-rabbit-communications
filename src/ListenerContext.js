module.exports = class ListenerContext {
  constructor({
    rabbitMessage,
    rabbitChannel,
    communicator,
    metadata,
    service,
    data,
  }) {
    this.communicator = communicator;
    this.message = rabbitMessage;
    this.channel = rabbitChannel;
    this.metadata = metadata;
    this.service = service;
    this.data = data;

    const entityInstance = service || communicator;

    this.reply = entityInstance.send.bind(entityInstance);
  }
};
