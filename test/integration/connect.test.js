'use strict';

const CoinifyRabbit = require('../../lib/CoinifyRabbit');

describe('Integration tests', () => {
  describe('Connection', () => {

    let taskName, fullTaskName;
    const serviceName = 'my-test-service';

    const enqueueOptions = { exchange: { autoDelete: true } };
    const consumeOptions = { exchange: { autoDelete: true }, queue: { autoDelete: true } };

    let rabbit;

    beforeEach(() => {
      rabbit = new CoinifyRabbit({ service: { name: serviceName } });
      taskName = 'my-task' + Math.random();
      fullTaskName = serviceName + '.' + taskName;
    });

    afterEach(async () => {
      await rabbit.shutdown();
    });

    it('should reconnect and re-attach registered consumers on unexpected disconnect', async () => {
      return new Promise(async (resolve) => {
        let eventConsumed = false;
        let taskConsumed = false;

        const eventContext = { eventContext: true };
        const taskContext = { taskContext: true };

        const _consumed = async () => {
          if (eventConsumed && taskConsumed) {
            // If both events were consumed, we can resolve the promise..:!
            resolve();
          }
        };

        // Store connection and channel objects so we can check that new ones were made
        const initialConnection = await rabbit._getConnection();
        const initialChannel = await rabbit._getChannel();

        // Attach an event consumer and a task consumer
        await rabbit.registerEventConsumer(serviceName + '.my-event', async (c, e) => {
          expect(c).to.deep.equal(eventContext);
          expect(e.eventName).to.equal('my-test-service.my-event');
          eventConsumed = true;
          await _consumed();
        }, consumeOptions);

        await rabbit.registerTaskConsumer('my-task', async (c, t) => {
          expect(c).to.deep.equal(taskContext);
          expect(t.taskName).to.equal('my-test-service.my-task');
          taskConsumed = true;
          await _consumed();
        }, consumeOptions);

        // Now we have attached two consumers, time to fake a disconnect:
        rabbit._conn.connection.onSocketError(new Error('my err'));

        // Wait a moment
        await new Promise(resolve => setTimeout(resolve, 250));

        // Check that we have new connection and channel objects
        expect(await rabbit._getConnection()).to.not.equal(initialConnection);
        expect(await rabbit._getChannel()).to.not.equal(initialChannel);

        // Emit an event and a enqueue a task to check that the consumers have been re-attached
        await rabbit.emitEvent('my-event', eventContext, enqueueOptions);
        await rabbit.enqueueTask('my-test-service.my-task', taskContext, enqueueOptions);
      });
    });

    it('should not reconnect on requested shutdown()', async () => {
      // Connect
      await rabbit._getChannel();

      // Close again
      await rabbit.shutdown();

      // No connections/channels nor attempts to connect
      expect(rabbit._conn).to.equal(undefined);
      expect(rabbit._getConnectionPromise).to.equal(undefined);
      expect(rabbit._channel).to.equal(undefined);
      expect(rabbit._getChannelPromise).to.equal(undefined);
    });

  });
});