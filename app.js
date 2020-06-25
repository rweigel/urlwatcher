const request = require("request");
const fs = require("fs");
const os = require('os');
var prettyHtml = require('json-pretty-html').default;
const sendmail = require('sendmail')();
const nodemailer = require('nodemailer');
var sver = require('semver');

// Node 10 has native support for recursive directory creation.
var mkdirp = require('mkdirp'); 

// TODO: This is native in Node 6.
const crypto = require("crypto");

const dns = require('dns');

if (0) {
	dns.lookup('iana.org', (err, address, family) => {
	  console.log('address: %j family: IPv%s', address, family);
		console.log(os.hostname());
		process.exit(0);
	});
}

if (!sver.gte(process.version,'6.0.0')) {
	console.log(
			console.log("node.js version >= 6 required. node.js -v returns "
			+ process.version 
			+ ". See README for instructions on upgrading using nvm."));
	process.exit(1);
}

process.on('exit', function () {
	console.log("main(): process.on('exit') called.");
	shutdown();
})

process.on('SIGINT', function () {
	console.log("main(): process.on('SIGINT') called.");
	shutdown();
})

let config = readConfig(process.argv[2] || "app-config.json");

config.app.hostname = config.app.hostname || os.hostname();

process.on('uncaughtException', function(err) {
	console.log('main(): Uncaught exception: ');
	console.log(err);
	if (config.app.emailStatus) {
		email(config.app.emailStatusTo, "URLWatcher exception on " 
			+ config.app.hostname 
			+ " at " 
			+ (new Date()).toISOString(), err);
		console.log('main(): Sent email to ' + config.app.emailStatusTo);
	} else {		
		console.log('main(): Not sending email b/c emailStatus = false.');
	}
})

let urlTests = readTests();

if (config.app.emailStatus) {
	console.log("main(): Sent start-up message to " 
									+ config.app.emailStatusTo);	
	let html = prettyHtml(urlTests);
	email(config.app.emailStatusTo, 
				"URLWatcher started on " 
				+ config.app.hostname 
				+ " at "
				+ (new Date()).toISOString()
			,
				"View results at " + config.app.publicHTML,
				+ "<br/>Configuration:<br/>" + html);
} else {
	console.log("main(): Not sending application start/stop messages"
				+ " b/c config.app.emailStatus = false.");
}

for (let testName in urlTests) {

	// Prepare configuration file with masked email address
	let settingsDir = __dirname + "/log/" + testName;
	let settingsFile = settingsDir + "/settings.json";
	if (!fs.existsSync(settingsDir)) {
		mkdirp.sync(settingsDir);
	}

	let fullEmail = urlTests[testName]["emailAlertsTo"];

	// Mask email address.
	urlTests[testName]["emailAlertsTo"] = maskEmailAddress(fullEmail)

	// Write configuration file to web-accessible directory
	fs.writeFile(settingsFile, JSON
						.stringify(urlTests[testName], null, 4), 
						(err) => {
							if (err) {
								console.log(err);
							} else {
								console.log("main(): Wrote " 
									+ settingsFile.replace(__dirname + "/", ""));
							}
						});

	// Reset email address.
	urlTests[testName]["emailAlertsTo"] = fullEmail;

	// Create array to store past results.
	urlTests[testName].results = [];

	// Start test process
	console.log("main(): Starting first test for " + testName);
	geturl(testName);
}

// Start server for serving log files
server();

function readConfig(configFile) {
	// Read configuration file
	configFile = process.argv[2] || "app-config.json"
	configFile = __dirname + "/" + configFile;
	if (fs.existsSync(configFile)) {
		let tmp = fs.readFileSync(configFile);
		var config = JSON.parse(tmp);
		console.log("readConfig(): Read " + configFile);
	} else {
		// Allow app to start even if email configuration file not found.
		console.log("readConfig(): File " + configFile + " not found. Exiting.");
		process.exit(1);
	}

	if (!config.app.emailMethod) {
		config.app.emailMethod = null;
	}
	let emailMethods = [null, "sendmail", "nodemailer"];
	if (!emailMethods.includes(config.app.emailMethod)) {
		console.error("readConfig(): config.app.emailMethod must be one of: " + emailMethods.join(","))
		process.exit(1);
	}

	// Create log directory if it does not exist
	config.app.logDirectory = __dirname + "/" + config.app.logDirectory;
	if (!fs.existsSync(config.app.logDirectory)) {
		mkdirp.sync(config.app.logDirectory);
		console.log("readConfig(): Created log directory " 
					+ config.app.logDirectory)
	}
	return config;
}

