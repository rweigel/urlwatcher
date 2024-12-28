const fs = require("fs");
const os = require('os');

//const request     = require("request");
const request     = require("requestretry");
const prettyHtml  = require('json-pretty-html').default;
const sendmail    = require('sendmail')();
const nodemailer  = require('nodemailer');
const chkDskSpace = require('check-disk-space');
const crypto      = require("crypto");
const mkdirp      = require('mkdirp');
const clc         = require('chalk');
const yargs       = require('yargs');

const ver  = parseInt(process.version.slice(1).split('.')[0]);
// Alternative approach: https://stackoverflow.com/a/41620850
const verMin = 10
if (ver < verMin) {
  let msg = `node.js version >= {verMin} required. `
  msg += `Version {process.version} is being used.`;
  log(msg, 'error');
  process.exit(1);
}

let app = {'lastEmail': false};

let argv = yargs
              .strict()
              .help()
              .describe('port','Server port')
              .alias('port','p')
              .describe('conf','Server configuration file')
              .alias('conf','c')
              .boolean('debug')
              .describe('debug','Show verbose log messages.')
              .alias('debug','d')
              .default({
                'port': false,
                'debug': "false",
                'conf': __dirname + '/conf/app-config.json'
              })
              .argv;

let config = readConfig(argv.conf || __dirname + "/conf/app-config.json");

if (argv.port && config.app.serverPort) {
  log("Port given on command line and in config file. Using command line value.",'warning');
  config.app.serverPort = argv.port;
}

exceptions(config);

config.app.hostname = config.app.hostname || os.hostname();

let urlTests = readTests();

if (config.app.emailStatus) {
  log("Sending start-up message to " + config.app.emailStatusTo);
  let html = prettyHtml(urlTests);
  let title = "URLWatcher started on " + config.app.hostname + " at " + (new Date()).toISOString();
  let body = "View results at " + config.app.publicHTML + "<br/>Configuration:<br/>" + html;
  email(config.app.emailStatusTo, title, body);
} else {
  log("Not sending application start/stop messages" + " b/c config.app.emailStatus = false.");
}

for (let testName in urlTests) {

  // Prepare configuration file with masked email address
  let settingsDir = config.app.logDirectory + "/" + testName;
  let settingsFile = settingsDir + "/settings.json";
  if (!fs.existsSync(settingsDir)) {
    mkdirp.sync(settingsDir);
  }

  let fullEmail = urlTests[testName]["emailAlertsTo"];

  // Mask email address.
  urlTests[testName]["emailAlertsTo"] = maskEmailAddress(fullEmail)

  // Write configuration file to web-accessible directory
  let msg = JSON.stringify(urlTests[testName], null, 4);
  fs.writeFile(settingsFile, msg, (err) => {
    if (err) {
      log(err,'error');
    } else {
      log("Wrote " + settingsFile);
    }
  });

  // Reset email address.
  urlTests[testName]["emailAlertsTo"] = fullEmail;

  // Create array to store past results.
  urlTests[testName].results = [];

  // Start test process
  log("Starting first test for " + testName);
  geturl(testName);
}

let testNames = Object.keys(urlTests);
let testObj = {};
for (id of Object.keys(urlTests)) {
  let testCategory = id.split("/")[0];
  let testComponent = id.split("/")[1];
  if (!testObj[testCategory]) {
    testObj[testCategory] = [];
  }
  testObj[testCategory].push(testComponent);
}

logMemory(true);

// Start server for serving log files and plots.
server();

