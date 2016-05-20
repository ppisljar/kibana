import _ from 'lodash';
import errors from 'ui/errors';
import angular from 'angular';
import getComputedFields from 'ui/index_patterns/_get_computed_fields';
import formatHit from 'ui/index_patterns/_format_hit';
import RegistryFieldFormatsProvider from 'ui/registry/field_formats';
import IndexPatternsGetIdsProvider from 'ui/index_patterns/_get_ids';
import IndexPatternsMapperProvider from 'ui/index_patterns/_mapper';
import IndexPatternsIntervalsProvider from 'ui/index_patterns/_intervals';
import DocSourceProvider from 'ui/courier/data_source/doc_source';
import UtilsMappingSetupProvider from 'ui/utils/mapping_setup';
import IndexPatternsFieldListProvider from 'ui/index_patterns/_field_list';
import IndexPatternsFlattenHitProvider from 'ui/index_patterns/_flatten_hit';
import IndexPatternsCalculateIndicesProvider from 'ui/index_patterns/_calculate_indices';
import IndexPatternsPatternCacheProvider from 'ui/index_patterns/_pattern_cache';

export default function IndexPatternFactory(Private, Notifier, config, kbnIndex, Promise, safeConfirm) {
  const fieldformats = Private(RegistryFieldFormatsProvider);
  const getIds = Private(IndexPatternsGetIdsProvider);
  const mapper = Private(IndexPatternsMapperProvider);
  const intervals = Private(IndexPatternsIntervalsProvider);
  const DocSource = Private(DocSourceProvider);
  const mappingSetup = Private(UtilsMappingSetupProvider);
  const FieldList = Private(IndexPatternsFieldListProvider);
  const flattenHit = Private(IndexPatternsFlattenHitProvider);
  const calculateIndices = Private(IndexPatternsCalculateIndicesProvider);
  const patternCache = Private(IndexPatternsPatternCacheProvider);
  const type = 'index-pattern';
  const notify = new Notifier();

  const mapping = mappingSetup.expandShorthand({
    title: 'string',
    timeFieldName: 'string',
    notExpandable: 'boolean',
    intervalName: 'string',
    fields: 'json',
    fieldFormatMap: {
      type: 'string',
      _serialize(map = {}) {
        const serialized = _.transform(map, serialize);
        return angular.toJson(serialized);
      },
      _deserialize(map = '{}') {
        return _.mapValues(angular.fromJson(map), deserialize);
      }
    }
  });

  function serialize(flat, format, field) {
    if (!format) {
      return;
    }
    flat[field] = format;
  }

  function deserialize(mapping) {
    const FieldFormat = fieldformats.byId[mapping.id];
    return FieldFormat && new FieldFormat(mapping.params);
  }

  class IndexPattern {
    constructor(id) {
      this.id = id;
      this._docSource = new DocSource();

      this.metaFields = config.get('metaFields');
      this.getComputedFields = getComputedFields.bind(this);

      this.flattenHit = flattenHit(this);
      this.formatHit = formatHit(this, fieldformats.getDefaultInstance('string'));
      this.formatField = this.formatHit.formatField;

      this.routes = {
        edit: '/settings/indices/{{id}}',
        addField: '/settings/indices/{{id}}/create-field',
        indexedFields: '/settings/indices/{{id}}?_a=(tab:indexedFields)',
        scriptedFields: '/settings/indices/{{id}}?_a=(tab:scriptedFields)'
      };

      config.watchAll(() => {
        if (this._initialized) {
          this._initFields(); // re-initialize fields when config changes
        }
      });
    }

    init() {
      // tell the docSource where to find the doc
      this._docSource
        .index(kbnIndex)
        .type(type)
        .id(this.id);

      return mappingSetup
        .isDefined(type)
        .then(defined => {
          // create mapping for this type if one does not exist
          if (defined) {
            return true;
          }
          return mappingSetup.setup(type, mapping);
        })
        .then(() => {
          const reapply = response => {
            if (!response.found) {
              throw new errors.SavedObjectNotFound(type, this.id);
            }

            // deserialize any json fields
            _.forOwn(mapping, (fieldMapping, name) => {
              if (fieldMapping._deserialize) {
                response._source[name] = fieldMapping._deserialize(response._source[name], response, name, fieldMapping);
              }
            });

            _.assign(this, response._source);

            this._indexFields();

            // any time obj is updated, re-call reapply
            this._docSource
              .onUpdate()
              .then(reapply, notify.fatal);
          };

          if (!this.id) {
            return; // no document to fetch from elasticsearch
          }

          return this._docSource
            .fetch()
            .then(reapply);
        })
        .then(() => this);
    }

    _initFields(fields) {
      this._initialized = true;
      this.fields = new FieldList(this, fields || this.fields || []);
    }

    _indexFields() {
      if (!this.id) {
        return;
      }
      if (!this.fields) {
        return this.refreshFields();
      }
      this._initFields();
    }

    addScriptedField(name, script, type = 'string', lang) {
      const scriptedFields = this.getScriptedFields();
      const names = _.pluck(scriptedFields, 'name');

      if (_.contains(names, name)) {
        throw new errors.DuplicateField(name);
      }

      this.fields.push({
        name: name,
        script: script,
        type: type,
        scripted: true,
        lang: lang
      });
      this.save();
    }

    removeScriptedField(name) {
      const fieldIndex = _.findIndex(this.fields, {
        name: name,
        scripted: true
      });

      this.fields.splice(fieldIndex, 1);
      this.save();
    }

    popularizeField(fieldName, unit = 1) {
      const field = _.get(this, ['fields', 'byName', fieldName]);
      if (!field) {
        return;
      }

      const count = Math.max((field.count || 0) + unit, 0);
      if (field.count !== count) {
        field.count = count;
        this.save();
      }
    }

    getNonScriptedFields() {
      return _.where(this.fields, { scripted: false });
    }

    getScriptedFields() {
      return _.where(this.fields, { scripted: true });
    }

    getInterval() {
      return this.intervalName && _.find(intervals, { name: this.intervalName });
    }

    toIndexList(start, stop, sortDirection) {
      return this
        .toDetailedIndexList(start, stop, sortDirection)
        .then(detailedIndices => {
          if (!_.isArray(detailedIndices)) {
            return detailedIndices.index;
          }
          return _.pluck(detailedIndices, 'index');
        });
    }

    toDetailedIndexList(start, stop, sortDirection) {
      const interval = this.getInterval();
      if (interval) {
        return intervals.toIndexList(this.id, interval, start, stop, sortDirection);
      }

      if (this.isWildcard() && this.hasTimeField() && this.canExpandIndices()) {
        return calculateIndices(this.id, this.timeFieldName, start, stop, sortDirection);
      }

      return Promise.resolve({
        index: this.id,
        min: -Infinity,
        max: Infinity
      });
    }

    canExpandIndices() {
      return !this.notExpandable;
    }

    hasTimeField() {
      return !!(this.timeFieldName && this.fields.byName[this.timeFieldName]);
    }

    isWildcard() {
      return _.includes(this.id, '*');
    }

    prepBody() {
      const body = {};

      // serialize json fields
      _.forOwn(mapping, (fieldMapping, fieldName) => {
        if (this[fieldName] != null) {
          body[fieldName] = (fieldMapping._serialize)
            ? fieldMapping._serialize(this[fieldName])
            : this[fieldName];
        }
      });

      // ensure that the docSource has the current self.id
      this._docSource.id(this.id);

      // clear the indexPattern list cache
      getIds.clearCache();

      return body;
    }

    create() {
      const body = this.prepBody();
      return this._docSource
        .doCreate(body)
        .then(id => {
          this.id = id;
        })
        .catch(function (err) {
          if (_.get(err, 'origError.status') !== 409) {
            return Promise.resolve(false);
          }
          const confirmMessage = 'Are you sure you want to overwrite this?';

          return safeConfirm(confirmMessage)
            .then(() => Promise
              .try(() => {
                const cached = patternCache.get(self.id);
                if (cached) {
                  return cached.then(pattern => pattern.destroy());
                }
              })
              .then(() => this._docSource.doIndex(body))
              .then(id => {
                this.id = id;
              }),
              _.constant(false) // if the user doesn't overwrite, resolve with false
            );
        });
    }

    save() {
      const body = this.prepBody();
      return this._docSource
        .doIndex(body)
        .then(id => {
          this.id = id;
        });
    }

    refreshFields() {
      return mapper
        .clearCache(this)
        .then(this._fetchFields)
        .then(this.save);
    }

    _fetchFields() {
      return mapper
        .getFieldsForIndexPattern(this, true)
        .then(fields => {
          // append existing scripted fields
          const allFields = fields.concat(this.getScriptedFields());
          this._initFields(allFields);
        });
    }

    toJSON() {
      return this.id;
    }

    toString() {
      return '' + this.toJSON();
    }

    destroy() {
      patternCache.clear(this.id);
      this._docSource.destroy();
    }
  };

  return IndexPattern;
};