function readTests() {

	// Read URL test file
	let urlTestsFile = __dirname + "/" + config.app.urlTestsFile;
	let urlTests;
	if (fs.existsSync(urlTestsFile)) {
		let tmp = fs.readFileSync(urlTestsFile);
		try {
			urlTests = JSON.parse(tmp);
		} catch (e) {
			console.log("Could not JSON parse " + urlTestsFile + ". Exiting.");
			process.exit(1);				
		}
		console.log("readTests(): Read " + urlTestsFile);
	} else {
		console.log("readTests(): File " + urlTestsFile + " not found. Exiting.");	
		process.exit(1);	
	}

	// TODO: Create JSON schema for test file and validate.

	// Replace references to files with content of file.
	for (let testName in urlTests) {
		if (typeof(urlTests[testName]) === "string") {
			let fname = __dirname + "/" + urlTests[testName];
			console.log("readTests(): Reading and parsing\n  " + fname);
			if (!fs.existsSync(fname)) {
				console.log("readTests(): File "
						+ fname 
						+ " referenced in "
						+ urlTestsFile
						+ " not found. Exiting.");	
				process.exit(1);				
			}
			let tmp = fs.readFileSync(fname);
			try {
				urlTests[testName] = JSON.parse(tmp);
			} catch (e) {
				console.log("Could not JSON parse " + fname + ". Exiting.");
				process.exit(1);				
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
				console.log("readTests(): emailAlerts = true and emailAlertsTo not given in test " + testName + ". Exiting.");
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

function round(t) {
	return Math.round(10*t)/10
}

function server() {

    var express = require('express');
    var serveIndex = require('serve-index');
    var app = express();

    // The following is a hack to make the links work in a serve-index
    // directory listing. serve-index always makes links in the
    // listing relative to the server root, which will not be correct
    // if this app is behind a reverse proxy.  If the path from which
    // this app is served on the proxy changes from "/urlwatcher",
    // this code must be updated. This is the method suggested by
    // https://github.com/expressjs/serve-index/issues/53
    app.use(function (req, res, next) {
	req.originalUrl = "/urlwatcher" + req.url;
	next()
    })

	app.use('/log', express.static(__dirname + '/log'));
	app.use('/html', express.static(__dirname + '/html'));
        app.use('/log', serveIndex(__dirname + '/log', {icons: true, view: 'details'}));
        app.use('/html', serveIndex(__dirname + '/html', {icons: true, view: 'details'}));

	app.get('/', function(req, res) {
		res.sendFile(__dirname + '/html/index.htm');
	})

	let testNames = Object.keys(urlTests);
	app.get('/log/tests.json',
		function(req, res) {
			res.setHeader("Content-Type", "application/json");
			res.end(JSON.stringify(testNames));
	})

	app.get("/log/:testName/log/files.json",
		function(req, res) {
			console.log("server(): Request for " 
								+ req.params.testName + "/log/files.json");
			if (!testNames.includes(req.params.testName)) {
				res.sendStatus(400);
				return;
			}
			sendfiles(__dirname + '/log/' + req.params.testName + "/log",
				function(files) {
					res.setHeader("Content-Type", "application/json");
					res.end(JSON.stringify(files.reverse()));
				}
			);
	});

	function sendfiles(dir, cb) {
		const fs = require('fs');

		fs.readdir(dir, (err, files) => {
			cb(files);
		})
	}

	let server = app.listen(config.app.serverPort, function (err) {
		if (err) {
			console.log(err);
			process.exit(1);
		} else {
			console.log("server(): Server is listening on port " + config.app.serverPort);
		}
	});	
}

function report(testName, work) {

	let statusCode = work.statusCode;

	if (statusCode === undefined) {
		statusCode = -1;
	}

	var entry = new Date(work.requestStartTime).toISOString() 
					+ ","
					+ statusCode
					+ ","
					+ round(work.timingPhases.firstByte)
					+ "," 
					+ round(work.timingPhases.download)
					+ "," 
					+ round(work.timingPhases.total)
					+ "," 
					+ work.bodyLength
					+ "," 
					+ work.testFails
					+ "\n";

	// Append entry to entry file in directory named TestName + "log"
	if (!fs.existsSync(work.entryDirectory)) {
		mkdirp.sync(work.entryDirectory);
	}
	if (!fs.existsSync(work.entryFile)) {
		// Write header if first entry
		fs.appendFileSync(work.entryFile,
							"Date,status,ttfb,dl,total,size,fails\n", 'utf8');
	}
	fs.appendFileSync(work.entryFile, entry, 'utf8');

	console.log("report(): Wrote " + testName + " entry: " + entry.trim());

	// Create work directory (named TestName + "requests")
	if (!fs.existsSync(work.workDirectory)) {
		mkdirp.sync(work.workDirectory);
	}
	// Remove absolute paths from strings.
	let workClone = JSON.parse(JSON.stringify(work));
	for (key in workClone) {
		if (typeof(workClone[key]) === "string") {
			workClone[key] = workClone[key].replace(__dirname + "/", "");
		}
	}
        if (!workClone.testError) {
	    // Save disk space by not storing body.
	    // TODO: Write reference body and put link to it in workClone.body.
            delete workClone.body;
        }


    const checkDiskSpace = require('check-disk-space')
    checkDiskSpace(__dirname).then((diskSpace) => {
	if (diskSpace.free < 10000000) {
	    email(config.app.emailStatusTo, 
		  "URLWatcher low disk space on " 
		  + config.app.hostname 
		  + " at "
		  + (new Date()).toISOString()
		  ,
		  "Free: " + diskSpace.free + "\n" + "Size: " + diskSpace.size + "\nWill not write result file.");
	} else {
	    fs.writeFileSync(work.workFile, JSON.stringify(workClone, null, 4));
	}
    })

	// Re-read test file.
	try {
		//urlTests = readTests();
	} catch (e) {
		console.log("report(): Re-read of tests failed. Using previous tests.")
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

	let work = {};
	work.requestStartTime = new Date();
	
	let url = urlTests[testName].url;
	work.url = url;
	if (url.match(/^http/)) {

		let opts = {
			"url": url,
			"time": true,
			"timeout": urlTests[testName].timeout
		};

		console.log('geturl(): ' 
					+ work.requestStartTime.toISOString() 
					+ ' Requesting: ' + url);
		request.get(opts, function (error, response, body) {

			work.statusCode = undefined;
			if (typeof(response) != "undefined") {
				work.statusCode = response.statusCode;
			}
			work.error = false;
			work.errorMessage = "";

			if (error) {
				if (!work.error) {
					work.error = true;
					console.log('geturl(): Response error. Calling urlError().');
					urlError(error, work);
				} else {
					console.log('geturl(): Response error; urlError already called.');
				}
				return;
			}

			work.timings = response.timings;
			work.timingPhases = response.timingPhases;

			work.headers = response.headers;
			if (typeof(body) === "undefined") {
				work.body = undefined;
			} else {
				work.body = body;
			}

			test(testName, work);

		})
		.on("error", function (error) {
			if (!work.error) {
				work.error = true;
				console.log('geturl(): on("error") event. Calling urlError().');
				urlError(error, work);
			} else {
				console.log('geturl(): on("error") event; urlError already called.');
			}
		})
	} else if (url.match(/^ftp/)) {
		// Not tested recently
		var FtpClient  = require("ftp");
		var conn = new FtpClient({host: work.url.split("/")[2]});
		conn.on("error", function (err) {
			console.log("FTP Error");
			console.log(err)}
		);
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
								work.error = true;
								work.errorMessage = e;
								work.bodyMD5 = undefined;
								conn.end();
							})
							.on("end", function(){
								work.getEndTime = new Date()-work[urlMD5].getStartTime;
								work.error = false;
								work[urlMD5].statusCode = 200;
							});
						}
					});
			})
		})
		.connect();
	} else {
		console.log("Error.  Protocol" 
						+ url.replace(/^(.*)\:.*/,"$1") 
						+ " is not supported.");
	} 
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

	return work;
}