function server() {

  let express = require('express');
  let serveIndex = require('serve-index');
  let app = express();
  //app.use(require('express-status-monitor')());

  app.use('/html', express.static(__dirname + '/html'));
  app.use('/html', serveIndex(__dirname + '/html', {icons: true, view: 'details'}));
  app.use('/log', express.static(config.app.logDirectory));
  app.use('/log', serveIndex(config.app.logDirectory, {icons: true, view: 'details'}));
  app.use('/log/', express.static(config.app.logDirectory));
  app.use('/log/', serveIndex(config.app.logDirectory, {icons: true, view: 'details'}));

  app.get('^/$', function(req, res) {
    res.sendFile(__dirname + '/html/index.htm');
  });

  app.get('/log/tests.json',
    function(req, res) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(testObj,null,2) + "\n");
  });

  app.get(/^\/log\/(.*)\/log\/files\.json$/,
    function(req, res) {
      log("Request for " + req.params[0] + "/log/files.json");
      if (!testNames.includes(req.params[0])) {
        res.sendStatus(400);
        return;
      }
      dirList(config.app.logDirectory + "/" + req.params[0] + "/log",
        function(files) {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(files.reverse())+"\n");
        }
      );
  });

  app.get(/^\/status\/(.*)$/,
    function(req, res) {
      // req.params[0] is the part of the URL that matches the regex in app.get()
      let requestedId = req.params[0];
      requestedCategory = requestedId.split("/")[0];
      //console.log("requestedCategory: " + requestedCategory)
      requestedComponent = requestedId.split("/")[1];
      //console.log("requestedComponent: " + requestedComponent);
      //console.log("urlTests:");
      //console.log(urlTests);
      let results = {};
      let found = false;
      if (requestedId in urlTests) {
        found = true;
        // If exact match to a test id, return results for that test.
        // e.g. /status/CDAWeb/landing
        results['tests'] = urlTests[requestedId]['tests'];
        results['results'] = urlTests[requestedId]['results'];
        //console.log(urlTests[requestedId]['results'])
        trimAbsolutePaths(results['results']);
      } else if (!requestedComponent) {
        // Not an exact match. Return all results for tests with id that
        // starts with req.params[0]. e.g., /status/CDAWeb
        results[requestedCategory] = {};
        for (id of Object.keys(urlTests)) {
          let testCategory = id.split("/")[0];
          let testComponent = id.split("/")[1];
          if (testCategory === requestedCategory) {
            console.log("testCategory: " + testCategory)
            found = true;
            results[testCategory][testComponent] = {};
            results[testCategory][testComponent]['tests'] = urlTests[id]['tests'];
            results[testCategory][testComponent]['results'] = urlTests[id]['results'];
            trimAbsolutePaths(results[testCategory][testComponent]['results']);
          }
        }
      }
      if (found) {
        res.setHeader("Content-Type", "application/json");
        res.send(JSON.stringify(results,null,2));
      } else {
        res.sendStatus(404);
      }
  });

  let server = app.listen(config.app.serverPort, function (err) {
    if (err) {
      log(err,'error');
      process.exit(1);
    } else {
      log("Server is listening on port " + config.app.serverPort);
    }
  });
}

function report(testName) {

  let L = urlTests[testName].results.length;
  let work = urlTests[testName].results[L-1];

  let statusCode = work.statusCode;
  if (statusCode === undefined) {
    statusCode = -1;
  }

  let entry = new Date(work.requestStartTime).toISOString()
            + "," + statusCode
            + "," + round(work.timingPhases.firstByte)
            + "," + round(work.timingPhases.download)
            + "," + round(work.timingPhases.total)
            + "," + work.bodyLength
            + "," + work.testFails
            + "\n";

  log("Writing '" + testName + "' entry: " + entry.trim());
  // Append entry to entry file in directory named TestName + "log"
  if (!fs.existsSync(work.entryDirectory)) {
    mkdirp.sync(work.entryDirectory);
  }
  if (!fs.existsSync(work.entryFile)) {
    // Write header if first entry
    fs.writeFileSync(work.entryFile, "Date,status,ttfb,dl,total,size,fails\n", 'utf8');
  }
  fs.appendFileSync(work.entryFile, entry, 'utf8');
  log("Wrote '" + testName + "' entry: " + entry.trim());

  writeResponseFile(work, testName);

  // Re-read test file on each iteration?
  try {
    //urlTests = readTests();
  } catch (e) {
    log("report(): Re-read of tests failed. Using previous tests.",'warning');
  }

  // Queue next test on testName
  setTimeout(() => {geturl(testName)}, urlTests[testName].interval);

}

function geturl(testName) {

  function urlError(error, work) {
    if (error.hasOwnProperty("code")) {
      work.errorMessage = error["code"];
    } else {
      work.errorMessage = error;
    }
    test(testName, work);
  }

  // Setting to null somehow leads to less peak memory usage.
  let work = null;
  work = {};
  work.requestStartTime = new Date();

  let url = urlTests[testName].url;
  work.url = url;
  if (url.match(/^http/)) {

    let opts = {
      "url": url,
      "time": true,
      "timeout": urlTests[testName]["tests"].timeout,
      "headers": {"User-Agent": "urlwatcher; https://github.com/hapi-server/servers"},
      "maxAttempts": urlTests[testName]["tests"].maxAttempts || 3,
      "retryDelay": urlTests[testName]["tests"].retryDelay || 1000
    };

    log(work.requestStartTime.toISOString() + ' Requesting: ' + url);
    request.get(opts, function (error, response, body) {

      work.statusCode = undefined;
      if (typeof(response) != "undefined") {
        work.statusCode = response.statusCode;
      }

      work.attempts = response.attempts;
      work.requestError = false;
      work.timeout = false;
      if (error) {
        if (work.requestError == false) {
          work.timeout = true;
          work.requestError = true;
          log('Response error. Calling urlError().');
          urlError(error, work);
        } else {
          log('Response error; urlError() already called.');
        }
        return;
      }

      work.timingPhases = response.timingPhases;
      work.headers = response.headers;
      work.body = body;

      test(testName, work);

    })
    .on("error", function (error) {
      work.timeout = true;
      if (work.requestError == undefined) {
        work.requestError = true;
        log('on("error") event. Calling urlError().');
        urlError(error, work);
      } else {
        log('geturl(): on("error") event; urlError already called.');
      }
    })
  } else if (url.match(/^ftp/)) {
    // Not tested recently
    var FtpClient  = require("ftp");
    var conn = new FtpClient({host: work.url.split("/")[2]});
    conn.on("error", function (err) {
      log("FTP Error",'error');
      log(err,'error');
    });
    conn.on("connect", function(){
      conn.auth(function(err){
        conn.get(work.url.split("/").slice(3).join("/"),
          function (err, stream) {
            if (err){
              callback(work.options);
            } else{
              var buff = "";
              stream.on("data", function(data){
                if (!work.responseTime) {
                  //work[urlMD5].responseTime = new Date();
                }
                buff += data.toString();
              })
              .on("error", function(e){
                work.requestError = true;
                work.errorMessage = e;
                work.bodyMD5 = undefined;
                conn.end();
              })
              .on("end", function(){
                work.getEndTime = new Date()-work[urlMD5].getStartTime;
                work.requestError = false;
                work[urlMD5].statusCode = 200;
              });
            }
          });
      })
    })
    .connect();
  } else {
    log("Protocol" + url.replace(/^(.*)\:.*/,"$1") + " is not supported.",'error');
  }
}

