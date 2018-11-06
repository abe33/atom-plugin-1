'use strict';

const KiteAPI = require('kite-api');
const {
  waitsFor, waitsForPromise, loadPayload, substituteFromContext,
  buildContext, itForExpectation, inLiveEnvironment,
} = require('../utils');

let closeMatches, exactMatch;
const getDesc = (expectation, not) => () => {
  const base = [
    `expect ${not ? 'no ' : ''}request to`,
    expectation.properties.method,
    expectation.properties.path,
    'in test',
    expectation.description,
  ];

  if (expectation.properties.body) {
    base.push('with');
    base.push(JSON.stringify(substituteFromContext(expectation.properties.body, buildContext())));
  }

  if (not) {
    if (exactMatch) {
      base.push('but a call matched');
      base.push(`\n - ${exactMatch.method} ${exactMatch.path} ${exactMatch.payload}`);
    } else {
      base.push('and no calls matched');
    }
  }  else {
    if (closeMatches && closeMatches.length > 0) {
      base.push('\nbut some calls were close');
      closeMatches.forEach(({path, method, body}) => {
        base.push(`\n - ${method} ${path} ${body}`);
      });
    } else {
      base.push('\nbut no calls were anywhere close');
      KiteAPI.request.calls.forEach(call => {
        const [{method, path}, body] = call.args;
        base.push(`\n - ${method || 'GET'} ${path} ${body || ''}`);
      });
    }
  }

  return base.join(' ');
};

const mostRecentCallMatching = (data, exPath, exMethod, exPayload, context = {}, env) => {
  const calls = data || KiteAPI.request.calls.map(c => {
    return {
      path: c.args[0].path,
      method: c.args[0].method,
      body: c.args[1],
    };
  });
  closeMatches = [];
  exactMatch = null;
  let matched = false;

  exPath = substituteFromContext(exPath, context);
  exPayload = exPayload && substituteFromContext(loadPayload(exPayload), context);

  // console.log('--------------------')
  // console.log(exPath, exPayload)

  if (calls.length === 0) { return false; }

  return calls.reverse().reduce((b, c, i, a) => {
    let {path, method, body} = c;
    method = method || 'GET';

    // b is false here only if we found a call that partially matches
    // the expected parameters, eg. same endpoint but different method/body
    // so that mean the most recent call to the expected endpoint is not the one
    // we were looking for, and the assertion must fail immediately
    if (!b || matched) { return b; }

    if (path === exPath) {
      if (method === exMethod) {
        closeMatches.push({path, method, body});
        if (!exPayload || env.equals_(JSON.parse(body), exPayload)) {
          exactMatch = {path, method, body};
          matched = true;
          return true;
        } else {
          return false;
        }
      } else {
        // not the right method = failure
        return false;
      }
    } else {
      // not the good path, we pass up true unless we've reached the first call
      if (i === a.length - 1 && !matched) {
        return false;
      } else {
        return b;
      }
    }
  }, true);
};

module.exports = (expectation, not) => {
  beforeEach(function() {
    const promise = waitsFor(() => {
      if (inLiveEnvironment()) {
        return KiteAPI.requestJSON({path: '/testapi/request-history'})
        .then((data) => {
          if (!mostRecentCallMatching(
            data,
            expectation.properties.path,
            expectation.properties.method,
            expectation.properties.body,
            buildContext(),
            this.env)) {
            throw new Error('fail');
          }
        });
      } else {
        return mostRecentCallMatching(
          null,
          expectation.properties.path,
          expectation.properties.method,
          expectation.properties.body,
          buildContext(),
          this.env);
      }
    }, 1500, 50);

    if (not) {
      waitsForPromise({label: getDesc(expectation, not), shouldReject: true}, () => promise);
    } else {
      waitsForPromise({label: getDesc(expectation, not)}, () => promise);
    }
  });

  itForExpectation(expectation);
};
