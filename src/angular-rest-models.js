angular.module( 'rest-models', [])

  .provider('RestModels', [function () {

    // Helper function to correctly set up the prototype chain, for subclasses.
    // Similar to `goog.inherits`, but uses a hash of prototype properties and
    // class properties to be extended.
    var extend = function(protoProps, staticProps) {
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
      _.extend(child, parent, staticProps);

      // Set the prototype chain to inherit from `parent`, without calling
      // `parent`'s constructor function.
      var Surrogate = function(){ this.constructor = child; };
      Surrogate.prototype = parent.prototype;
      child.prototype = new Surrogate;

      // Add prototype properties (instance properties) to the subclass,
      // if supplied.
      if (protoProps) _.extend(child.prototype, protoProps);

      // Set a convenience property in case the parent's prototype is needed
      // later.
      child.__super__ = parent.prototype;

      return child;
    };

    this.$get = ['$http', function($http) {

      /****************************************
                 DEFINITION FOR Model
      *****************************************/

      var Model = function(properties, options) {
        if (!options) {options = {};}
        this.$cid = _.uniqueId('c');
        if (options.$collection) {this.$collection = options.$collection;}
        if (options.$urlRoot) {this.$urlRoot = options.$urlRoot;}
        // attrs = _.defaults({}, attrs, _.result(this, 'defaults'));
        this.$set(properties);
        // this.$initialize.apply(this, arguments);
      };

      var urlError = function () {
        throw new Error('A "url" property or function must be specified');
      };

      // Attach all inheritable methods to the Model prototype.
      _.extend(Model.prototype, {

        // The default name for the JSON `id` attribute is `"id"`. MongoDB and
        // CouchDB users may want to set this to `"_id"`.
        $idAttribute: 'id',

        // Initialize is an empty function by default. Override it with your own
        // initialization logic.
        $initialize: function(){},

        // Get the HTML-escaped value of an attribute.
        $escape: function(property) {
          return _.escape(this[property]);
        },

        // Returns `true` if the attribute contains a value that is not null
        // or undefined.
        $has: function(property) {
          return angular.isDefined(this[property]) && this[property] !== null;
        },

        $getProperties: function () {
          var properties = {};
          angular.forEach(this, function (value, key) {
            if (typeof key === 'string' && key.charAt(0) !== '$') {
              properties[key] = value;
            }
          });
          return properties;
        },

        $set: function (key, val, options) {
          if (key === null) {return this;}
          var props = {};

          // Handle both `"key", value` and `{key: value}` -style arguments.
          if (typeof key === 'object') {
            props = key;
            options = val;
          } else {
            (props = {})[key] = val;
          }

          _.each(props, function (value, key) {
            this[key] = value;
          });

          // Update the collection, if there is one
          if (angular.isDefined(this.$collection) && this[this.$idAttribute]) {
            this.$collection._byId[this[this.$idAttribute]] = this;
          }
          return this;
        },

        // Remove an attribute from the model. 
        // `unset` is a noop if the attribute doesn't exist.
        $unset: function(attr, options) {
          return this.$set(attr, void 0);
        },

        // Clear all attributes on the model, firing `"change"`.
        $clear: function(options) {
          var props = {}, properties = this.$getProperties();
          for (var key in properties) {props[key] = void 0;}
          return this.set(props);
        },

        // Default URL for the model's representation on the server -- if you're
        // using Backbone's restful methods, override this to change the endpoint
        // that will be called.
        $url: function() {
          var base =
            _.result(this, '$urlRoot') ||
            _.result(this.$collection, '$url') ||
            urlError();
          if (this.$isNew()) {return base;}
          return base.replace(/([^\/])$/, '$1/') + encodeURIComponent(_.result(this, this.$idAttribute));
        },

        // Create a new model with identical properties to this one.
        $clone: function() {
          return new this.constructor(this.$getProperties());
        },

        // A model is new if it has never been saved to the server, and lacks an id.
        $isNew: function() {
          return !this.$has(this[this.$idAttribute]);
        },

        // Fetch the model from the server. If the server's representation of the
        // model differs from its current attributes, they will be overridden,
        // triggering a `"change"` event.
        $fetch: function(options) {
          var _this = this;
          return $http.get(this.$url()).then(function (data) {
            return _this.$set(data.data);
          });
        },

        // If the server returns an attributes hash that differs, the model's
        // state will be updated.
        $save: function(key, val, options) {
          var props;

          // Handle both `"key", value` and `{key: value}` -style arguments.
          if (key === null || typeof key === 'object') {
            props = key;
            options = val;
          } else {
            (props = {})[key] = val;
          }

          angular.forEach(props, function (propVal, propKey) {
            this[propKey] = propVal;
          });

          if (this.$isNew()) {
            var _this = this;
            return $http.post(this.$url(), this.$getProperties()).then(function (response) {
              if (angular.isDefined(response.data.id)) {
                _this[_this.$idAttribute] = response.data.id;
              }
              _this.$set(response.data);
              return _this;
            });
          } else {
            return $http.put(this.$url(), this.$getProperties()).then(function (response) {
              _this.$set(response.data);
              return _this;
            });
          }
        },

        // Destroy this model on the server if it was already persisted.
        // Optimistically removes the model from its collection, if it has one.
        $destroy: function() {
          // TODO:  Make sure to remove from the collection as well.

          if (!this.$isNew()) {
            return $http({method: 'delete', url: this.$url()});
          }
          return true;
        }

      });

      // Lodash methods that we want to implement on the Model.
      var modelMethods = ['keys', 'values', 'pairs', 'invert', 'pick', 'omit'];

      // Mix in each Underscore method as a proxy to `Model#properties`.
      angular.forEach(modelMethods, function (value, key) {
        Model.prototype['$' + value] = function() {
          var args = slice.call(arguments);
          // args.unshift(properties);
          return _[value].apply(_, args);
        };
      });

      /****************************************
               DEFINITION FOR Collection
      *****************************************/

      var Collection = function(models, options) {
        if (!options) {options = {};}
        if (options.$model) {this.$model = options.$model;}
        if (options.$comparator !== void 0) {this.$comparator = options.$comparator;}
        if (options.$url) {this.$url = options.$url;}
        // this._reset();
        // this.initialize.apply(this, arguments);
        // if (models) {this.reset(models, _.extend({silent: true}, options));}
      };

      // Define the Collection's inheritable methods.
      _.extend(Collection.prototype, {

        // The default model for a collection is just a **RestModels.Model**.
        // This should be overridden in most cases.
        $model: Model,

        // Initialize is an empty function by default. Override it with your own
        // initialization logic.
        $initialize: function(){},

        // Add a model, or list of models to the set.
        $add: function(models, options) {
          // options = _.extend(options, addOptions);
          // return this.set(models, _.extend({merge: false}, options));
        },

        // Remove a model, or a list of models from the set.
        $remove: function(models, options) {
          // var singular = !_.isArray(models);
          // models = singular ? [models] : _.clone(models);
          // if (!options) {
          //   options = {};
          // }
          // var i, l, index, model;
          // for (i = 0, l = models.length; i < l; i++) {
          //   model = models[i] = this.get(models[i]);
          //   if (!model) {continue;}
          //   delete this._byId[model.id];
          //   delete this._byId[model.cid];
          //   index = this.indexOf(model);
          //   this.models.splice(index, 1);
          //   this.length--;
          //   if (!options.silent) {
          //     options.index = index;
          //   }
          //   this._removeReference(model, options);
          // }
          // return singular ? models[0] : models;
        },

        // Update a collection by `set`-ing a new list of models, adding new ones,
        // removing models that are no longer present, and merging models that
        // already exist in the collection, as necessary. Similar to **Model#set**,
        // the core operation for updating the data contained by the collection.
        $set: function(models, options) {
    //       options = _.defaults({}, options, setOptions);
    //       if (options.parse) {models = this.parse(models, options);}
    //       var singular = !_.isArray(models);
    //       models = singular ? (models ? [models] : []) : _.clone(models);
    //       var i, l, id, model, attrs, existing, sort;
    //       var at = options.at;
    //       var targetModel = this.model;
    //       var sortable = this.comparator && (at == null) && options.sort !== false;
    //       var sortAttr = _.isString(this.comparator) ? this.comparator : null;
    //       var toAdd = [], toRemove = [], modelMap = {};
    //       var add = options.add, merge = options.merge, remove = options.remove;
    //       var order = !sortable && add && remove ? [] : false;

    //       // Turn bare objects into model references, and prevent invalid models
    //       // from being added.
    //       for (i = 0, l = models.length; i < l; i++) {
    //         attrs = models[i] || {};
    //         if (attrs instanceof RestModel) {
    //           id = model = attrs;
    //         } else {
    //           id = attrs[targetModel.prototype.idAttribute || 'id'];
    //         }

    //         // If a duplicate is found, prevent it from being added and
    //         // optionally merge it into the existing model.
    //         if (existing = this.get(id)) {
    //           if (remove) {modelMap[existing.cid] = true;}
    //           if (merge) {
    //             attrs = attrs === model ? model.attributes : attrs;
    //             if (options.parse) {attrs = existing.parse(attrs, options);}
    //             existing.set(attrs, options);
    //             if (sortable && !sort && existing.hasChanged(sortAttr)) {sort = true;}
    //           }
    //           models[i] = existing;

    //         // If this is a new, valid model, push it to the `toAdd` list.
    //         } else if (add) {
    //           model = models[i] = this._prepareModel(attrs, options);
    //           if (!model) {continue;}
    //           toAdd.push(model);
    //           this._addReference(model, options);
    //         }
    //         if (order) {order.push(existing || model);}
    //       }

    //       // Remove nonexistent models if appropriate.
    //       if (remove) {
    //         for (i = 0, l = this.length; i < l; ++i) {
    //           if (!modelMap[(model = this.models[i]).cid]) {toRemove.push(model);}
    //         }
    //         if (toRemove.length) {this.remove(toRemove, options);}
    //       }

    //       // See if sorting is needed, update `length` and splice in new models.
    //       if (toAdd.length || (order && order.length)) {
    //         if (sortable) {sort = true;}
    //         this.length += toAdd.length;
    //         if (at != null) {
    //           for (i = 0, l = toAdd.length; i < l; i++) {
    //             this.models.splice(at + i, 0, toAdd[i]);
    //           }
    //         } else {
    //           if (order) {this.models.length = 0;}
    //           var orderedModels = order || toAdd;
    //           for (i = 0, l = orderedModels.length; i < l; i++) {
    //             this.models.push(orderedModels[i]);
    //           }
    //         }
    //       }

    //       // Silently sort the collection if appropriate.
    //       if (sort) {this.sort({silent: true});}

    //       // Unless silenced, it's time to fire all appropriate add/sort events.
    //       if (!options.silent) {
    //         for (i = 0, l = toAdd.length; i < l; i++) {
    //           // (model = toAdd[i]).trigger('add', model, this, options);
    //         }
    //         // if (sort || (order && order.length)) this.trigger('sort', this, options);
    //       }

    //       // Return the added (or merged) model (or models).
    //       return singular ? models[0] : models;
        },

        // When you have more items than you want to add or remove individually,
        // you can reset the entire set with a new list of models, without firing
        // any granular `add` or `remove` events. Fires `reset` when finished.
        // Useful for bulk operations and optimizations.
        $reset: function(models, options) {
    //       if (!options) {options = {};}
    //       for (var i = 0, l = this.models.length; i < l; i++) {
    //         this._removeReference(this.models[i], options);
    //       }
    //       options.previousModels = this.models;
    //       this._reset();
    //       models = this.add(models, _.extend({silent: true}, options));
    //       return models;
        },

        // Add a model to the end of the collection.
        $push: function(model, options) {
    //       return this.add(model, _.extend({at: this.length}, options));
        },

        // Remove a model from the end of the collection.
        $pop: function(options) {
    //       var model = this.at(this.length - 1);
    //       this.remove(model, options);
    //       return model;
        },

        // Add a model to the beginning of the collection.
        $unshift: function(model, options) {
    //       return this.add(model, _.extend({at: 0}, options));
        },

        // Remove a model from the beginning of the collection.
        $shift: function(options) {
    //       var model = this.at(0);
    //       this.remove(model, options);
    //       return model;
        },

        // Slice out a sub-array of models from the collection.
        $slice: function() {
          // return slice.apply(this.models, arguments);
        },

        // Get a model from the set by id.
        $get: function(obj) {
    //       if (obj == null) {return void 0;}
    //       return this._byId[obj] || this._byId[obj.id] || this._byId[obj.cid];
        },

        // Get the model at the given index.
        $at: function(index) {
    //       return this.models[index];
        },

        // Return models with matching attributes. Useful for simple cases of
        // `filter`.
        $where: function(attrs, first) {
    //       if (_.isEmpty(attrs)) {return first ? void 0 : [];}
    //       return this[first ? 'find' : 'filter'](function(model) {
    //         for (var key in attrs) {
    //           if (attrs[key] !== model.get(key)) {return false;}
    //         }
    //         return true;
    //       });
        },

        // Return the first model with matching attributes. Useful for simple cases
        // of `find`.
        $findWhere: function(attrs) {
    //       return this.where(attrs, true);
        },

        // Force the collection to re-sort itself. You don't need to call this under
        // normal circumstances, as the set will maintain sort order as each item
        // is added.
        $sort: function(options) {
    //       if (!this.comparator) {throw new Error('Cannot sort a set without a comparator');}
    //       if (!options) {options = {};}

    //       // Run sort based on type of `comparator`.
    //       if (_.isString(this.comparator) || this.comparator.length === 1) {
    //         this.models = this.sortBy(this.comparator, this);
    //       } else {
    //         this.models.sort(_.bind(this.comparator, this));
    //       }

    //       // if (!options.silent) this.trigger('sort', this, options);
    //       return this;
        },

        // Pluck an attribute from each model in the collection.
        $pluck: function(attr) {
    //       return _.invoke(this.models, 'get', attr);
        },

        // Fetch the default set of models for this collection, resetting the
        // collection when they arrive. If `reset: true` is passed, the response
        // data will be passed through the `reset` method instead of `set`.
        $fetch: function(options) {
    //       options = options ? _.clone(options) : {};
    //       if (options.parse === void 0) {options.parse = true;}
    //       $http({
    //         method: 'GET',
    //         url: this.url
    //       });
    //       return $http({
    //         method: 'GET',
    //         url: this.url
    //       });
        },

        // Create a new instance of a model in this collection. Add the model to the
        // collection immediately, unless `wait: true` is passed, in which case we
        // wait for the server to agree.
        $create: function(model, options) {
    //       options = options ? _.clone(options) : {};
    //       if (!(model = this._prepareModel(model, options))) {return false;}
    //       if (!options.wait) {this.add(model, options);}
    //       var collection = this;
    //       var success = options.success;
    //       options.success = function(model, resp) {
    //         if (options.wait) {collection.add(model, options);}
    //         if (success) {success(model, resp, options);}
    //       };
    //       model.save(null, options);
    //       return model;
        },

    //     // Private method to reset all internal state. Called when the collection
    //     // is first initialized or reset.
    //     _reset: function() {
    //       this.length = 0;
    //       this.models = [];
    //       this._byId  = {};
    //     },

    //     // Prepare a hash of attributes (or other model) to be added to this
    //     // collection.
    //     _prepareModel: function(attrs, options) {
    //       if (attrs instanceof RestModel) {return attrs;}
    //       options = options ? _.clone(options) : {};
    //       options.collection = this;
    //       var model = new this.model(attrs, options);
    //       if (!model.validationError) {return model;}
    //       // this.trigger('invalid', this, model.validationError, options);
    //       return false;
    //     },

    //     // Internal method to create a model's ties to a collection.
    //     _addReference: function(model, options) {
    //       this._byId[model.cid] = model;
    //       if (model.id != null) {this._byId[model.id] = model;}
    //       if (!model.collection) {model.collection = this;}
    //       // model.on('all', this._onModelEvent, this);
    //     },

    //     // Internal method to sever a model's ties to a collection.
    //     _removeReference: function(model, options) {
    //       if (this === model.collection) {delete model.collection;}
    //       // model.off('all', this._onModelEvent, this);
    //     },

    //     // Internal method called every time a model in the set fires an event.
    //     // Sets need to update their indexes when models change ids. All other
    //     // events simply proxy through. "add" and "remove" events that originate
    //     // in other collections are ignored.
    //     _onModelEvent: function(event, model, collection, options) {
    //       // if ((event === 'add' || event === 'remove') && collection !== this) return;
    //       // if (event === 'destroy') this.remove(model, options);
    //       // if (model && event === 'change:' + model.idAttribute) {
    //       //   delete this._byId[model.previous(model.idAttribute)];
    //       //   if (model.id != null) this._byId[model.id] = model;
    //       // }
    //       // this.trigger.apply(this, arguments);
    //     }

      });


      // Assign extend defined above for Model and Collection
      Model.$extend = Collection.$extend = extend;

      return {
        Model: Model,
        Collection: Collection
      };
    }];
  }]);



  //   // Create local references to array methods we'll want to use later.
  //   var array = [];
  //   var push = array.push;
  //   var slice = array.slice;
  //   var splice = array.splice;

  //   // Default options for `Collection#set`.
  //   var setOptions = {add: true, remove: true, merge: true};
  //   var addOptions = {add: true, remove: false};




  //   // Lodash methods that we want to implement on the Collection.
  //   var methods = ['forEach', 'each', 'map', 'collect', 'reduce', 'foldl',
  //     'inject', 'reduceRight', 'foldr', 'find', 'detect', 'filter', 'select',
  //     'reject', 'every', 'all', 'some', 'any', 'include', 'contains', 'invoke',
  //     'max', 'min', 'toArray', 'size', 'first', 'head', 'take', 'initial', 'rest',
  //     'tail', 'drop', 'last', 'without', 'difference', 'indexOf', 'shuffle',
  //     'lastIndexOf', 'isEmpty', 'chain', 'sample'];

  //   // Mix in each Lodash method as a proxy to `Collection#models`.
  //   _.each(methods, function(method) {
  //     RestCollection.prototype[method] = function() {
  //       var args = slice.call(arguments);
  //       args.unshift(this.models);
  //       return _[method].apply(_, args);
  //     };
  //   });

  //   // Lodash methods that take a property name as an argument.
  //   var attributeMethods = ['groupBy', 'countBy', 'sortBy', 'indexBy'];

  //   // Use attributes instead of properties.
  //   _.each(attributeMethods, function(method) {
  //     RestCollection.prototype[method] = function(value, context) {
  //       var iterator = _.isFunction(value) ? value : function(model) {
  //         return model.get(value);
  //       };
  //       return _[method](this.models, iterator, context);
  //     };
  //   });
