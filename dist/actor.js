'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var utils = require('@dxworks/utils');

/**
 * @license
 * Copyright (c) 2018 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at
 * http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at
 * http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */
const POLLING_INTERVAL = 50;
const DB_PREFIX = 'ACTOR-DATABASE';
const OBJECT_STORE_NAME = 'LIST';
const watchableMessageStore = _name => {
  const name = _name;
  const objStoreName = OBJECT_STORE_NAME;
  const dbName = `${DB_PREFIX}.${name}`;
  let lastCursorId = 0;
  const resetCursor = () => (lastCursorId = 0);
  const init = () => new Promise((resolve, reject) => {
    const connection = indexedDB.open(dbName);
    connection.onerror = () => {
      reject(connection.error);
    };
    connection.onsuccess = () => {
      resolve(connection.result);
    };
    connection.onupgradeneeded = () => {
      !connection
        .result
        .objectStoreNames
        .contains(objStoreName) &&
      connection
        .result
        .createObjectStore(objStoreName, {
          autoIncrement: true,
        });
    };
  });
  const database = init();
  const bcc = ('BroadcastChannel' in self) && new BroadcastChannel(name);
  const popMessages = async (recipient, { keepMessage = false } = {}) => {
    const transaction = (await database).transaction(objStoreName, 'readwrite');
    const cursorRequest = transaction
      .objectStore(objStoreName)
      .openCursor(IDBKeyRange.lowerBound(lastCursorId, true));
    return new Promise((resolve, reject) => {
      const messages = [];
      cursorRequest.onerror = () => {
        reject(cursorRequest.error);
      };
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          const { value } = cursor;
          if (value.recipient === recipient || recipient === '*') {
            messages.push(value);
            if (!keepMessage) {
              cursor.delete();
            }
          }
          cursor.continue();
          lastCursorId = cursor.key;
        } else {
          resolve(messages);
        }
      };
    });
  };
  const pushMessage = async message => {
    (message.recipient === '*') && utils._throw('Can’t send a message to reserved name "*"');
    const transaction = (await database).transaction(objStoreName, 'readwrite');
    return new Promise((resolve, reject) => {
      transaction.onerror = () => {
        reject(transaction.error);
      };
      transaction.oncomplete = () => {
        bcc && bcc.postMessage({ recipient: message.recipient });
        resolve();
      };
      transaction.objectStore(objStoreName).add(message);
    });
  };
  const subscribeWithBroadcastChannel = (recipient, callback) => {
    const channel = new BroadcastChannel(name);
    const channelCallback = async evt => {
      const ping = evt.data;
      if (ping.recipient !== recipient) {
        return;
      }
      const messages = await popMessages(recipient);
      if (messages.length > 0) {
        callback(messages);
      }
    };
    channel.addEventListener('message', channelCallback);
    channelCallback(new MessageEvent('message', { data: { recipient } }));
    return () => {
      channel.close();
    };
  };
  const subscribeWithPolling = (recipient, callback) => {
    let timeout = -1;
    const pollCallback = async () => {
      const messages = await popMessages(recipient);
      if (messages.length > 0) {
        callback(messages);
      }
      timeout = setTimeout(pollCallback, POLLING_INTERVAL);
    };
    timeout = setTimeout(pollCallback, POLLING_INTERVAL);
    return () => {
      self.clearTimeout(timeout);
    };
  };
  const subscribe = (recipient, callback) => (
    ('BroadcastChannel' in self)
      ? subscribeWithBroadcastChannel(recipient, callback)
      : subscribeWithPolling(recipient, callback)
  );
  return message => (
    message === 'resetCursor'
    ? resetCursor
    : message === 'init'
    ? init
    : message === 'popMessages'
    ? popMessages
    : message === 'pushMessage'
    ? pushMessage
    : message === 'subscribeWithBroadcastChannel'
    ? subscribeWithBroadcastChannel
    : message === 'subscribeWithPolling'
    ? subscribeWithPolling
    : message === 'subscribe'
    ? subscribe
    : console.log(`Message not handled: ${message}`)
  );
};

/**
 * @license
 * Copyright (c) 2018 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at
 * http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at
 * http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */
const actor = _init => {
  const init = _init || (async () => {});
  const initPromise = () => Promise.resolve().then(() => init());
  return message => (message === 'initPromise'
  ? initPromise
  : console.log(`Message not handled: ${message}`));
};
const messageStore = watchableMessageStore('ACTOR-MESSAGES');
async function hookup(actorName, _behavior, { purgeExistingMessages = false } = {}) {
  const behavior = _behavior();
  await behavior('initPromise')();
  messageStore('resetCursor')();
  purgeExistingMessages && await messageStore('popMessages')(actorName);
  const hookdown = messageStore('subscribe')(actorName, messages => {
    for (const message of messages) {
      try {
        behavior(message.handler)(message.detail);
      } catch (e) {
        console.error(e);
      }
    }
  });
  return async () => {
    hookdown();
    await messageStore('popMessages')(actorName);
  };
}
const lookup = actorName => {
  const send = handler => async message => {
    await messageStore('pushMessage')({ recipient: actorName, handler, detail: message });
  };
  return handler => send(handler);
};
const initializeQueues = async () => {
  await messageStore('popMessages')('*');
};

exports.actor = actor;
exports.hookup = hookup;
exports.lookup = lookup;
exports.initializeQueues = initializeQueues;