function test(testName, work) {

  log(work.requestStartTime.toISOString() + ' Testing: ' + work.url);
  logMemory();

  computeDirNames(testName, work);

  urlTests[testName].results.push(work);
  if (urlTests[testName].results.length > 1 + urlTests[testName]["emailThreshold"]) {
    urlTests[testName].results.shift();
  }

  //urlTests[testName].results = JSON.parse(JSON.stringify(urlTests[testName].results));
  //console.log(urlTests[testName])
  //console.log(urlTests[testName].results)

  if (work.requestError) {
    work.bodyMD5    = undefined;
    work.bodyLength = -1;
    work.testFails  = -1;
    work.timingPhases = {'firstByte': -1, 'download': -1, 'total': -1};
  } else {
    work.bodyMD5    = crypto.createHash("md5").update(work.body).digest("hex");
    work.bodyLength = work.body.length;
  }

  // Run tests

  let results = urlTests[testName].results;
  let L = results.length;

  work.testFailures = [];
  work.emailBody = [];
  let fails = Object.keys(urlTests[testName].tests).length;

  for (let checkName in urlTests[testName].tests) {

    if (checkName === "__comment") continue;

    if (urlTests[testName]["tests"][checkName] === false) {
      fails--;
      continue;
    }

    if (checkName === "timeout") {
      if (results[L-1][checkName] == true) {
        work.testFailures.push(checkName);
        work.emailBody.push("❌: Socket connection time"
              + " > " + urlTests[testName].tests[checkName]
              + " ms");
        break;
      } else {
        work.emailBody.push("✅: Socket connection time"
              + " <= " + urlTests[testName].tests[checkName]
              + " ms");
        fails--;
      }
    }

    if (checkName === "statusCode" && results[L-1][checkName] != undefined) {
      if (results[L-1][checkName] != urlTests[testName].tests[checkName]) {
        work.testFailures.push(checkName);
        work.emailBody.push("❌: Status code of "
              + results[L-1][checkName]
              + " is not equal to "
              + urlTests[testName].tests[checkName]);
      } else {
        fails--;
        work.emailBody.push("✅: Status code of "
              + results[L-1][checkName]
              + " is equal to "
              + urlTests[testName].tests[checkName]);
      }
    }

    // TODO: Repeated code below.
    if (checkName === "lengthChanged" && results[L-1]["body"] != undefined) {
      if (L > 1) {
        //console.log(checkName, L,results[L-1].bodyLength,results[L-2].bodyLength);
        if (results[L-1].bodyLength != results[L-2].bodyLength && results[L-2]["bodyLength"] != -1) {
          work.testFailures.push(checkName);
          work.emailBody.push("❌: Current length of "
                + results[L-2].bodyLength
                + " differs from that for last test ("
                + results[L-1].bodyLength + ")");
        } else {
          fails--;
          work.emailBody.push("✅: Current length of "
                + results[L-2].bodyLength
                + " is same as that for last test");
        }
      } else {
        fails--;
      }
    }

    if (checkName === "md5Changed" && results[L-1]["body"] != undefined) {
      if (L > 1) {
        if (results[L-1].bodyMD5 != results[L-2].bodyMD5 && results[L-2]["bodyLength"] != -1) {
          work.testFailures.push(checkName);
          work.emailBody.push("❌: Current MD5 differs from that for last test");
        } else {
          work.emailBody.push("✅: Current MD5 is same as that for last test");
          fails--;
        }
      } else {
        fails--;
      }
    }

    if (checkName === "bodyRegExp" && results[L-1]["body"] !== undefined) {
      let re = new RegExp(urlTests[testName].tests[checkName][0], urlTests[testName].tests[checkName][1] || "");
      if (!re.exec(results[L-1]["body"])) {
        work.testFailures.push(checkName);
        work.emailBody.push("❌: Body does not match regular expression '"
              + urlTests[testName].tests[checkName][0]
              + "' with options '"
              + urlTests[testName].tests[checkName][1]
              + "'");
      } else {
        fails--;
        work.emailBody.push("✅: Body matches regular expression '"
              + urlTests[testName].tests[checkName][0]
              + "' with options '"
              + urlTests[testName].tests[checkName][1]
              + "'");
      }
    }

    if (checkName === "firstByte" && results[L-1]["timeout"] === false) {
      if (results[L-1]["timingPhases"][checkName] > urlTests[testName].tests[checkName]) {
        work.testFailures.push(checkName);
        work.emailBody.push("❌: Time to first chunk of "
              + round(results[L-1]["timingPhases"][checkName])
              + " > " + urlTests[testName].tests[checkName]
              + " ms");
      } else {
        fails--;
        work.emailBody.push("✅: Time to first chunk of "
              + round(results[L-1]["timingPhases"][checkName])
              + " <= " + urlTests[testName].tests[checkName]
              + " ms");
      }
    }

    if (checkName === "download" && results[L-1]["timeout"] === false) {
      if (results[L-1]["timingPhases"][checkName] > urlTests[testName].tests[checkName]) {
        work.testFailures.push(checkName);
        work.emailBody.push("❌: Request transfer time of "
              + round(results[L-1]["timingPhases"][checkName])
              + " > " + urlTests[testName].tests[checkName]
              + " ms");
      } else {
        fails--;
        work.emailBody.push("✅: Request transfer time of "
              + round(results[L-1]["timingPhases"][checkName])
              + " <= " + urlTests[testName].tests[checkName]
              + " ms");
      }
    }

    if (checkName === "total" && results[L-1]["timeout"] == false) {
      if (results[L-1]["timingPhases"][checkName] > urlTests[testName].tests[checkName]) {
        work.testFailures.push(checkName);
        work.emailBody.push("❌: Request time of "
              + round(results[L-1]["timingPhases"][checkName])
              + " > " + urlTests[testName].tests[checkName]
              + " ms");
      } else {
        fails--;
        work.emailBody.push("✅: Request time of "
              + round(results[L-1]["timingPhases"][checkName])
              + " <= " + urlTests[testName].tests[checkName]
              + " ms");
      }
    }

  }

  // Prepare email

  work.emailBodyList = [...work.emailBody]; // Copy array

  let requestDate = work.requestStartTime.toISOString().replace(/T.*/,'');

  let d = new Date(work.requestStartTime);
  let requestDateLast = (new Date(d.setDate(d.getDate()-1)))
              .toISOString()
              .replace(/T.*/,'')
              .replace(/-/g,'');

  let body = "Test URL\n  "
          + urlTests[testName].url
          + "\n\n"
          + work.emailBody.join("\n")
          + "\n\nLast summary plot:\n  "
          + publicURL(testName, requestDate)

    body = body
        + "\n\nSummary file:\n  "
          + config.app.publicHTML
          + results[L-1].entryFile.replace(__dirname + "/", "")
        + "\n\nTest configuration\n  "
          + config.app.publicHTML + "log/"
          + testName + "/settings.json";

  if (L > 1) { // More than one test performed.
    // Assumes file from previous day exists.
    body = body
          + "\n\nLast two response files:\n  "
          + config.app.publicHTML
          + results[L-1].workFile.replace(__dirname + "/", "");
    body = body
          + "\n  "
          + config.app.publicHTML
          + results[L-2].workFile.replace(__dirname + "/", "");
  } else {
    body = body
          + "\n\nLast response file:\n  "
          + config.app.publicHTML
          + results[L-1].workFile.replace(__dirname + "/", "");
  }

  results[L-1].testError = false;
  if (fails > 0) {
    results[L-1].testError = true;
  }

  work.testFails = fails;

  let sendFailEmail = false;
  let sendPassEmail = false;
  let s = (fails > 1) ? "s" + " (" + fails + ")" : "";

  // Check standard conditions for sending email
  if (L == 1 && results[L-1].testError) {
    sendFailEmail = true;
  }
  if (L > 1) {
    if (!results[L-1].testError && results[L-2].testError) {
      sendPassEmail = true;
    }
  }

  //console.log(sendPassEmail);
  // Check conditions for not sending standard email
  let emailThreshold = urlTests[testName]["emailThreshold"];
  if (L >= emailThreshold) {
    let n = 0;
    for (let i = 0; i < emailThreshold; i++) {
      if (results[L-i-1].testError) {
        n = n + 1;
      } else {
        break;
      }
    }
    if (n === emailThreshold) {
      sendFailEmail = true;
    }
    if (n > 0 && n < emailThreshold) {
      let reason = testName
            + ": Not sending fail email b/c number of consecutive failures ("
            + n
            + ") is less than "
            + emailThreshold
            + ".";
      log(reason);
      sendFailEmail = false;
      work.emailNotSentReason = reason;
    }
  }

  if (sendFailEmail) {
    // If last email was fail email, don't send another.
    sendFailEmail = urlTests[testName]['lastEmail'] === 'fail' ? false : true;
    if (sendFailEmail === true) {
      log("Sending fail email.");
      urlTests[testName]['lastEmail'] = 'fail';
    } else {
      let reason = testName + ": Not sending fail email b/c fail email was last email sent.";
      log(reason);
      work.emailNotSentReason = reason;
    }
  }

  if (sendPassEmail) {
    // Only send pass email if last email sent was about failure.
    sendPassEmail = urlTests[testName]['lastEmail'] === 'fail' ? true : false;
    if (sendPassEmail === true) {
      log("Sending pass email.");
      urlTests[testName]['lastEmail'] = 'pass';
    } else {
      let reason = testName + ": Not sending pass email b/c fail email was not yet sent.";
      log(reason);
      work.emailNotSentReason = reason;
    }
  }

  if (sendFailEmail || sendPassEmail) {
    work.emailTo = urlTests[testName]['emailAlertsTo'];
    work.emailBody = body;
  } else {
    work.emailBody = null;
  }

  // Put partial timestamp to in subject line to prevent email clients
  // from threading messages.
  let requestTime = work.requestStartTime.toISOString().substring(11,21);

  if (sendFailEmail) {
    work.emailSubject = "❌ "+ testName
                      + " URLWatcher: Test Failure" + s + " on "
                      + config.app.hostname + " @ " + requestTime;
    email(work);
  }

  if (sendPassEmail) {
    work.emailSubject = "✅ " + testName
                      + " URLWatcher: All Tests Passed on "
                      + config.app.hostname + " @ " + requestTime;
    email(work);
  }

  log(work.requestStartTime.toISOString() + ' Tested: ' + work.url);
  logMemory();
  report(testName);
}


