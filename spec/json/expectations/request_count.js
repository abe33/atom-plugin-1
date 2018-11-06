'use strict';

const {waitsFor, waitsForPromise, loadPayload, substituteFromContext, buildContext, itForExpectation} = require('../utils');
const KiteAPI = require('kite-api');

const callsMatching = (data, exPath, exMethod, exPayload, context = {}) => {
  const calls = data || KiteAPI.request.calls.map(c => {
    return {
      path: c.args[0].path,
      method: c.args[0].method,
      body: c.args[1],
    };
  });

  exPath = substituteFromContext(exPath, context);
  exPayload = exPayload && substituteFromContext(loadPayload(exPayload), context);

  // console.log('--------------------')
  // console.log(exPath, exPayload)

  if (!calls || calls.length === 0) { return []; }

  return calls.reverse().filter((c) => {
    let {path, method, body} = c;
    method = method || 'GET';

    // console.log(path, method, payload)

    return path === exPath && method === exMethod && (!exPayload || expect.eql(JSON.parse(body), exPayload));
  });
};

let calls;
const getDesc = expectation => () => {
  const base = [
    expectation.properties.count,
    'requests to',
    expectation.properties.path,
    'in test',
    expectation.description,
    'but',
    calls ? calls.length : 0,
    'were found',
  ];

  KiteAPI.request.calls.forEach(call => {
    const [{method, path}, payload] = call.args;
    base.push(`\n - ${method || 'GET'} ${path} ${payload || ''}`);
  });

  return base.join(' ');
};


module.exports = (expectation, not) => {
  beforeEach(() => {
    const promise = waitsFor('calls matching request', () => {
      return KiteAPI.requestJSON({path: '/testapi/request-history'})
      .then((data) => {
        calls = callsMatching(
            data,
            expectation.properties.path,
            expectation.properties.method,
            expectation.properties.body,
            buildContext());

        if (calls.length !== expectation.properties.count) {
          throw new Error('fail');
        }
      });
    }, 1500, 50);

    if (not) {
      waitsForPromise({label: getDesc(expectation), shouldReject: true}, () => promise);
    } else {
      waitsForPromise({label: getDesc(expectation)}, () => promise);
    }
  });

  itForExpectation(expectation);
};