function test(testName, work) {

	console.log('test(): ' 
					+ work.requestStartTime.toISOString() 
					+ ' Testing: '+ work.url);

	work = computeDirNames(testName, work);

	urlTests[testName].results.push(work);
	if (urlTests[testName].results.length > 1 + urlTests[testName]["emailThreshold"]) {
		urlTests[testName].results.shift();
	}

	if (work.error) {
		work.bodyMD5    = undefined;
		work.bodyLength = -1;
		work.testFails  = -1;
		work.timings    = {};
		work.timingPhases = {'firstByte': -1, 'download': -1, 'total': -1};
	} else {
		work.bodyMD5    = crypto.createHash("md5").update(work.body).digest("hex");					
		work.bodyLength = work.body.length;
	}

	// Run tests

	let results = urlTests[testName].results;
	let L = results.length;

	if (results[L-1].error) {
		work.emailSubject = 
						"❌: URLWatcher " 
						+ testName 
						+ " on " 
						+ config.app.hostname 
						+ ": "
						+ work.errorMessage;
		if (L == 1) {
			email(work);
		} else {
			if (!results[L-2].error) {
				email(work);
			}
		}
		report(testName, work);
		return;
	}

	work.testFailures = [];
	work.emailBody = [];
	let fails = 0;
	for (let checkName in urlTests[testName].tests) {

		if (checkName === "__comment") continue;	

		if (!urlTests[testName]['tests'].hasOwnProperty(checkName)) continue;

		if (checkName === "statusCode") {
			if (results[L-1][checkName] != urlTests[testName].tests[checkName]) {
				fails++;
				work.testFailures.push(checkName);
				work.emailBody.push("❌: Status code of " 
							+ results[L-1][checkName] 
							+ " is not equal to " 
							+ urlTests[testName].tests[checkName]);
			} else {
				work.emailBody.push("✅: Status code of " 
							+ results[L-1][checkName] 
							+ " is equal to " 
							+ urlTests[testName].tests[checkName]);				
			}
		}

		// TODO: Repeated code below.
		if (checkName === "lengthChanged") {
			if (!urlTests[testName][checkName]) continue;
			if (L > 1) {
				//console.log(checkName, L,results[L-1].bodyLength,results[L-2].bodyLength);
				if (results[L-1].bodyLength != results[L-2].bodyLength) {
					fails++;
					work.testFailures.push(checkName);
					work.emailBody.push("❌: Current length of " 
								+ results[L-2].bodyLength 
								+ " differs from that for last test (" 
								+ results[L-1].bodyLength + ")");
				} else {
					work.emailBody.push("✅: Current length of " 
								+ results[L-2].bodyLength 
								+ " is same as that for last test");
				}
			}

		}
		if (checkName === "md5Changed") {
			if (!urlTests[testName][checkName]) continue;
			if (L > 1) {
				if (results[L-1].bodyMD5 != results[L-2].bodyMD5) {
					fails++;
					work.testFailures.push(checkName);
					work.emailBody.push("❌: Current MD5 differs from that for last test");
				} else {
					work.emailBody.push("✅: Current MD5 is same as that for last test");					
				}
			}
		}

		if (checkName === "bodyRegExp") {
			let re = new RegExp(urlTests[testName].tests[checkName][0], urlTests[testName].tests[checkName][1]);
			if (!re.exec(results[L-1].body)) {
				fails++;
				work.testFailures.push(checkName);
				work.emailBody.push("❌: Body does not match regular expression '" 
							+ urlTests[testName].tests[checkName][0] 
							+ "' with options '" 
							+ urlTests[testName].tests[checkName][1] 
							+ "'");
			} else {
				work.emailBody.push("✅: Body matches regular expression '" 
							+ urlTests[testName].tests[checkName][0] 
							+ "' with options '" 
							+ urlTests[testName].tests[checkName][1] 
							+ "'");
			}
		}

		// TODO: Repeated code below.
		if (checkName === "firstByte") {
			if (results[L-1]["timingPhases"][checkName] > urlTests[testName].tests[checkName]) {
				fails++;
				work.testFailures.push(checkName);
				work.emailBody.push("❌: Time to first chunk of " 
							+ round(results[L-1]["timingPhases"][checkName]) 
							+ " > " + urlTests[testName].tests[checkName] 
							+ " ms");
			} else {
				work.emailBody.push("✅: Time to first chunk of " 
							+ round(results[L-1]["timingPhases"][checkName]) 
							+ " <= " + urlTests[testName].tests[checkName] 
							+ " ms");				
			}
		}
		if (checkName === "download") {
			if (results[L-1]["timingPhases"][checkName] > urlTests[testName].tests[checkName]) {
				fails++;
				work.testFailures.push(checkName);
				work.emailBody.push("❌: Request transfer time of " 
							+ round(results[L-1]["timingPhases"][checkName]) 
							+ " > " + urlTests[testName].tests[checkName] 
							+ " ms");
			} else {
				work.emailBody.push("✅: Request transfer time of " 
							+ round(results[L-1]["timingPhases"][checkName])
							+ " <= " + urlTests[testName].tests[checkName]
							+ " ms");				
			}
		}
		if (checkName === "total") {
			if (results[L-1]["timingPhases"][checkName] > urlTests[testName].tests[checkName]) {
				fails++;
				work.testFailures.push(checkName);
				work.emailBody.push("❌: Request time of " 
							+ round(results[L-1]["timingPhases"][checkName])
							+ " > " + urlTests[testName].tests[checkName]
							+ " ms");
			} else {
				work.emailBody.push("✅: Request time of "
							+ round(results[L-1]["timingPhases"][checkName])
							+ " <= " + urlTests[testName].tests[checkName]
							+ " ms");				
			}
		}

	}

	// Prepare email

	let requestDate = work.requestStartTime
						.toISOString()
	                                        .replace(/T.*/,'');

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
					+ config.app.publicHTML 
					+ "#" 
					+ "date="
					+ requestDate 
					+ "&"
					+ "test="
					+ testName;

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
		if (n == emailThreshold) {
			sendFailEmail = true;
		}
		if (n > 0 && n < emailThreshold) {
			let reason = testName 
						+ ": Not sending fail email b/c number of consecutive failures (" 
						+ n 
						+ ") is less than " 
						+ emailThreshold 
						+ ".";
			console.log("test(): " + reason);
			sendFailEmail = false;
			work.emailNotSentReason = reason;			
		}
	}

	if (sendFailEmail) {
		// If last email was fail email, don't send another.
		sendFailEmail = urlTests[testName]['lastEmail'] === 'fail' ? false : true;
		if (!sendFailEmail) {
			let reason = testName 
						+ ": Not sending fail email b/c fail email was last email sent.";
			console.log("test(): " + reason);
			work.emailNotSentReason = reason;
		} else {
			console.log("test(): Sending fail email.");
		}
	}

	if (sendPassEmail) {
		// Only send pass email if last email sent was about failure.
		sendPassEmail = urlTests[testName]['lastEmail'] === 'fail' ? true : false;
		if (!sendPassEmail) {
			let reason = testName 
						+ ": Not sending pass email b/c fail email was not yet sent.";
			console.log("test(): " + reason);
			work.emailNotSentReason = reason;
		} else {
			console.log("test(): Sending pass email.");
		}
	}

	if (sendFailEmail) {
		 urlTests[testName]['lastEmail'] = 'fail';
	}
	if (sendPassEmail) {
		 urlTests[testName]['lastEmail'] = 'pass';
	}

	if (sendFailEmail || sendPassEmail) {
		work.emailTo = urlTests[testName]['emailAlertsTo'];
		work.emailBody = body;	
	}

	// Put partial timestamp to in subject line to prevent email clients
	// from threading messages.
	let requestTime = work.requestStartTime.toISOString().substring(11,21);
	
	if (sendFailEmail) {
		work.emailSubject = "❌ "
							+ testName 
							+ " URLWatcher: "
							+ "Test Failure" + s
							+ " on " 
							+ config.app.hostname
							+ " @ " 
							+ requestTime;
		email(work);
	}

	if (sendPassEmail) {
		work.emailSubject = "✅ " 
							+ testName 
							+ " URLWatcher: All Tests Passed"
							+ " on "
							+ config.app.hostname
							+ " @ " 
							+ requestTime;
		email(work);
	}

	report(testName, work);
}