// Misc functions

function dirList(dir, cb) {
  const fs = require('fs');
  fs.readdir(dir, (err, files) => {
    cb(files);
  })
}

function trimAbsolutePaths(results) {
  if (!Array.isArray(results)) results = [results];
  for (let result of results) {
    for (let key in result) {
      if (typeof(result[key]) === "string") {
        result[key] = result[key].replace(__dirname + "/", "");
      }
    }
  }
}

function writeResponseFile(work, testName) {

  // TODO: Should also do tests before creating or appending to entry file above.
  const inodeMin = 50000; // Change to percent?
  const diskMin = 10000000;
  let inodesNums = [-1,-1];
  let inodeMsg = "";
  let notWin32 = process.platform !== 'win32';
  if (notWin32) {
      // TODO: Make async. Don't bother checking if last 10 checks were OK?
      // Better to catch out of disk space error and then report if issue is inode
      // or disk space?
      inodeNums = checkInodes(__dirname);
      inodeMsg = "inodes Free: " + inodeNums[1] + " (min = " + inodeMin + ")\n"
               + "inodes Tot.: " + inodeNums[0] + "\n"
  }

  log("Checking disk space");
  chkDskSpace(__dirname).then((diskSpace) => {
    // TODO: Don't bother checking if last 10 checks were OK?
    // Send only once per day
    // Send when fixed
    log("Checked disk space");
    if (diskSpace.free < diskMin || (notWin32 && inodeNums[1] < inodeMin)) {
        //console.log(diskSpace)
        if (app['lastEmail'] == false) {
        app['lastEmail'] = true;
        log("Sending low disk email",'error');
        let title = "URLWatcher low disk resources on " + config.app.hostname + " at " + (new Date()).toISOString();
        let body =   "Disk Free:    " + diskSpace.free + " (min = " + diskMin + ")\n"
                   + "Disk Size:    " + diskSpace.size + "\n"
                   + inodeMsg
                   + "Will not write result file.";
        email(config.app.emailStatusTo, title, body);
      } else {
        log("Not sending low disk email; already sent.");
      }
    } else {
      if (app['lastEmail'] == true) {
        app['lastEmail'] = false;
        log("Disk issue fixed");
        // TODO: Send email that problem fixed
      }

      if (!fs.existsSync(work.workDirectory)) {
        mkdirp.sync(work.workDirectory);
      }

      function prepLasts(work, condition) {

        let lastBodyFileKey = "last" + condition + "BodyFile";
        let lastBodyFileMD5Key = "last" + condition + "BodyFileMD5";

        let lastBodyFileMD5 = urlTests[testName][lastBodyFileMD5Key];
        if (lastBodyFileMD5 && lastBodyFileMD5 === work.bodyMD5) {
          work[lastBodyFileKey] = urlTests[testName][lastBodyFileKey];
          work[lastBodyFileMD5Key] = urlTests[testName][lastBodyFileMD5Key];
          log(`${condition} body has not changed since last request. Not writing body to file.`);
        } else {
          let bodyFileName = work.workFile.replace(".json",".body.json");
          urlTests[testName][lastBodyFileKey] = bodyFileName;
          urlTests[testName][lastBodyFileMD5Key] = work.bodyMD5;
          work[lastBodyFileKey] = bodyFileName;
          work[lastBodyFileMD5Key] = work.bodyMD5;
          log("Writing body file: " + bodyFileName);
          fs.writeFileSync(bodyFileName, work.body || "");
          log("Wrote body file: " + bodyFileName);
        }
        delete work.body;
      }

      if (work.testError) {
        prepLasts(work, "Fail");
      } else {
        prepLasts(work, "Pass");
      }

      // Remove absolute paths from strings.
      trimAbsolutePaths(work);

      log("Writing '" + testName + "' work file");
      fs.writeFileSync(work.workFile, JSON.stringify(work, null, 2));
      log("Wrote '" + testName + "' work file");
    }
  });
}

