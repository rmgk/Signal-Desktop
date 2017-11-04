/*global $, Whisper, Backbone, textsecure, extension*/
/*
 * vim: ts=4:sw=4:expandtab
 */

// This script should only be included in background.html
(function () {
    'use strict';

    window.Whisper = window.Whisper || {};

    var conversations = new Whisper.ConversationCollection();
    var inboxCollection = new (Backbone.Collection.extend({
        initialize: function() {
            this.on('change:timestamp change:name change:number', this.sort);

            this.listenTo(conversations, 'add change:active_at', this.addActive);

            this.on('add remove change:unreadCount',
                _.debounce(this.updateUnreadCount.bind(this), 1000)
            );
            this.startPruning();
        },
        comparator: function(m1, m2) {
            var timestamp1 = m1.get('timestamp');
            var timestamp2 = m2.get('timestamp');
            if (timestamp1 && !timestamp2) {
                return -1;
            }
            if (timestamp2 && !timestamp1) {
                return 1;
            }
            var title1 = m1.getTitle().toLowerCase();
            var title2 = m2.getTitle().toLowerCase();
            if (title1 === title2) {
                return 0;
            }
            if (title1 < title2) {
                return -1;
            }
            if (title1 > title2) {
                return 1;
            }
        },
        addActive: function(model) {
            if (model.get('active_at')) {
                this.add(model);
            } else {
                this.remove(model);
            }
        },
        updateUnreadCount: function() {
            var newUnreadCount = _.reduce(
                this.map(function(m) { return m.get('unreadCount'); }),
                function(item, memo) {
                    return item + memo;
                },
                0
            );
            storage.put("unreadCount", newUnreadCount);

            if (newUnreadCount > 0) {
                window.setBadgeCount(newUnreadCount);
                window.document.title = "Signal (" + newUnreadCount + ")";
            } else {
                window.setBadgeCount(0);
                window.document.title = "Signal";
            }
        },
        startPruning: function() {
            var halfHour = 30 * 60 * 1000;
            this.interval = setInterval(function() {
                this.forEach(function(conversation) {
                    conversation.trigger('prune');
                });
            }.bind(this), halfHour);
        }
    }))();

    window.getInboxCollection = function() {
        return inboxCollection;
    };

    window.ConversationController = {
        get: function(id) {
            if (!this._initialFetchComplete) {
                throw new Error('ConversationController.get() needs complete initial fetch');
            }

            return conversations.get(id);
        },
        // Needed for some model setup which happens during the initial fetch() call below
        getUnsafe: function(id) {
            return conversations.get(id);
        },
        createTemporary: function(attributes) {
            return conversations.add(attributes);
        },
        getOrCreate: function(id, type) {
            if (!this._initialFetchComplete) {
                throw new Error('ConversationController.get() needs complete initial fetch');
            }

            var conversation = conversations.get(id);
            if (conversation) {
                return conversation;
            }

            conversation = conversations.add({
                id: id,
                type: type
            });
            conversation.initialPromise = new Promise(function(resolve, reject) {
                var deferred = conversation.save();

                if (!deferred) {
                    console.log('Conversation save failed! ', id, type);
                    return reject(new Error('getOrCreate: Conversation save failed'));
                }

                deferred.then(function() {
                    resolve(conversation);
                }, reject);
            });

            return conversation;
        },
        getOrCreateAndWait: function(id, type) {
            return this._initialPromise.then(function() {
                var conversation = this.getOrCreate(id, type);

                if (conversation) {
                    return conversation.initialPromise.then(function() {
                        return conversation;
                    });
                }

                return Promise.reject(
                    new Error('getOrCreateAndWait: did not get conversation')
                );
            }.bind(this));
        },
        getAllGroupsInvolvingId: function(id) {
            var groups = new Whisper.GroupCollection();
            return groups.fetchGroups(id).then(function() {
                return groups.map(function(group) {
                    return conversations.add(group);
                });
            });
        },
        loadPromise: function() {
            return this._initialPromise;
        },
        reset: function() {
            this._initialPromise = null;
            conversations.reset([]);
        },
        load: function() {
            console.log('ConversationController: starting initial fetch');
            if (this._initialPromise) {
                throw new Error('ConversationController.load() has already been called!');
            }

            this._initialPromise = new Promise(function(resolve, reject) {
                conversations.fetch().then(function() {
                    console.log('ConversationController: done with initial fetch');
                    this._initialFetchComplete = true;
                    resolve();
                }.bind(this), function(error) {
                    console.log(
                        'ConversationController: initial fetch failed',
                        error && error.stack ? error.stack : error
                    );
                    reject(error);
                });
            }.bind(this));

            return this._initialPromise;
        }
    };
})();