function maskEmailAddress(addr) {

	if (!addr || !/@/.test(addr)) {
		return ""
	};

	// username@host => us...@host
	let tmp = addr.split('@');
	let uname = tmp[0];
	let host = tmp[1];
	return uname[0] + uname[1] + '...@' + host
}

function email(to, subject, text, cb) {

	if (typeof(to) === "object") {
		// Only writes emails sent about tests, not start/stop messages.
		// TODO: Write system messages.
		// TODO: Handle email send failure.
		work = to;
		cb = subject;
		to = work.emailTo;
		subject = work.emailSubject;
		text = work.emailBody || work.emailSubject;
		let email = "To: " + maskEmailAddress(to) + "\n"
					+ "Subject: " + subject + "\n"
					+ "Body:\n"
					+ "  " + text.replace(/\n/g,'\n  ');

		if (!fs.existsSync(work.emailDirectory)) {
			mkdirp.sync(work.emailDirectory);
		}
		console.log('email(): Writing ' + work.emailFile.replace(__dirname + "/",""));	
		fs.writeFileSync(work.emailFile, email);

		console.log('email(): Email to be sent:')
		console.log("------------------------------------------------------------------");
		console.log(email);
		console.log("------------------------------------------------------------------");		
	}

	if (!text) {
		text = subject;
	}

	if (!config.app.emailMethod) {
		console.log('email(): config.app.emailMethod not specified. Not sending email.')
		if (cb) {
			cb();
		}
		return;
	}

	text = text.replace(/\n/g, "<br/>").replace(/ /g, "&nbsp;")

	if (config.app.emailMethod === "sendmail") {
		sendmail({
			from: config.sendmail.from,
			to: to,
			subject: subject,
			html: text,
		}, function(err, reply) {
			if (err) {
				console.log('email(): Error when attempting to send email:')
				console.log(err);  		
			} else {
				console.log('email(): Email sent. Reply:')
				console.dir(reply);
				if (cb) {
					console.log("email(): Executing callback.")
					cb();
				}
			}
		});
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
				console.log("email(): Error while attempting to send email:");
				console.log(err)
			}
			else {
				//console.log("Email send response:");
				//console.log(info);
				if (cb) {
					console.log("email(): Executing callback.")
					cb();
				}
			}
		});
	}
}

function shutdown() {
	console.log('shutdown(): Shutdown called.')
	if (shutdown.called == true) {
		return;
	}
	if (!shutdown.called) {
		shutdown.called = true;
	}
	if (config.app.emailStatus) {
		console.log('shutdown(): Sending stop email.');
		// TODO: Not working. See old URLWatch code, which worked.
		let subj = "URLWatcher stopped on " 
						+ config.app.hostname 
						+ " at " 
						+ (new Date()).toISOString()

		email(config.app.emailStatusTo, subj, "", () => {process.exit(0);});
	} else {
		console.log("shutdown(): Not sending stop message b/c emailStatus = false.");
		process.exit(0);
	}
}
 