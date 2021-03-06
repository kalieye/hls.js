var assert = require('assert');
var webdriver = require('selenium-webdriver');
// requiring this automatically adds the chromedriver binary to the PATH
var chromedriver = require('chromedriver');
var HttpServer = require('http-server');
var streams = require('../streams.json');

function retry(cb, numAttempts, interval) {
  numAttempts = numAttempts || 20;
  interval = interval || 3000;
  return new Promise(function(resolve, reject) {
    var attempts = 0;
    attempt();

    function attempt() {
      cb().then(function(res) {
        resolve(res);
      }).catch(function(e) {
        if (++attempts >= numAttempts) {
          // reject with the last error
          reject(e);
        }
        else {
          setTimeout(attempt, interval);
        }
      });
    }
  });
}

var onTravis = !!process.env.TRAVIS;
var STREAM_ID = onTravis ? process.env.STREAM : 'arte';
if (!STREAM_ID) {
  throw new Error('No stream ID.');
}
var stream = streams[STREAM_ID];
if (!stream) {
  throw new Error('Could not find stream "'+stream_ID+'"');
}
var browserConfig = {version : 'latest'};
if (onTravis) {
  var UA_VERSION = process.env.UA_VERSION;
  if (UA_VERSION) {
    browserConfig.version = UA_VERSION;
  }
  var UA = process.env.UA;
  if (!UA) {
    throw new Error('No test browser name.')
  }
  var OS = process.env.OS;
  if (!OS) {
    throw new Error('No test browser platform.')
  }
  browserConfig.name = UA;
  browserConfig.platform = OS;
}
else {
  browserConfig.name = "chrome";
}
var browserDescription = browserConfig.name;
if (browserConfig.version) {
  browserDescription += ' ('+browserConfig.version+')';
}
if (browserConfig.platform) {
  browserDescription += ', '+browserConfig.platform;
}

HttpServer.createServer({
  showDir: false,
  autoIndex: false,
  root: './',
}).listen(8000, '127.0.0.1');

describe('testing hls.js playback in the browser with "'+stream.description+'" on "'+browserDescription+'"', function() {
  beforeEach(function() {
    var capabilities = {
      name: '"'+stream.description+'" on "'+browserDescription+'"',
      browserName: browserConfig.name,
      platform: browserConfig.platform,
      version: browserConfig.version,
      commandTimeout: 35,
      customData: {
        stream: stream
      }
    };
    if (onTravis) {
      capabilities['tunnel-identifier'] = process.env.TRAVIS_JOB_NUMBER;
      capabilities.build = 'HLSJS-'+process.env.TRAVIS_BUILD_NUMBER;
      capabilities.username = process.env.SAUCE_USERNAME;
      capabilities.accessKey = process.env.SAUCE_ACCESS_KEY;
      this.browser = new webdriver.Builder().usingServer('http://'+process.env.SAUCE_USERNAME+':'+process.env.SAUCE_ACCESS_KEY+'@ondemand.saucelabs.com:80/wd/hub');
    }
    else {
      this.browser = new webdriver.Builder();
    }
    this.browser = this.browser.withCapabilities(capabilities).build();
    this.browser.manage().timeouts().setScriptTimeout(40000);
    console.log("Retrieving web driver session...");
    return this.browser.getSession().then(function(session) {
      console.log("Web driver session id: "+session.getId());
      if (onTravis) {
        console.log("Job URL: https://saucelabs.com/jobs/"+session.getId());
      }
      return retry(function() {
        console.log("Loading test page...");
        return this.browser.get('http://127.0.0.1:8000/tests/functional/auto/hlsjs.html').then(function() {
          // ensure that the page has loaded and we haven't got an error page
          return this.browser.findElement(webdriver.By.css('body#hlsjs-functional-tests')).catch(function(e) {
            console.log("Test page not loaded.");
            return Promise.reject(e);
          });
        }.bind(this));
      }.bind(this)).then(function() {
        console.log("Test page loaded.");
      });
    }.bind(this));
  });

  afterEach(function() {
    console.log("Quitting browser...");
    return this.browser.quit().then(function() {
      console.log("Browser quit.");
    });
  });

  it('should receive video loadeddata event', function() {
    var url = stream.url;
    return this.browser.executeAsyncScript(function(url) {
      var callback = arguments[arguments.length - 1];
      startStream(url, callback);
      video.onloadeddata = function() {
        callback('loadeddata');
      };
    }, url).then(function(result) {
      assert.strictEqual(result, 'loadeddata');
    });
  });

  if (stream.abr) {
    it('should "smooth switch" to highest level and still play(readyState === 4) after 12s', function() {
      var url = stream.url;
      return this.browser.executeAsyncScript(function(url) {
        var callback = arguments[arguments.length - 1];
        startStream(url, callback);
        video.onloadeddata = function() {
          switchToHighestLevel('next');
        };
        window.setTimeout(function() { callback(video.readyState);}, 12000);
      }, url).then(function(result) {
        assert.strictEqual(result, 4);
      });
    });
  }

  if (stream.live) {
    it('should seek near the end and receive video seeked event', function() {
      var url = stream.url;
      return this.browser.executeAsyncScript(function(url) {
        var callback = arguments[arguments.length - 1];
        startStream(url, callback);
        video.onloadeddata = function() {
          window.setTimeout(function() { video.currentTime = video.duration - 5;}, 5000);
        };
        video.onseeked = function() {
          callback('seeked');
        };
      }, url).then(function(result) {
        assert.strictEqual(result, 'seeked');
      });
    });
  } else {
    it('should seek near the end and receive video ended event', function() {
      var url = stream.url;
      return this.browser.executeAsyncScript(function(url) {
        var callback = arguments[arguments.length - 1];
        startStream(url, callback);
        video.onloadeddata = function() {
          window.setTimeout(function() { video.currentTime = video.duration - 5;}, 2000);
        };
        video.onended = function() {
          callback('ended');
        };
      }, url).then(function(result) {
        assert.strictEqual(result, 'ended');
      });
    });
  }
});