function readConfig(configFile) {
  // Read configuration file
  if (fs.existsSync(configFile)) {
    let tmp = fs.readFileSync(configFile);
    var config = JSON.parse(tmp);
    log("Read " + configFile);
  } else {
    // Allow app to start even if email configuration file not found.
    log("File " + configFile + " not found. Exiting.", 'error');
    process.exit(1);
  }

  if (!config.app.emailMethod) {
    config.app.emailMethod = null;
  }
  let emailMethods = [null, "sendmail", "nodemailer","spawn"];
  if (!emailMethods.includes(config.app.emailMethod)) {
    log("readConfig(): config.app.emailMethod must be one of: " + emailMethods.join(","), 'error');
    process.exit(1);
  }

  // Create log directory if it does not exist
  config.app.logDirectory = __dirname + "/" + config.app.logDirectory;
  if (!fs.existsSync(config.app.logDirectory)) {
    mkdirp.sync(config.app.logDirectory);
    log("Created log directory " + config.app.logDirectory);
  }
  return config;
}

function readTests() {

  // Read URL test file
  let urlTestsFileName = __dirname + "/" + config.app.urlTestsFile;
  let urlTests;
  if (fs.existsSync(urlTestsFileName)) {
    let urlTestsFileBlob = fs.readFileSync(urlTestsFileName);
    log("Reading " + urlTestsFileName);
    try {
      urlTests = JSON.parse(urlTestsFileBlob);
    } catch (e) {
      log("Could not JSON parse " + urlTestsFileName + ". Exiting.",'error');
      process.exit(1);
    }
    log("Read " + urlTestsFileName);
  } else {
    log("File " + urlTestsFile + " not found. Exiting.",'error');
    process.exit(1);
  }

  // TODO: Create JSON schema for test file and validate.
  // TODO: Make urlTests an array instead of an object.

  // Replace references to files with content of file.
  for (let testName in urlTests) {
    if (typeof(urlTests[testName]) !== "string") {
      urlTests[testName + "/" + urlTests[testName]['testName']] = JSON.parse(JSON.stringify(urlTests[testName]));
      delete urlTests[testName];
    } else {
      let fname = __dirname + "/" + urlTests[testName];
      log("Reading and parsing\n  " + fname);
      if (!fs.existsSync(fname)) {
        let msg = "File " + fname + " referenced in " + urlTestsFileName + " not found. Exiting.";
        log(msg,'error');
        process.exit(1);
      }
      let tmp = fs.readFileSync(fname);
      try {
        tmp = JSON.parse(tmp);
      } catch (e) {
        log("Could not JSON parse " + fname + ". Exiting.",'error');
        process.exit(1);
      }

      delete urlTests[testName];
      if (Array.isArray(tmp)) {
        let k = 1;
        for (let i = 0; i < tmp.length; i++) {
          if ('testName' in tmp[i]) {
            urlTests[testName + "/" + tmp[i]['testName']] = tmp[i];
          } else {
            urlTests[testName + "/" + k] = tmp[i];
            k = k + 1;
          }
        }
      }
    }
  }

  for (let testName in urlTests) {

    // Remove documentation nodes
    delete urlTests[testName]["__comment"];
    delete urlTests[testName]["tests"]["__comment"];

    urlTests[testName]["emailThreshold"] = urlTests[testName]["emailThreshold"] || 1;

    if (urlTests[testName]['emailAlerts']) {
      let a = urlTests[testName]['emailAlertsTo'];
      let b = urlTests[testName]['emailAlertsTo'] === '!!!!';
      if (!a || b) {
        log("emailAlerts = true and emailAlertsTo not given in test " + testName + ". Exiting.",'error');
        process.exit(1);
      }
    }
    // Create array to store past results.
    if (readTests.urlTestsLast && readTests.urlTestsLast[testName]) {
      urlTests[testName]["results"] = readTests.urlTestsLast[testName]["results"];
    } else {
      urlTests[testName]["results"] = [];
    }

  }

  readTests.urlTestsLast = urlTests;
  return urlTests;
}

