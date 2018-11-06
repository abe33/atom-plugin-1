const {jsonPath, waitsForPromise} = require('../utils');
const Kite = require('../../../lib/kite');

'use strict';

module.exports = (action, testData) => {
  beforeEach(() => {
    let editor;
    waitsForPromise({label: 'file opened and focused'}, () => {
      return atom.workspace.open(jsonPath(action.properties.file))
      .then(e => {
        editor = e;
      })
      .catch(err => {
        throw err;
      });
    });
    if (testData.setup.kited === 'authenticated') {
      waitsFor('kite editor', () =>
      !/\.py$/.test(action.properties.file) ||
      Kite.kiteEditorForEditor(editor), 500);

      waitsFor('kite whitelist state', () =>
      !/\.py$/.test(action.properties.file) ||
      Kite.whitelistedEditorIDs[editor.id] != undefined, 500);
    }
  });
};
