var assert = require('assert'),
    RadarClient = require('../lib/radar_client.js'),
    MockEngine = require('./lib/engine.js'),
    Request = require('../lib/message_request.js'),
    Response = require('../lib/message_response.js'),
    HOUR = 1000 * 60 * 60,
    client;

exports.RadarClient = {
  beforeEach: function() {
    client = new RadarClient(MockEngine);
  },

  afterEach: function() {
    MockEngine.current._written = [];
  },

  '.configuration': {
    'should return a deep copy of the configuration value for the key provided': function() {
      var configuration = { userId: 123, userData: { test: 1 }, accountName: 'dev' };
      client.configure(configuration);
      assert.notStrictEqual(configuration.userData, client.configuration('userData'));
    },

    'should never allow the configuration to be altered by reference': function() {
      var configuration = { userId: 123, userData: { test: 1 }, accountName: 'dev' };
      client.configure(configuration);
      client.configuration('userData').test = 2;
      assert.equal(configuration.userData.test, 1);
      assert.equal(client.configuration('userData').test, 1);
    }
  },

  '.currentClientId': {
    'should return the current socket id if a socket id is available': function(done) {
      client.configure({ userId: 123, accountName: 'dev' });
      client.alloc('test', function() {
        assert.equal(client.currentClientId(), client._socket.id);
        done();
      });
    }
  },

  '.alloc': {
    'should start the manager': function() {
      var called = false;
      client.manager.start = function() { called = true; };
      client.configure({ userId: 123, accountName: 'dev' });
      client.alloc('foo');
      assert.ok(called);
    },

    'should add the channel name to the hash of users': function() {
      assert.equal(client._uses.foo, undefined);
      client.alloc('foo');
      assert.equal(client._uses.foo, true);
    },

    'should add a callback for ready if a callback is passed': function() {
      var called = false;

      client.on = function(name, callback) {
        called = true;
        assert.equal(name, 'ready');
        assert.equal(typeof callback, 'function');
      };

      client.alloc('foo', function() {});
      assert.ok(called);
    }
  },

  '.dealloc': {
    'should delete the _uses property for a given channel name': function() {
      client.alloc('foo');
      assert.equal(client._uses.foo, true);
      client.dealloc('foo');
      assert.equal(client._uses.foo, undefined);
    },

    'should call close() on the manager if the are no open channels': function() {
      var called = true;
      client.manager.close = function() { called = true; };
      client.alloc('foo');
      assert.equal(client._uses.foo, true);
      client.dealloc('foo');
      assert.equal(client._uses.foo, undefined);
      assert.ok(called);
    }
  },

  '.configure': {
    'should not change the configuration if nothing is passed': function() {
      assert.deepEqual(client._configuration, { accountName: '', userId: 0, userType: 0 });
      client.configure();
      assert.deepEqual(client._configuration, { accountName: '', userId: 0, userType: 0 });
    },

    'should store the passed hash as a configuration property': function() {
      client.configure({ accountName: 'test', userId: 123, userType: 2 });
      assert.deepEqual(client._configuration, { accountName: 'test', userId: 123, userType: 2 });
    }
  },

  'scopes': {
    '.message should return a scope with the appropriate prefix': function() {
      client.configure({ accountName: 'test' });
      var scope = client.message('chatter/1');
      assert.equal(scope.prefix, 'message:/test/chatter/1');
    },

    '.presence should return a scope with the appropriate prefix': function() {
      client.configure({ accountName: 'test' });
      var scope = client.presence('chatter/1');
      assert.equal(scope.prefix, 'presence:/test/chatter/1');
    },

    '.status should return a scope with the appropriate prefix': function() {
      client.configure({ accountName: 'test' });
      var scope = client.status('chatter/1');
      assert.equal(scope.prefix, 'status:/test/chatter/1');
    }
  },

  '.set': {
    'should call _write() with a set operation definition hash': function() {
      var called = false, callback = function(){};

      client._write = function(request, fn) {
        called = true;
        assert.deepEqual(request.getMessage(), {
          op: 'set',
          to: 'status:/test/account/1',
          value: 'whatever',
          key: 123,
          type: 0
        });
        assert.equal(fn, callback);
      };

      client.configure({ accountName: 'test', userId: 123, userType: 0 });
      client.set('status:/test/account/1', 'whatever', callback);
      assert.ok(called);
    },

    'should not queue a presence set, but require restore': function() {
      client.configure({ accountName: 'test', userId: 123, userType: 0 });
      assert.ok(!client.manager.is('activated'));
      client.set('presence:/test/account/1', 'online');
      assert.ok(client._restoreRequired);
      assert.ok(!client.manager.is('activated'));
      assert.equal(client._queuedMessages.length, 0);
      assert.deepEqual(client._presences, { 'presence:/test/account/1': 'online' });
    },

    'should queue a presence set and require restore if there is a callback': function() {
      client.configure({ accountName: 'test', userId: 123, userType: 0 });
      assert.ok(!client.manager.is('activated'));
      client.set('presence:/test/account/1', 'online', function(){});
      assert.ok(client._restoreRequired);
      assert.ok(!client.manager.is('activated'));
      assert.equal(client._queuedMessages.length, 1);
      assert.deepEqual(client._presences, { 'presence:/test/account/1': 'online' });
    }
  },

  '.publish': {
    'should call _write() with a publish operation definition hash': function() {
      var called = false, callback = function(){};

      client._write = function(request, fn) {
        called = true;
        assert.deepEqual(request.getMessage(), {
          op: 'publish',
          to: 'message:/test/account/1',
          value: 'whatever'
        });
        assert.equal(fn, callback);
      };

      client.configure({ accountName: 'test', userId: 123, userType: 0 });
      client.publish('message:/test/account/1', 'whatever', callback);
      assert.ok(called);
    }
  },

  '.subscribe': {
    'should call _write() with a subscribe operation definition hash': function() {
      var called = false, callback = function(){};

      client._write = function(request, fn) {
        called = true;
        assert.deepEqual(request.getMessage(), {
          op: 'subscribe',
          to: 'status:/test/account/1'
        });
        assert.equal(fn, callback);
      };

      client.configure({ accountName: 'test', userId: 123, userType: 0 });
      client.subscribe('status:/test/account/1', callback);
      assert.ok(called);
    },

    'should not queue a subscribe operation if disconnected, but require restore': function() {
      client.configure({ accountName: 'test', userId: 123, userType: 0 });
      assert.ok(!client.manager.is('activated'));
      client.subscribe('status:/test/account/1');
      assert.ok(client._restoreRequired);
      assert.ok(!client.manager.is('activated'));
      assert.equal(client._queuedMessages.length, 0);
      assert.deepEqual(client._subscriptions, { 'status:/test/account/1': 'subscribe' });
    },

    'should queue a subscribe operation if disconnected and require restore if there is a callback': function() {
      client.configure({ accountName: 'test', userId: 123, userType: 0 });
      assert.ok(!client.manager.is('activated'));
      client.subscribe('status:/test/account/1', function(){});
      assert.ok(client._restoreRequired);
      assert.ok(!client.manager.is('activated'));
      assert.equal(client._queuedMessages.length, 1);
      assert.deepEqual(client._subscriptions, { 'status:/test/account/1': 'subscribe' });
    },

    'should not queue a sync operation if disconnected, but require restore': function() {
      client.configure({ accountName: 'test', userId: 123, userType: 0 });
      assert.ok(!client.manager.is('activated'));
      client.sync('presence:/test/account/1');
      assert.ok(client._restoreRequired);
      assert.ok(!client.manager.is('activated'));
      assert.equal(client._queuedMessages.length, 0);
      assert.deepEqual(client._subscriptions, { 'presence:/test/account/1': 'sync' });
    }
  },

  '.unsubscribe': {
    'should call _write() with a unsubscribe operation definition hash': function() {
      var called = false, callback = function(){};

      client._write = function(request, fn) {
        called = true;
        assert.deepEqual(request.getMessage(), {
          op: 'unsubscribe',
          to: 'status:/test/account/1',
        });
        assert.equal(fn, callback);
      };

      client.configure({ accountName: 'test', userId: 123, userType: 0 });
      client.unsubscribe('status:/test/account/1', callback);
      assert.ok(called);
    },

    'should not queue a message if the subscription was not in memory, but require restore': function() {
      client.configure({ accountName: 'test', userId: 123, userType: 0 });
      assert.ok(!client.manager.is('activated'));
      client.unsubscribe('presence:/test/account/1');
      assert.ok(client._restoreRequired);
      assert.ok(!client.manager.is('activated'));
      assert.equal(client._queuedMessages.length, 0);
      assert.deepEqual(client._subscriptions, {});
    },

    'should queue a message if the subscription was not in memory and require restore if there is a callback': function() {
      client.configure({ accountName: 'test', userId: 123, userType: 0 });
      assert.ok(!client.manager.is('activated'));
      client.unsubscribe('presence:/test/account/1', function(){});
      assert.ok(client._restoreRequired);
      assert.ok(!client.manager.is('activated'));
      assert.equal(client._queuedMessages.length, 1);
      assert.deepEqual(client._subscriptions, {});
    }
  },

  '.get': {
    'should call _write() with a get operation definition hash': function() {
      var called = false;

      client._write = function(request) {
        called = true;
        assert.deepEqual(request.getMessage(), {
          op: 'get',
          to: 'status:/test/account/1'
        });
      };

      client.configure({ accountName: 'test', userId: 123, userType: 0 });
      client.get('status:/test/account/1');
      assert.ok(called);
    },

    'should listen for the next get response operation': function() {
      var called = false;

      client.when = function(operation, fn) {
        called = true;
      };

      client.get('status:/test/account/1', function(){});
      assert.ok(called);
    },

    'should pass a function that will call the callback function for the get response operation with the scope provided': function() {
      var called = false,
          passed = false,
          scope = 'status:/test/account/1',
          message = { op: 'get', to: scope },
          response = new Response(message),
          callback = function(msg) {
            passed = true;
            assert.deepEqual(msg, message);
          };

      client.when = function(operation, fn) {
        called = true;
        fn(response);
      };

      client.get(scope, callback);
      assert.ok(called);
      assert.ok(passed);
    },

    'should pass a function that will not call the callback function for a get response operation with a different scope': function() {
      var called = false,
          passed = true,
          message = { op: 'get', to: 'status:/test/account/2' },
          response = new Response(message),
          callback = function(msg) {
            passed = false;
          };

      client.when = function(operation, fn) {
        called = true;
        fn(response);
      };

      client.get('status:/test/account/1', callback);
      assert.ok(called);
      assert.ok(passed);
    }
  },

  '.sync': {
    'should call _write() with a sync operation definition hash': function() {
      var called = false;

      client._write = function(request) {
        called = true;
        assert.deepEqual(request.getMessage(), {
          op: 'sync',
          to: 'status:/test/account/1'
        });
      };

      client.configure({ accountName: 'test', userId: 123, userType: 0 });
      client.sync('status:/test/account/1');
      assert.ok(called);
    },

    'with options': {
      'should listen for the next get response operation': function() {
        var called = false;

        client.when = function(operation, fn) {
          called = true;
        };

        client.sync('presence:/test/account/1', { version: 2 }, function(){});
        assert.ok(called);
      },

      'should pass a function that will call the callback function for the get response operation with the scope provided': function() {
        var called = false,
            passed = false,
            scope = 'presence:/test/account/1',
            message = { op: 'sync', to: scope },
            response = new Response(message),
            callback = function(msg) {
              passed = true;
              assert.deepEqual(msg, message);
            };

        client.when = function(operation, fn) {
          called = true;
          fn(response);
        };

        client.sync(scope, { version: 2 }, callback);
        assert.ok(called);
        assert.ok(passed);
      },

      'should pass a function that will not call the callback function for a get response operation with a different scope': function() {
        var called = false,
            passed = true,
            message = { op: 'sync', to: 'presence:/test/account/2' },
            response = new Response(message),
            callback = function(msg) {
              passed = false;
            };

        client.when = function(operation, fn) {
          called = true;
          fn(response);
        };

        client.sync('presence:/test/account/1', { version: 2 }, callback);
        assert.ok(called);
        assert.ok(passed);
      }
    },

    'without options on a presence': {
      'should force v2, translate result from v2 to v1': function(done) {
        var scope = 'presence:/test/account/1';

        client.sync(scope, function(m) {
          assert.deepEqual({
            op: 'online',
            to: scope,
            value: {
              100: 2,
              200: 0
            }
          }, m);
          done();
        });

        // Previous online emits should not affect the callback
        client.emit(scope, { op: 'online', to: scope, value: { 100: 2 } });

        var message = {
          op: 'get', to: scope,
          value: {
            100: { userType: 2, clients: {} },
            200: { userType: 0, clients: {} }
          }
        };

        var response = new Response(message);
        client.emit('get', response);
      }
    }
  },

  'internal methods': {
    '_memorize' : {
      'memorizing a sync/subscribe should work': function(done) {
        var request;

        assert.equal(0, Object.keys(client._subscriptions).length);
        request = Request.buildSubscribe('presence:/test/ticket/1');
        client._memorize(request);
        assert.equal(1, Object.keys(client._subscriptions).length);

        request = Request.buildSync('status:/test/ticket/1');
        client._memorize(request);
        assert.equal(2, Object.keys(client._subscriptions).length);

        request = Request.buildGet('status:/test/ticket/1');
        client._memorize(request);
        // Should be a no-op
        assert.equal(2, Object.keys(client._subscriptions).length);

        done();
      },

      'memorizing a set(online) and unmemorizing a set(offline) should work': function(done) {
        var request;

        assert.equal(0, Object.keys(client._presences).length);
        request = Request.buildSet('presence:/foo/bar', 'online');
        client._memorize(request);
        assert.equal('online', client._presences['presence:/foo/bar']);
        assert.equal(1, Object.keys(client._presences).length);
        // Duplicate should be ignored
        client._memorize(request);
        assert.equal(1, Object.keys(client._presences).length);

        request = Request.buildSet('presence:/foo/bar', 'offline');
        client._memorize(request);
        assert.equal(1, Object.keys(client._presences).length);
        assert.equal('offline', client._presences['presence:/foo/bar']);
        done();
      },

      'memorizing a unsubscribe should remove any sync/subscribe': function(done) {
        // Set up
        var request = Request.buildSubscribe('status:/test/ticket/1');
        client._memorize(request);
        request = Request.buildSync('status:/test/ticket/2');
        client._memorize(request);
        assert.equal(2, Object.keys(client._subscriptions).length);

        // Unsubscribe
        request = Request.buildUnsubscribe('status:/test/ticket/1');
        client._memorize(request);
        assert.equal(1, Object.keys(client._subscriptions).length);
        request = Request.buildUnsubscribe('status:/test/ticket/2');
        client._memorize(request);
        assert.equal(0, Object.keys(client._subscriptions).length);
        done();
      },

      'duplicated subscribes and syncs should only be stored once and sync is more important than subscribe': function(done) {
        // Simple duplicates
        var request = Request.buildSubscribe('status:/test/ticket/1');
        client._memorize(request);
        assert.equal(1, Object.keys(client._subscriptions).length);
        client._memorize(request);
        assert.equal(1, Object.keys(client._subscriptions).length);


        client._subscriptions = {};
        // Simple duplicates
        request = Request.buildSync('status:/test/ticket/2');
        client._memorize(request);
        assert.equal(1, Object.keys(client._subscriptions).length);
        client._memorize(request);
        assert.equal(1, Object.keys(client._subscriptions).length);

        client._subscriptions = {};
        // Sync after subscribe
        request = Request.buildSubscribe('status:/test/ticket/3');
        client._memorize(request);
        assert.equal(1, Object.keys(client._subscriptions).length);
        request = Request.buildSync('status:/test/ticket/3');
        client._memorize(request);
        assert.equal(1, Object.keys(client._subscriptions).length);
        assert.equal('sync', client._subscriptions['status:/test/ticket/3']);

        client._subscriptions = {};
        // Subscribe after sync
        request = Request.buildSync('status:/test/ticket/4');
        client._memorize(request);
        assert.equal(1, Object.keys(client._subscriptions).length);
        assert.equal('sync', client._subscriptions['status:/test/ticket/4']);
        // When we sync and subscribe, it means just sync
        request = Request.buildSubscribe('status:/test/ticket/4');
        client._memorize(request);
        assert.equal(1, Object.keys(client._subscriptions).length);
        assert.equal('sync', client._subscriptions['status:/test/ticket/4']);

        done();
      }
    },

    '_restore' : {
      'restore presences' : function(done){
        MockEngine.current._written = [];
        var request = Request.buildSet('presence:/foo/bar', 'online');
        client._memorize(request);
        request = Request.buildSet('presence:/foo/bar2', 'offline');
        client._memorize(request);
        client._restoreRequired = true;
        client.configure({ accountName: 'foo', userId: 123, userType: 2 });
        client.alloc('test', function() {
          assert.equal(MockEngine.current._written.length, 3);
          assert.ok(MockEngine.current._written.some(function(message) {
            return (message.op == 'set' &&
              message.to == 'presence:/foo/bar' &&
              message.value == 'online');
          }));
          assert.ok(MockEngine.current._written.some(function(message) {
            return (message.op == 'set' &&
              message.to == 'presence:/foo/bar2' &&
              message.value == 'offline');
          }));
          done();
        });
      },

      'restore subscriptions' : function(done){
        MockEngine.current._written = [];
        var request = Request.buildSubscribe('status:/foo/bar');
        client._memorize(request);
        request = Request.buildSubscribe('message:/foo/bar2');
        client._memorize(request);
        client._restoreRequired = true;
        client.configure({ accountName: 'foo', userId: 123, userType: 2 });
        client.alloc('test', function() {
          assert.equal(MockEngine.current._written.length, 3);
          assert.ok(MockEngine.current._written.some(function(message) {
            return (message.op == 'subscribe' &&
              message.to == 'status:/foo/bar');
          }));
          assert.ok(MockEngine.current._written.some(function(message) {
            return (message.op == 'subscribe' &&
              message.to == 'message:/foo/bar2');
          }));
          done();
        });
      },
    },
    '._write': {
      'should emit an authenticateMessage event': function() {
        var called = false,
            message = { op: 'subscribe', to: 'status:/account/scope/1'},
            request = Request.buildSubscribe(message.to);

        client.emit = function(name, data) {
          called = true;
          assert.equal(name, 'authenticateMessage');
          assert.deepEqual(data, message);
        };

        client._write(request.getMessage());
        assert.ok(called);
      },

      'should register an ack event handler that calls the callback function once the appropriate ack message has been received': function() {
        var called = false,
            passed = false,
            request = Request.buildSubscribe('status:/account/scope/1'),
            ackMessage = { value: -2 },
            callback = function(msg) {
              passed = true;
              assert.deepEqual(msg, request.getMessage());
            };

        client.when = function(name, fn) {
          called = true;
          assert.equal(name, 'ack');
          ackMessage.op = 'ack';
          ackMessage.value = request.getAttr('ack');
          var response = new Response(ackMessage);
          fn(response);
        };

        client._write(request, callback);
        assert.ok(called);
        assert.ok(passed);
      },

      'should register an ack event handler that does not call the callback function for ack messages with a different value': function() {
        var called = false,
            passed = true,
            request = Request.buildSubscribe('status:/account/scope/1'),
            ackMessage = { op: 'ack', value: -2 },
            response = new Response(ackMessage),
            callback = function(msg) { passed = false; };

        client.when = function(name, fn) {
          called = true;
          assert.equal(name, 'ack');
          fn(response);
        };

        client._write(request, callback);
        assert.ok(called);
        assert.ok(passed);
      }
    },

    '._batch': {
      'should ignore messages without the appropriate properties': {
        'op': function() {
          var message = { to: 'status:/dev/ticket/1', value: 'x', time: new Date() / 1000 },
              response;
          
          response = new Response(message);
          assert.deepEqual(client._channelSyncTimes, {});
        },

        'to': function() {
          var message = { op: 'subscribe', value: 'x', time: new Date() / 1000 },
              response;
          
          response = new Response(message);
          assert.deepEqual(client._channelSyncTimes, {});
        },

        'value': function() {
          var message = { op: 'subscribe', to: 'you', value: 'x'},
              response = new Response(message);

          assert.equal(client._channelSyncTimes.you, undefined);
          assert.ok(!client._batch(response));
          assert.equal(client._channelSyncTimes.you, undefined);
        },

        'time': function() {
          var message = { op: 'subscribe', to: 'you', value: 'x' },
              response = new Response(message);

          assert.equal(client._channelSyncTimes.you, undefined);
          assert.ok(!client._batch(response));
          assert.equal(client._channelSyncTimes.you, undefined);
        }
      },

      'should not ignore messages that have all the appropriate properties': function() {
        var now = new Date(),
            message = {
              op: 'subscribe',
              to: 'you',
              value: [ '{}', now ],
              time: now
            },
            response = new Response(message);

        assert.equal(client._channelSyncTimes.you, undefined);
        assert.notEqual(client._batch(response), false);
        assert.equal(client._channelSyncTimes.you, now);
      },

      'should emit an event named for the "to" property value if there is a time that is greater than the current channelSyncTime': function() {
        var called = false,
            now = new Date(),
            message = {
              op: 'subscribe',
              to: 'you',
              value: [ '{ "something": 1 }', now ],
              time: now
            },
            response = new Response(message);

        client._channelSyncTimes.you = now - HOUR;

        client.emitNext = function(name, data) {
          called = true;
          assert.equal(name, response.getAttr('to'));
          assert.deepEqual(data, JSON.parse(response.getAttr('value')[0]));
        };

        assert.notEqual(client._batch(response), false);
        assert.equal(client._channelSyncTimes.you, now);
        assert.ok(called);
      }
    },

    '._createManager': {
      'should create a manager that cannot open the same socket twice': function() {
        var never_called_before = true, called = false;

        client._createManager();

        client.manager.established = function() {
          called = true;
          assert(never_called_before);
          never_called_before = false;
        };

        client.manager.emit('connect');

        client._socket.emit('open');
        client._socket.emit('open');

        assert(called);
      },

      'should create a manager that stops listening to messages from a socket when the socket emits the close event': function() {
        var called = false;

        client._createManager();

        client.manager.emit('connect');

        client._socket.emit('open');

        client._socket.on('message', function(data) {
          var json = JSON.parse(data);
          called = json.open;
          assert(json.open);
        });

        client._socket.emit('message', '{"open":1}');

        client._socket.emit('close');

        assert(!client._socket);

        assert(called);
      },

      'should create a manager that listens for the appropriate events': {
        'enterState': function() {
          var state = 'test',
              called = false;

          client.emit = function(name) {
            called = true;
            assert.equal(name, state);
          };

          client._createManager();
          client.manager.emit('enterState', state);
          assert.ok(called);
        },

        'event': function() {
          var event = 'test',
              called = false;

          client.emit = function(name) {
            called = true;
            assert.equal(name, event);
          };

          client._createManager();
          client.manager.emit('event', event);
          assert.ok(called);
        },

        'connect and create a socket with the appropriate listeners': {
          'open': function() {
            var called = false;

            client._createManager();

            client.manager.can = function(name) {
              return name == 'established';
            };

            client.manager.established = function() {
              called = true;
            };

            client.manager.emit('connect');

            client._socket.emit('open');
            assert.ok(called);
          },

          'close': function() {
            var called = false;

            client._createManager();

            client.manager.disconnect = function() {
              called = true;
            };

            client.manager.emit('connect');

            client._socket.emit('close');

            assert.ok(called);
          },

          'message': function() {
            var called = false,
                message = { test: 1 };

            client._createManager();

            client._messageReceived = function(msg) {
              called = true;
              assert.equal(msg, message);
            };

            client.manager.emit('connect');

            client._socket.emit('message', message);

            assert.ok(called);
          }
        },

        'activate': {
          'and emits "authenticateMessage", "ready"': function() {
            var called = false;
            var count = 0;

            client.emit = function(name) {
              called = true;

              count++;
              if (1 == count) {
                assert.equal(name, 'authenticateMessage');
              }

              if (2 == count) {
                assert.equal(name, 'ready');
              }
            };

            client._createManager();
            client.manager.emit('connect');
            client.manager.emit('activate');
            assert.ok(called);
          },

          'and _write()s the messages asynchronously': function(done) {
            var count = 0,
                called = 0;

            while (count < 10) {
              client._queuedMessages.push({ test: count++ });
            }

            client._restoreRequired = true;

            client._write = function(message) {
              called += 1;
              if (called == count) {
                done();
              }
            };

            client._createManager();
            client.manager.emit('connect');
            client.manager.emit('activate');
          }
        },

        'authenticate': function() {
          var called = false;

          client._createManager();

          client.manager.activate = function() {
            called = true;
          };

          client.manager.emit('authenticate');
          assert.ok(called);
        }
      }
    },

    '._sendMessage': {
      'should call sendPacket() on the _socket if the manager is activated': function() {
        var called = false,
            request = Request.buildSubscribe('status:/test/ticket/1');

        client.manager.is = function(state) { return state == 'activated'; };

        client._socket = {
          sendPacket: function(name, data) {
            called = true;
            assert.equal(name, 'message');
            assert.equal(data, JSON.stringify(request.getMessage()));
          }
        };

        client._sendMessage(request);
        assert.ok(called);
      },

      'should queue the message if the client has been configured, but is not activated': function() {
        var request = Request.buildSet('status:/test/ticket/1', 'any_value');

        client.configure({});
        client._sendMessage(request);
        assert.deepEqual(request, client._queuedMessages[0]);
      },

      'should ignore the message if the client has not been configured': function() {
        var request = Request.buildSet('status:/test/ticket/1', 'any_value');

        assert.ok(!client._isConfigured);
        client._sendMessage(request);
        assert.equal(client._queuedMessages.length, 0);
      }
    },

    '._messageReceived': {
      'handles incoming messages from the socket connection for': {
        'err': function() {
          var called = false,
              message = {
                op: 'err',
              },
              json = JSON.stringify(message);

          client.emitNext = function(name, data) {
            if (name === 'message:in') return;
            called = true;
            assert.equal(name, message.op);
            assert.deepEqual(data.message, message);
          };

          client._messageReceived(json);
          assert.ok(called);
        },

        'ack': function() {
          var called = false,
              message = {
                op: 'ack',
                value: 1
              },
              json = JSON.stringify(message);

          client.emitNext = function(name, data) {
            if (name === 'message:in') return;
            called = true;
            assert.equal(name, message.op);
            assert.deepEqual(data.message, message);
          };

          client._messageReceived(json);
          assert.ok(called);
        },

        'get': function() {
          var called = false,
              message = {
                op: 'get',
                to: 'staus:/test/ticket/1'
              },
              json = JSON.stringify(message);

          client.emitNext = function(name, data) {
            if (name === 'message:in') return;
            called = true;
            assert.equal(name, message.op);
            assert.deepEqual(data.message, message);
          };

          client._messageReceived(json);
          assert.ok(called);
        },

        'sync': function() {
          var called = false,
              message = {
                op: 'sync',
                to: 'staus:/test/ticket/1'
              },
              json = JSON.stringify(message);

          client._batch = function(msg) {
            called = true;
            assert.deepEqual(msg.message, message);
          };

          client._messageReceived(json);
          assert.ok(called);
        },

        'everything else': function() {
          var called = false,
              message = {
                op: 'something',
                to: 'wherever'
              },
              json = JSON.stringify(message);

          client.emitNext = function(name, data) {
            if (name === 'message:in') return;

            called = true;
            assert.equal(name, message.to);
            assert.deepEqual(data, message);
          };

          client._messageReceived(json);
          assert.ok(called);
        }
      }
    }
  }
};