function logMemory(firstCall) {

  let ISOString = (new Date()).toISOString();
  let YMD = ISOString.substr(0,10);
  let logDir = config.app.logDirectory + '/_memory/'
  if (!fs.existsSync(logDir)) {
    mkdirp.sync(logDir);
  }
  let fileName = config.app.logDirectory + '/_memory/urlwatcher-memory-' + YMD + '.txt';

  let usage = process.memoryUsage();

  usage.urlTests = JSON.stringify(urlTests).length

  let logStr = ISOString;
  for (const [key, value] of Object.entries(usage)) {
    logStr = logStr + "," + value;
  }

  if (!fs.existsSync(fileName)) {
    logStr = "time," + Object.keys(usage).join(",") + "\n" + logStr;
    fs.writeFileSync(fileName, logStr + "\n", (err) => {if (err) throw err});
  } else {
    fs.appendFileSync(fileName, logStr + "\n", (err) => {if (err) throw err});
  }
  log(logStr);
}

function publicURL(id, date) {

  if (typeof(date) !== 'string') {
    date = date.toISOString();
  }

  let ida = id.split("/");
  let url = config.app.publicHTML
            + "#date="
            + date.substring(0,10)
            + "&"
            + "category="
            + ida[0]

  if (ida.length > 0) {
    url = url + "&" + "test=" + ida[1];
  }

  return url;
}

