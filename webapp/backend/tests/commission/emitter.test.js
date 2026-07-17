const Suite = require('../lib/runner');

module.exports = async function () {
    const s = new Suite('Commission — Emitter (Event-Driven Architecture Tests)');

    const emitter = require('../../services/commission/emitter');

    await s.run([
        {
            name: 'Emitter is an EventEmitter instance',
            fn: () => {
                if (typeof emitter.on !== 'function') throw new Error('Missing on() method');
                if (typeof emitter.emit !== 'function') throw new Error('Missing emit() method');
            }
        },
        {
            name: 'Emitter can register and emit collection.created',
            fn: () => {
                let received = null;
                const handler = (data) => { received = data; };
                emitter.on('collection.created', handler);
                emitter.emit('collection.created', { collection: { id: 1 } });
                emitter.removeListener('collection.created', handler);
                if (!received) throw new Error('Handler not called');
                if (received.collection.id !== 1) throw new Error('Wrong data');
            }
        },
        {
            name: 'Emitter can register and emit return.posted',
            fn: () => {
                let received = null;
                const handler = (data) => { received = data; };
                emitter.on('return.posted', handler);
                emitter.emit('return.posted', { returnData: { id: 2 }, repId: 4 });
                emitter.removeListener('return.posted', handler);
                if (!received) throw new Error('Handler not called');
                if (received.repId !== 4) throw new Error('Wrong repId');
            }
        },
        {
            name: 'Emitter can register and emit invoice.cancelled',
            fn: () => {
                let received = null;
                const handler = (data) => { received = data; };
                emitter.on('invoice.cancelled', handler);
                emitter.emit('invoice.cancelled', { invoiceId: 10 });
                emitter.removeListener('invoice.cancelled', handler);
                if (!received) throw new Error('Handler not called');
                if (received.invoiceId !== 10) throw new Error('Wrong invoiceId');
            }
        },
        {
            name: 'Emitter supports multiple listeners on same event',
            fn: () => {
                let count = 0;
                const h1 = () => { count++; };
                const h2 = () => { count++; };
                emitter.on('test.multi', h1);
                emitter.on('test.multi', h2);
                emitter.emit('test.multi', {});
                emitter.removeListener('test.multi', h1);
                emitter.removeListener('test.multi', h2);
                if (count !== 2) throw new Error('Expected 2 calls, got ' + count);
            }
        },
    ]);

    return s;
};
