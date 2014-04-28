angular.module( 'rest-models', [])
  .service('RestCollection', ['RestModel', '$http', function (RestModel, $http) {
    // Create local references to array methods we'll want to use later.
    var array = [];
    var push = array.push;
    var slice = array.slice;
    var splice = array.splice;

    var RestCollection = function(models, options) {
      if (!options) {options = {};}
      if (options.model) {this.model = options.model;}
      if (options.comparator !== void 0) {this.comparator = options.comparator;}
      if (options.url) {this.url = options.url;}
      this._reset();
      this.initialize.apply(this, arguments);
      if (models) {this.reset(models, _.extend({silent: true}, options));}
    };

    // Default options for `Collection#set`.
    var setOptions = {add: true, remove: true, merge: true};
    var addOptions = {add: true, remove: false};

    // Define the Collection's inheritable methods.
    _.extend(RestCollection.prototype, {

      // The default model for a collection is just a **Backbone.Model**.
      // This should be overridden in most cases.
      model: RestModel,

      // Initialize is an empty function by default. Override it with your own
      // initialization logic.
      initialize: function(){},

      // The JSON representation of a Collection is an array of the
      // models' attributes.
      toJSON: function(options) {
        return this.map(function(model){ return model.toJSON(options); });
      },

      // Proxy `Backbone.sync` by default.
      sync: function() {
        // return Backbone.sync.apply(this, arguments);
      },

      // Add a model, or list of models to the set.
      add: function(models, options) {
        options = _.extend(options, addOptions);
        return this.set(models, _.extend({merge: false}, options));
      },

      // Remove a model, or a list of models from the set.
      remove: function(models, options) {
        var singular = !_.isArray(models);
        models = singular ? [models] : _.clone(models);
        if (!options) {
          options = {};
        }
        var i, l, index, model;
        for (i = 0, l = models.length; i < l; i++) {
          model = models[i] = this.get(models[i]);
          if (!model) {continue;}
          delete this._byId[model.id];
          delete this._byId[model.cid];
          index = this.indexOf(model);
          this.models.splice(index, 1);
          this.length--;
          if (!options.silent) {
            options.index = index;
          }
          this._removeReference(model, options);
        }
        return singular ? models[0] : models;
      },

      // Update a collection by `set`-ing a new list of models, adding new ones,
      // removing models that are no longer present, and merging models that
      // already exist in the collection, as necessary. Similar to **Model#set**,
      // the core operation for updating the data contained by the collection.
      set: function(models, options) {
        options = _.defaults({}, options, setOptions);
        if (options.parse) {models = this.parse(models, options);}
        var singular = !_.isArray(models);
        models = singular ? (models ? [models] : []) : _.clone(models);
        var i, l, id, model, attrs, existing, sort;
        var at = options.at;
        var targetModel = this.model;
        var sortable = this.comparator && (at == null) && options.sort !== false;
        var sortAttr = _.isString(this.comparator) ? this.comparator : null;
        var toAdd = [], toRemove = [], modelMap = {};
        var add = options.add, merge = options.merge, remove = options.remove;
        var order = !sortable && add && remove ? [] : false;

        // Turn bare objects into model references, and prevent invalid models
        // from being added.
        for (i = 0, l = models.length; i < l; i++) {
          attrs = models[i] || {};
          if (attrs instanceof RestModel) {
            id = model = attrs;
          } else {
            id = attrs[targetModel.prototype.idAttribute || 'id'];
          }

          // If a duplicate is found, prevent it from being added and
          // optionally merge it into the existing model.
          if (existing = this.get(id)) {
            if (remove) {modelMap[existing.cid] = true;}
            if (merge) {
              attrs = attrs === model ? model.attributes : attrs;
              if (options.parse) {attrs = existing.parse(attrs, options);}
              existing.set(attrs, options);
              if (sortable && !sort && existing.hasChanged(sortAttr)) {sort = true;}
            }
            models[i] = existing;

          // If this is a new, valid model, push it to the `toAdd` list.
          } else if (add) {
            model = models[i] = this._prepareModel(attrs, options);
            if (!model) {continue;}
            toAdd.push(model);
            this._addReference(model, options);
          }
          if (order) {order.push(existing || model);}
        }

        // Remove nonexistent models if appropriate.
        if (remove) {
          for (i = 0, l = this.length; i < l; ++i) {
            if (!modelMap[(model = this.models[i]).cid]) {toRemove.push(model);}
          }
          if (toRemove.length) {this.remove(toRemove, options);}
        }

        // See if sorting is needed, update `length` and splice in new models.
        if (toAdd.length || (order && order.length)) {
          if (sortable) {sort = true;}
          this.length += toAdd.length;
          if (at != null) {
            for (i = 0, l = toAdd.length; i < l; i++) {
              this.models.splice(at + i, 0, toAdd[i]);
            }
          } else {
            if (order) {this.models.length = 0;}
            var orderedModels = order || toAdd;
            for (i = 0, l = orderedModels.length; i < l; i++) {
              this.models.push(orderedModels[i]);
            }
          }
        }

        // Silently sort the collection if appropriate.
        if (sort) {this.sort({silent: true});}

        // Unless silenced, it's time to fire all appropriate add/sort events.
        if (!options.silent) {
          for (i = 0, l = toAdd.length; i < l; i++) {
            // (model = toAdd[i]).trigger('add', model, this, options);
          }
          // if (sort || (order && order.length)) this.trigger('sort', this, options);
        }

        // Return the added (or merged) model (or models).
        return singular ? models[0] : models;
      },

      extend: function(protoProps, staticProps) {
        var parent = this;
        var child;

        // The constructor function for the new subclass is either defined by you
        // (the "constructor" property in your `extend` definition), or defaulted
        // by us to simply call the parent's constructor.
        if (protoProps && _.has(protoProps, 'constructor')) {
          child = protoProps.constructor;
        } else {
          child = function(){ return parent.apply(this, arguments); };
        }

        // Add static properties to the constructor function, if supplied.
        _.extend(child, parent);
        _.extend(child, staticProps);

        // Set the prototype chain to inherit from `parent`, without calling
        // `parent`'s constructor function.
        var Surrogate = function(){ this.constructor = child; };
        Surrogate.prototype = parent.prototype;
        child.prototype = new Surrogate();

        // Add prototype properties (instance properties) to the subclass,
        // if supplied.
        if (protoProps) {_.extend(child.prototype, protoProps);}

        // Set a convenience property in case the parent's prototype is needed
        // later.
        child.__super__ = parent.prototype;

        return child;
      },

      // When you have more items than you want to add or remove individually,
      // you can reset the entire set with a new list of models, without firing
      // any granular `add` or `remove` events. Fires `reset` when finished.
      // Useful for bulk operations and optimizations.
      reset: function(models, options) {
        if (!options) {options = {};}
        for (var i = 0, l = this.models.length; i < l; i++) {
          this._removeReference(this.models[i], options);
        }
        options.previousModels = this.models;
        this._reset();
        models = this.add(models, _.extend({silent: true}, options));
        return models;
      },

      // Add a model to the end of the collection.
      push: function(model, options) {
        return this.add(model, _.extend({at: this.length}, options));
      },

      // Remove a model from the end of the collection.
      pop: function(options) {
        var model = this.at(this.length - 1);
        this.remove(model, options);
        return model;
      },

      // Add a model to the beginning of the collection.
      unshift: function(model, options) {
        return this.add(model, _.extend({at: 0}, options));
      },

      // Remove a model from the beginning of the collection.
      shift: function(options) {
        var model = this.at(0);
        this.remove(model, options);
        return model;
      },

      // Slice out a sub-array of models from the collection.
      slice: function() {
        return slice.apply(this.models, arguments);
      },

      // Get a model from the set by id.
      get: function(obj) {
        if (obj == null) {return void 0;}
        return this._byId[obj] || this._byId[obj.id] || this._byId[obj.cid];
      },

      // Get the model at the given index.
      at: function(index) {
        return this.models[index];
      },

      // Return models with matching attributes. Useful for simple cases of
      // `filter`.
      where: function(attrs, first) {
        if (_.isEmpty(attrs)) {return first ? void 0 : [];}
        return this[first ? 'find' : 'filter'](function(model) {
          for (var key in attrs) {
            if (attrs[key] !== model.get(key)) {return false;}
          }
          return true;
        });
      },

      // Return the first model with matching attributes. Useful for simple cases
      // of `find`.
      findWhere: function(attrs) {
        return this.where(attrs, true);
      },

      // Force the collection to re-sort itself. You don't need to call this under
      // normal circumstances, as the set will maintain sort order as each item
      // is added.
      sort: function(options) {
        if (!this.comparator) {throw new Error('Cannot sort a set without a comparator');}
        if (!options) {options = {};}

        // Run sort based on type of `comparator`.
        if (_.isString(this.comparator) || this.comparator.length === 1) {
          this.models = this.sortBy(this.comparator, this);
        } else {
          this.models.sort(_.bind(this.comparator, this));
        }

        // if (!options.silent) this.trigger('sort', this, options);
        return this;
      },

      // Pluck an attribute from each model in the collection.
      pluck: function(attr) {
        return _.invoke(this.models, 'get', attr);
      },

      // Fetch the default set of models for this collection, resetting the
      // collection when they arrive. If `reset: true` is passed, the response
      // data will be passed through the `reset` method instead of `set`.
      fetch: function(options) {
        options = options ? _.clone(options) : {};
        if (options.parse === void 0) {options.parse = true;}
        $http({
          method: 'GET',
          url: this.url
        });
        return $http({
          method: 'GET',
          url: this.url
        });
      },

      // Create a new instance of a model in this collection. Add the model to the
      // collection immediately, unless `wait: true` is passed, in which case we
      // wait for the server to agree.
      create: function(model, options) {
        options = options ? _.clone(options) : {};
        if (!(model = this._prepareModel(model, options))) {return false;}
        if (!options.wait) {this.add(model, options);}
        var collection = this;
        var success = options.success;
        options.success = function(model, resp) {
          if (options.wait) {collection.add(model, options);}
          if (success) {success(model, resp, options);}
        };
        model.save(null, options);
        return model;
      },

      // **parse** converts a response into a list of models to be added to the
      // collection. The default implementation is just to pass it through.
      parse: function(resp, options) {
        return resp;
      },

      // Create a new collection with an identical list of models as this one.
      clone: function() {
        return new this.constructor(this.models);
      },

      // Private method to reset all internal state. Called when the collection
      // is first initialized or reset.
      _reset: function() {
        this.length = 0;
        this.models = [];
        this._byId  = {};
      },

      // Prepare a hash of attributes (or other model) to be added to this
      // collection.
      _prepareModel: function(attrs, options) {
        if (attrs instanceof RestModel) {return attrs;}
        options = options ? _.clone(options) : {};
        options.collection = this;
        var model = new this.model(attrs, options);
        if (!model.validationError) {return model;}
        // this.trigger('invalid', this, model.validationError, options);
        return false;
      },

      // Internal method to create a model's ties to a collection.
      _addReference: function(model, options) {
        this._byId[model.cid] = model;
        if (model.id != null) {this._byId[model.id] = model;}
        if (!model.collection) {model.collection = this;}
        // model.on('all', this._onModelEvent, this);
      },

      // Internal method to sever a model's ties to a collection.
      _removeReference: function(model, options) {
        if (this === model.collection) {delete model.collection;}
        // model.off('all', this._onModelEvent, this);
      },

      // Internal method called every time a model in the set fires an event.
      // Sets need to update their indexes when models change ids. All other
      // events simply proxy through. "add" and "remove" events that originate
      // in other collections are ignored.
      _onModelEvent: function(event, model, collection, options) {
        // if ((event === 'add' || event === 'remove') && collection !== this) return;
        // if (event === 'destroy') this.remove(model, options);
        // if (model && event === 'change:' + model.idAttribute) {
        //   delete this._byId[model.previous(model.idAttribute)];
        //   if (model.id != null) this._byId[model.id] = model;
        // }
        // this.trigger.apply(this, arguments);
      }

    });


    // Lodash methods that we want to implement on the Collection.
    var methods = ['forEach', 'each', 'map', 'collect', 'reduce', 'foldl',
      'inject', 'reduceRight', 'foldr', 'find', 'detect', 'filter', 'select',
      'reject', 'every', 'all', 'some', 'any', 'include', 'contains', 'invoke',
      'max', 'min', 'toArray', 'size', 'first', 'head', 'take', 'initial', 'rest',
      'tail', 'drop', 'last', 'without', 'difference', 'indexOf', 'shuffle',
      'lastIndexOf', 'isEmpty', 'chain', 'sample'];

    // Mix in each Underscore method as a proxy to `Collection#models`.
    _.each(methods, function(method) {
      RestCollection.prototype[method] = function() {
        var args = slice.call(arguments);
        args.unshift(this.models);
        return _[method].apply(_, args);
      };
    });

    // Underscore methods that take a property name as an argument.
    var attributeMethods = ['groupBy', 'countBy', 'sortBy', 'indexBy'];

    // Use attributes instead of properties.
    _.each(attributeMethods, function(method) {
      RestCollection.prototype[method] = function(value, context) {
        var iterator = _.isFunction(value) ? value : function(model) {
          return model.get(value);
        };
        return _[method](this.models, iterator, context);
      };
    });

    return RestCollection;
  }])
  .service('RestModel', ['$http', function ($http) {

    var RestModel = function(attributes, options) {
      var attrs = attributes || {};
      if (!options) {options = {};}
      this.cid = _.uniqueId('c');
      this.attributes = {};
      if (options.collection) {this.collection = options.collection;}
      if (options.parse) {attrs = this.parse(attrs, options) || {};}
      if (options.urlRoot) {this.urlRoot = options.urlRoot;}
      attrs = _.defaults({}, attrs, _.result(this, 'defaults'));
      this.set(attrs, options);
      this.changed = {};
      this.initialize.apply(this, arguments);
    };

    var urlError = function () {
      throw new Error('A "url" property or function must be specified');
    };

    // Attach all inheritable methods to the Model prototype.
    _.extend(RestModel.prototype, {

      // A hash of attributes whose current and previous value differ.
      changed: null,

      // The value returned during the last failed validation.
      validationError: null,

      // The default name for the JSON `id` attribute is `"id"`. MongoDB and
      // CouchDB users may want to set this to `"_id"`.
      idAttribute: 'id',

      // Initialize is an empty function by default. Override it with your own
      // initialization logic.
      initialize: function(){},

      // Return a copy of the model's `attributes` object.
      toJSON: function(options) {
        return _.clone(this.attributes);
      },

      // Get the value of an attribute.
      get: function(attr) {
        return this.attributes[attr];
      },

      // Get the HTML-escaped value of an attribute.
      escape: function(attr) {
        return _.escape(this.get(attr));
      },

      // Returns `true` if the attribute contains a value that is not null
      // or undefined.
      has: function(attr) {
        return this.get(attr) != null;
      },

      // Set a hash of model attributes on the object. This is
      // the core primitive operation of a model, updating the data and notifying
      // anyone who needs to know about the change in state. The heart of the beast.
      set: function(key, val, options) {
        var attr, attrs, unset, changes, silent, changing, prev, current;
        if (key == null) {return this;}

        // Handle both `"key", value` and `{key: value}` -style arguments.
        if (typeof key === 'object') {
          attrs = key;
          options = val;
        } else {
          (attrs = {})[key] = val;
        }

        if (!options) {options = {};}

        // Run validation.
        if (!this._validate(attrs, options)) {return false;}

        // Extract attributes and options.
        unset           = options.unset;
        silent          = options.silent;
        changes         = [];
        changing        = this._changing;
        this._changing  = true;

        if (!changing) {
          this._previousAttributes = _.clone(this.attributes);
          this.changed = {};
        }
        current = this.attributes, prev = this._previousAttributes;

        // Check for changes of `id`.
        if (this.idAttribute in attrs) {this.id = attrs[this.idAttribute];}

        // For each `set` attribute, update or delete the current value.
        for (attr in attrs) {
          val = attrs[attr];
          if (!_.isEqual(current[attr], val)) {changes.push(attr);}
          if (!_.isEqual(prev[attr], val)) {
            this.changed[attr] = val;
          } else {
            delete this.changed[attr];
          }
          if (unset) {
            delete current[attr];
          } else {
            current[attr] = val;
          }
        }

        // Trigger all relevant attribute changes.
        // if (!silent) {
        //   if (changes.length) this._pending = options;
        //   for (var i = 0, l = changes.length; i < l; i++) {
        //     this.trigger('change:' + changes[i], this, current[changes[i]], options);
        //   }
        // }

        // You might be wondering why there's a `while` loop here. Changes can
        // be recursively nested within `"change"` events.
        if (changing) {return this;}
        if (!silent) {
          while (this._pending) {
            options = this._pending;
            this._pending = false;
            // this.trigger('change', this, options);
          }
        }
        this._pending = false;
        this._changing = false;
        return this;
      },

      // Remove an attribute from the model, firing `"change"`. `unset` is a noop
      // if the attribute doesn't exist.
      unset: function(attr, options) {
        return this.set(attr, void 0, _.extend({}, options, {unset: true}));
      },

      // Clear all attributes on the model, firing `"change"`.
      clear: function(options) {
        var attrs = {};
        for (var key in this.attributes) {attrs[key] = void 0;}
        return this.set(attrs, _.extend({}, options, {unset: true}));
      },

      // Determine if the model has changed since the last `"change"` event.
      // If you specify an attribute name, determine if that attribute has changed.
      hasChanged: function(attr) {
        if (attr == null) {return !_.isEmpty(this.changed);}
        return _.has(this.changed, attr);
      },

      // Return an object containing all the attributes that have changed, or
      // false if there are no changed attributes. Useful for determining what
      // parts of a view need to be updated and/or what attributes need to be
      // persisted to the server. Unset attributes will be set to undefined.
      // You can also pass an attributes object to diff against the model,
      // determining if there *would be* a change.
      changedAttributes: function(diff) {
        if (!diff) {return this.hasChanged() ? _.clone(this.changed) : false;}
        var val, changed = false;
        var old = this._changing ? this._previousAttributes : this.attributes;
        for (var attr in diff) {
          if (_.isEqual(old[attr], (val = diff[attr]))) {continue;}
          (changed || (changed = {}))[attr] = val;
        }
        return changed;
      },

      // Get the previous value of an attribute, recorded at the time the last
      // `"change"` event was fired.
      previous: function(attr) {
        if (attr == null || !this._previousAttributes) {return null;}
        return this._previousAttributes[attr];
      },

      // Get all of the attributes of the model at the time of the previous
      // `"change"` event.
      previousAttributes: function() {
        return _.clone(this._previousAttributes);
      },

      // Fetch the model from the server. If the server's representation of the
      // model differs from its current attributes, they will be overridden,
      // triggering a `"change"` event.
      fetch: function(options) {
        options = options ? _.clone(options) : {};
        if (options.parse === void 0) {options.parse = true;}
        var _this = this;
        return $http.get(this.url()).then(function (data) {
          return _this.set(data.data);
        });
      },

      // Set a hash of model attributes, and sync the model to the server.
      // If the server returns an attributes hash that differs, the model's
      // state will be `set` again.
      save: function(key, val, options) {
        var attrs, method, xhr, attributes = this.attributes;

        // Handle both `"key", value` and `{key: value}` -style arguments.
        if (key == null || typeof key === 'object') {
          attrs = key;
          options = val;
        } else {
          (attrs = {})[key] = val;
        }

        options = _.extend({validate: true}, options);

        if (!this.set(attrs, options)) {return false;}

        if (this.isNew()) {
          var promise = $http.post(this.url(), this.toJSON()),
          _this = this;
          return promise.then(function (response) {
            if (angular.isDefined(response.data.id)) {
              _this.set('id', response.data.id);
              if (angular.isDefined(_this.collection)) {
                _this.collection._byId[response.data.id] = _this;
              }
            }
            return _this;
          });
        } else {
          var _this = this;
          return $http.put(this.url(), this.toJSON()).then(function (response) {
            return _this;
          });
        }

      },

      // Destroy this model on the server if it was already persisted.
      // Optimistically removes the model from its collection, if it has one.
      destroy: function() {
        // TODO:  Make sure to remove from the collection as well.

        if (!this.isNew()) {
          return $http({method: 'delete', url: this.url()});
        }
        return true;
      },

      // Default URL for the model's representation on the server -- if you're
      // using Backbone's restful methods, override this to change the endpoint
      // that will be called.
      url: function() {
        var base =
          _.result(this, 'urlRoot') ||
          _.result(this.collection, 'url') ||
          urlError();
        if (this.isNew()) {return base;}
        return base.replace(/([^\/])$/, '$1/') + encodeURIComponent(this.id);
      },

      // **parse** converts a response into the hash of attributes to be `set` on
      // the model. The default implementation is just to pass the response along.
      parse: function(resp, options) {
        return resp;
      },

      // Create a new model with identical attributes to this one.
      clone: function() {
        return new this.constructor(this.attributes);
      },

      // A model is new if it has never been saved to the server, and lacks an id.
      isNew: function() {
        return !this.has(this.idAttribute);
      },

      // Check if the model is currently in a valid state.
      isValid: function(options) {
        return this._validate({}, _.extend(options || {}, { validate: true }));
      },

      // Run validation against the next complete set of model attributes,
      // returning `true` if all is well. Otherwise, fire an `"invalid"` event.
      _validate: function(attrs, options) {
        if (!options.validate || !this.validate) {return true;}
        attrs = _.extend({}, this.attributes, attrs);
        var error = this.validationError = this.validate(attrs, options) || null;
        if (!error) {return true;}
        return false;
      }

    });

    // Underscore methods that we want to implement on the Model.
    var modelMethods = ['keys', 'values', 'pairs', 'invert', 'pick', 'omit'];

    // Mix in each Underscore method as a proxy to `Model#attributes`.
    _.each(modelMethods, function(method) {
      RestModel.prototype[method] = function() {
        var args = slice.call(arguments);
        args.unshift(this.attributes);
        return _[method].apply(_, args);
      };
    });

    return RestModel;

  }]);