function computeDirNames(testName, work) {

  let timeStamp = new Date(work.requestStartTime).toISOString().replace(/Z/g,'');
  work.workDirectory = config.app.logDirectory + "/" + testName + "/requests";
  work.workFile = work.workDirectory + "/" + timeStamp + ".json";

  let ymd = new Date(work.requestStartTime).toISOString().replace(/T.*/,"");
  work.entryDirectory = config.app.logDirectory + "/" + testName + "/log";
  work.entryFile = work.entryDirectory + "/" + ymd + ".csv";

  work.emailDirectory = config.app.logDirectory + "/" + testName + "/emails";
  work.emailFile = work.emailDirectory + "/" + timeStamp + ".txt";

}

function maskEmailAddress(addr) {

  if (!addr) return "";
  addr = addr.split(",");
  for (let i = 0; i < addr.length; i++) {
    // username@host => us...@host
    let tmp = addr[i].split('@');
    let uname = tmp[0];
    let host = tmp[1];
    addr[i] = uname[0] + uname[1] + '...@' + host;
  }
  return addr.join(",")
}

function email(to, subject, text, cb) {

  if (typeof(to) === "object") {

    // TODO: Handle email send failure.
    let work = to;
    cb = subject;
    to = work.emailTo;
    subject = work.emailSubject;
    text = work.emailBody || work.emailSubject || "";
    let email = "To: " + maskEmailAddress(to) + "\n"
                + "Subject: " + subject + "\n"
                + "Body:\n"
                + "  " + text.replace(/\n/g,'\n  ');

    if (!fs.existsSync(work.emailDirectory)) {
      mkdirp.sync(work.emailDirectory);
    }
    logMemory();
    log('Writing ' + work.emailFile);
    fs.writeFileSync(work.emailFile, email);
    log('Wrote ' + work.emailFile);
    logMemory();

    log("Email to be sent:\n\n"
        + "--------------------------------------------------------\n"
        + email
        + "\n--------------------------------------------------------\n");
  }

  if (!text) {
    text = subject || "";
  }

  if (!config.app.emailMethod) {
    log('config.app.emailMethod not specified. Not sending email.')
    if (cb) {
      cb();
    }
    return;
  }

  text = text.replace(/\n/g, "<br/>").replace(/ /g, "&nbsp;")

  if (to === "!!!!" || to === '') {
      if (to === '!!!!') {
        log('Invalid email address of ' + to + ". Not sending email.",'warning');
      } else {
        log('No to address');
      }
      if (cb) {
        cb();
      }
      return;
  }

  if (config.app.emailMethod === "spawn") {
    const {spawn} = require("child_process")

    const clSend = __dirname + "/test/email/sendmail.js";
    const clArgs = [clSend, to, config.spawn.from, subject, text];
    log(`Spawning ${process.execPath} ${clSend} ${to} ${config.spawn.from} ${subject} ${text}`);
    const child = spawn(process.execPath, clArgs);

    //ls.stdout.on('data', (data) => {
      //console.log(`spawn stdout:\n${data}`);
    //});

    child.on('exit', (code) => {
      //child = null;
    });

    child.stderr.on('data', (data) => {
      console.error(`spawn stderr:\n  ${data}`);
    });

    child.on('close', (code) => {
      log(`spawn exited with code ${code}`);
      if (cb) {
        log('Spawned');
        log("Executing callback.")
        cb();
      }
    });
  }

  if (config.app.emailMethod === "sendmail") {
    sendmail({
      from: config.sendmail.from,
      to: to,
      subject: subject,
      html: text,
      silent: true
    }, function(err, reply) {
      if (err) {
        log('Error when attempting to send email:')
        log(err);
      } else {
        log('Email sent. Reply:')
      }
      if (cb) {
        log("Executing callback.")
        cb();
      }
    })
  }

  if (config.app.emailMethod === "nodemailer") {
    var transporter = nodemailer.createTransport({
      "host": config.nodemailer.host,
      "port": config.nodemailer.port,
      ssl: true,
      auth: {
        "user": config.nodemailer.user,
        "pass": config.nodemailer.password
      }
    });

    const mailOptions = {
      from: config.nodemailer.from,
      to: to,
      subject: subject,
      html: text
    };


    transporter.sendMail(mailOptions, function (err, info) {
      if (err) {
        log("email(): Error while attempting to send email:");
        log(err)
      }
      else {
        //console.log("Email send response:");
        //console.log(info);
      }
      if (cb) {
        log("email(): Executing callback.")
        cb();
      }
    });
  }
}

