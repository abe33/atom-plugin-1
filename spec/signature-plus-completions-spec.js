'use strict';

const fs = require('fs');
const path = require('path');
const {withKite, withKiteRoutes, withKitePaths} = require('kite-api/test/helpers/kite');
const {fakeResponse} = require('kite-api/test/helpers/http');

const projectPath = path.join(__dirname, 'fixtures');
let Kite;

describe('signature + completion', () => {
  let workspaceElement, jasmineContent, editor, editorView, completionList;

  beforeEach(() => {
    jasmine.useRealClock();

    atom.config.set('core.useTreeSitterParsers', false);

    jasmineContent = document.querySelector('#jasmine-content');
    workspaceElement = atom.views.getView(atom.workspace);

    jasmineContent.appendChild(workspaceElement);

    waitsForPromise('package activation', () => atom.packages.activatePackage('language-python'));
  });

  withKite({logged: true}, () => {
    withKitePaths({
      whitelist: [projectPath],
    }, undefined, () => {
      withKiteRoutes([
        [
          o => o.path === '/clientapi/editor/completions',
          o => fakeResponse(200, String(fs.readFileSync(path.join(projectPath, 'completions.json')))),
        ], [
          o => o.path === '/clientapi/editor/signatures',
          o => fakeResponse(200, String(fs.readFileSync(path.join(projectPath, 'dumps-signature.json')))),
        ],
      ]);

      beforeEach(() => {
        waitsForPromise('package activation', () =>
          atom.packages.activatePackage('kite').then(pkg => {
            Kite = pkg.mainModule;
          }));

        waitsForPromise('open editor', () =>
          atom.workspace.open(path.join(projectPath, 'json.py')).then(e => {
            editor = e;
            editorView = atom.views.getView(editor);
          }));

        waitsFor('kite editor', () =>
          Kite.kiteEditorForEditor(editor));

        waitsFor('kite whitelist state', () =>
          Kite.whitelistedEditorIDs[editor.id] != undefined);

        runs(() => {
          editor.setCursorBufferPosition([2, Number.POSITIVE_INFINITY]);
          editor.insertText('f');
        });

        waitsFor('autocomplete panel', () => completionList = editorView.querySelector('autocomplete-suggestion-list'));

      });

      describe('validating the suggestion', () => {
        beforeEach(() => {
          expect(completionList).not.toBeNull();

          waitsFor('signature', () => completionList.querySelector('kite-signature'));

          runs(() => {
            atom.commands.dispatch(editorView, 'autocomplete-plus:confirm');
          });
        });

        it('inserts the suggestion but leave the signature visible', () => {
          const list = editorView.querySelector('autocomplete-suggestion-list');
          expect(list).not.toBeNull();

          waitsFor('signature', () => list.querySelector('kite-signature'));

          waitsFor('empty list', () => list.querySelectorAll('li').length === 0);
        });
      });
    });
  });
});
