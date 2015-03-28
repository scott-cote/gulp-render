/*
 * gulp-render
 * https://github.com/koistya/gulp-render
 *
 * Copyright (c) 2014 Konstantin Tarkus
 * Licensed under the MIT license
 */

'use strict';

var through = require('through2');
var gutil = require('gulp-util');
var path = require('path');
var fs = require('fs');
var _ = require('lodash');
var React = require('react');
var ReactTools = require('react-tools');
var hyphenate = require('react/lib/hyphenate');
var template = _.template;
var PluginError = gutil.PluginError;
var Module = module.constructor;

// Constants
var PLUGIN_NAME = 'gulp-render';

/**
 * Append @jsx pragma to JSX files
 */
function appendJsxPragma(filename, contents) {
  return filename.match(/\.jsx$/) || filename.match(/[\-\.]react\.js$/) ?
  '/**@jsx React.DOM*/' + contents : contents;
}

/**
 * Check if Page component has a layout property; and if yes, wrap the page
 * into the specified layout, then render to a string.
 */
function renderToString(page) {
  var layout = null, child = null, props = {};
  while ((layout = page.layout || (page.defaultProps && page.defaultProps.layout))) {
    child = React.createElement(page, props, child);
    _.extend(props, page.defaultProps);
    React.renderToString(React.createElement(page, props, child));
    page = layout;
  }
  return React.renderToString(React.createElement(page, props, child));
}

/**
 * Just produce static markup without data-react-* attributes
 * http://facebook.github.io/react/docs/top-level-api.html#react.rendertostaticmarkup
 */
function renderToStaticMarkup(page) {
  return React.renderToStaticMarkup(React.createElement(page));
}

// Plugin level function (dealing with files)
function Plugin(options) {

  options = options || {};

  var reactOptions = {
    harmony: typeof options.harmony === 'undefined' ? true : options.harmony,
    stripTypes: typeof options.stripTypes === 'undefined' ? true : options.stripTypes
  };

  if (options.template && options.template.indexOf('<') === -1) {
    options.template = fs.readFileSync(options.template, {encoding: 'utf8'});
  }

  var originalJsTransform = require.extensions['.js'];

  var reactTransform = function(module, filename) {
    if (filename.indexOf('node_modules') === -1) {
      var src = fs.readFileSync(filename, {encoding: 'utf8'});
      src = appendJsxPragma(filename, src);
      src = ReactTools.transform(src, reactOptions);
      module._compile(src, filename);
    } else {
      originalJsTransform(module, filename);
    }
  };

  require.extensions['.js'] = reactTransform;
  require.extensions['.jsx'] = reactTransform;

  // Creates a stream through which each file will pass
  var stream = through.obj(function(file, enc, cb) {

    if (!file.isNull()) {

      if (file.isStream()) {
        this.emit('error', new PluginError(PLUGIN_NAME, 'Streams are not supported!'));
        return cb();
      }

      if (file.isBuffer()) {

        try {
          var contents = file.contents.toString('utf8');
          contents = appendJsxPragma(file.path, contents);
          contents = ReactTools.transform(contents, reactOptions);
          var m = new Module();
          m.id = file.path;
          m.filename = file.path;
          m.paths = module.paths.slice(1);
          m._compile(contents, file.path);
          var Component = m.exports;
          var markup = options.staticMarkup ? renderToStaticMarkup(Component) : renderToString(Component);

          if (options.template) {
            var data = _.extend({}, (typeof(options.data) == 'function' ? options.data(file) : options.data));
            data.body = markup;

            // Set default values to avoid null-reference exceptions
            data.title = data.title || '';
            data.description = data.description || '';
            data.keywords = data.keywords || '';

            markup = template(options.template, data);
          }

          file.contents = new Buffer(markup);
          var filename = gutil.replaceExtension(file.path, '.html');

          if (typeof options.hyphenate === 'undefined' || options.hyphenate) {
            filename = hyphenate(path.basename(filename));
            filename = filename.lastIndexOf('-', 0) === 0 ? filename.substring(1) : filename;
            filename = path.join(path.dirname(file.path), filename);
          }

          file.path = filename;
        } catch (err) {
          this.emit('error', new PluginError(PLUGIN_NAME, err));
          return cb();
        }
      }
    }

    // Make sure the file goes through the next gulp plugin
    this.push(file);
    // Tell the stream engine that we are done with this file
    return cb();
  });

  // Return the file stream
  return stream;
}

module.exports = Plugin;