function shutdown() {
  log('Shutdown called.')
  if (shutdown.called == true) {
    return;
  }
  if (!shutdown.called) {
    shutdown.called = true;
  }
  if (config.app.emailStatus) {
    log('Sending stop email.');
    // TODO: Not working. See old URLWatch code, which worked.
    let subj = "URLWatcher stopped on "
            + config.app.hostname
            + " at "
            + (new Date()).toISOString()

    email(config.app.emailStatusTo, subj, "", () => {process.exit(0);});
  } else {
    log("Not sending stop message b/c emailStatus = false.");
    process.exit(0);
  }
}

function checkInodes(dir) {

    let stdout = require('child_process').execSync('df -iPk ' + dir).toString();
    // Based on
    // https://github.com/adriano-di-giovanni/node-df/blob/master/lib/parse.js
    let cols = stdout
                .trim()
                .split(/\r|\n|\r\n/) // split into rows
                .slice(1) // strip column headers away
                .map(function(row) {
                          var columns = row
                  .replace(/\s+(\d+)/g, '\t$1')
                  .replace(/\s+\//g, '\t/')
                  .split(/\t/);
                    return columns;
                });
    return [parseInt(cols[0][1]), parseInt(cols[0][3])];
}

function log(msg, etype) {

  if (argv.debug == false && !['error','warning'].includes(etype)) {
    return;
  }

  let msgo = (new Date()).toISOString() + " [urlwatcher] "

  // https://stackoverflow.com/a/37081135
  let e = new Error();
  let stack = e.stack.toString().split(/\r\n|\n/);
  let line = stack[2].replace(/.*\//,"").replace(/:(.*):.*/,":$1");
  msg = msg.replace(__dirname + "/","");
  if (etype === 'error') {
    console.error(msgo + line + " " + clc.red(msg));
  } else if (etype === 'warning') {
    console.log(msgo + line + " " + clc.yellow(msg));
  } else {
    console.log(msgo + line + " " + msg);
  }
}

function round(t) {
  return Math.round(10*t)/10
}

function exceptions(config) {
  process.on('exit', function () {
    log("process.on('exit') called.");
    shutdown();
  });
  process.on('SIGINT', function () {
    log("process.on('SIGINT') called.");
    shutdown();
  });
  process.on('uncaughtException', function(err) {
    log('Uncaught exception: ','error');
    log(err.stack,'error');
    if (config.app.emailStatus && err.message !== exceptions.lastMessage) {
      email(config.app.emailStatusTo, "URLWatcher exception on "
        + config.app.hostname
        + " at "
        + (new Date()).toISOString(), err.stack);
      log('Sent email to ' + config.app.emailStatusTo,'error');
    } else {
      log('Not sending email b/c emailStatus = false.','error');
    }
    if (!exceptions.lastError) {
      exceptions.lastMessage = err.message;
    }
  });
}
