const request = require("request");
const crypto = require("crypto");
const fs = require("fs");
var prettyHtml = require('json-pretty-html').default;
const sendmail = require('sendmail')();
const nodemailer = require('nodemailer');
var sver = require('semver');

// Node 10 has native support for recursive directory creation.
var mkdirp = require('mkdirp'); 

if (!sver.gte(process.version,'6.0.0')) {
	console.log(
			clc.red("node.js version >= 6 required. node.js -v returns "
			+ process.version 
			+ ". See README for instructions on upgrading using nvm."));
	process.exit(1);
}

process.on('uncaughtException', function(err) {
	// TODO: Send email?
	console.log('main(): Uncaught exception: ');
	console.log(err);
})

process.on('exit', function () {
	console.log("main(): process.on('exit') called.");
	shutdown();
})

process.on('SIGINT', function () {
	console.log("main(): process.on('SIGINT') called.");
	shutdown();
})

let config = readConfig(process.argv[2] || "app-config.json");
let urlTests = readTests();

if (config.app.emailStatus) {
	let html = prettyHtml(urlTests);
	email(config.app.emailStatusTo, "URLWatcher started at "
			+ (new Date()).toISOString(), "Configuration:<br/>" + html);	
} else {
	console.log("main(): Not sending application start/stop messages"
				+ " b/c config.app.emailStatus = false.");
}

for (let testName in urlTests) {

	// Prepare configuration file with masked email address
	let file = __dirname + "/log/" + testName + "/settings.json";
	let fullemail = urlTests[testName]["emailAlertsTo"];

	urlTests[testName]["emailAlertsTo"] = maskEmailAddress(urlTests[testName]["emailAlertsTo"])
	urlTests[testName]["emailAlertsTo"] = fullemail;

	// Write configuration file to web-accessible directory
	fs.writeFile(file, JSON.stringify(urlTests[testName], null, 4), 
										() => {console.log("main(): Wrote " + file);});	

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
		console.log("readConfig(): File " + configFile + " not found.");
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
		console.log("readConfig(): Created log directory " + config.app.logDirectory)
	}
	return config;
}

function readTests() {

	// Read URL test file
	let urlTestsFile = __dirname + "/" + config.app.urlTestsFile;
	let urlTests;
	if (fs.existsSync(urlTestsFile)) {
		let tmp = fs.readFileSync(urlTestsFile);
		urlTests = JSON.parse(tmp);
		console.log("readTests(): Read " + urlTestsFile);
	} else {
		console.log("readTests(): File " + urlTestsFile + " not found. Exiting.");	
		process.exit(1);	
	}

	// TODO: Create JSON schema for test file and validate.

	// Replace references to files with content of file.
	for (let testName in urlTests) {
		if (typeof(urlTests[testName]) === "string") {
			console.log("readTests():\n  Reading and parsing " + __dirname + "/" + urlTests[testName])
			let tmp = fs.readFileSync(__dirname + "/" + urlTests[testName]);
			urlTests[testName] = JSON.parse(tmp)[testName];		
		}
	}

	for (let testName in urlTests) {
		// Remove documentation nodes
		delete urlTests[testName]["__comment"];
		delete urlTests[testName]["tests"]["__comment"];

		if (urlTests[testName]['emailAlerts']) {
			if (!urlTests[testName]['emailAlertsTo'] || urlTests[testName]['emailAlertsTo'] === '!!!!') {
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

	app.use('/log', express.static(__dirname + '/log'));
	app.use('/html', express.static(__dirname + '/html'));
	app.use('/log', serveIndex(__dirname + '/log'));
	app.use('/html', serveIndex(__dirname + '/html'));

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
			console.log("server(): Request for " + req.params.testName + "/log/files.json");
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
		fs.appendFileSync(work.entryFile, "Date,status,ttfb,dl,total,size,fails\n", 'utf8');
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
	// Write work file
	fs.writeFileSync(work.workFile, JSON.stringify(workClone, null, 4));
	
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

		console.log('geturl(): ' + work.requestStartTime.toISOString() + ' Requesting: '+ url);
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
					console.log('geturl(): Response error; urlError already called. ');
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
				console.log('geturl(): on("error") event; urlError already called. ');
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
				conn.get(work.url.split("/").slice(3).join("/"), function (err, stream) {
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
		console.log("Error.  Protocol" + url.replace(/^(.*)\:.*/,"$1") + " is not supported.");
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

	console.log('test(): ' + work.requestStartTime.toISOString() + ' Testing: '+ work.url);

	work = computeDirNames(testName, work);

	urlTests[testName].results.push(work);
	if (urlTests[testName].results.length > 2) {
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
		let subject = "❌: URLWatcher " + testName + ": " + work.errorMessage;
		if (L == 1) {
			email(urlTests[testName].email, subject);
		} else {
			if (!results[L-2].error) {
				email(urlTests[testName].email, subject);
			}
		}
		report(testName, work);
		return;
	}

	urlTests[testName].results[L-1].testError = true;

	work.testFailures = [];
	work.emailText = [];
	let fails = 0;
	for (let checkName in urlTests[testName].tests) {

		if (checkName === "__comment") continue;	

		if (!urlTests[testName]['tests'].hasOwnProperty(checkName)) continue;

		if (checkName === "statusCode") {
			if (results[L-1][checkName] != urlTests[testName].tests[checkName]) {
				fails++;
				work.testFailures.push(checkName);
				work.emailText.push("❌: Status code of " + results[L-1][checkName] + " is not equal to " + urlTests[testName].tests[checkName]);
			} else {
				work.emailText.push("✅: Status code of " + results[L-1][checkName] + " is equal to " + urlTests[testName].tests[checkName]);				
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
					work.emailText.push("❌: Current length of " + results[L-2].bodyLength + " differs from that for last test (" + results[L-1].bodyLength + ")");
				} else {
					work.emailText.push("✅: Current length of " + results[L-2].bodyLength + " is same as that for last test");
				}
			}

		}
		if (checkName === "md5Changed") {
			if (!urlTests[testName][checkName]) continue;
			if (L > 1) {
				if (results[L-1].bodyMD5 != results[L-2].bodyMD5) {
					fails++;
					work.testFailures.push(checkName);
					work.emailText.push("❌: Current MD5 differs from that for last test");
				} else {
					work.emailText.push("✅: Current MD5 is same as that for last test");					
				}
			}
		}

		if (checkName === "bodyRegExp") {
			let re = new RegExp(urlTests[testName].tests[checkName][0], urlTests[testName].tests[checkName][1]);
			if (!re.exec(results[L-1].body)) {
				fails++;
				work.testFailures.push(checkName);
				work.emailText.push("❌: Body does not match regular expression '" + urlTests[testName].tests[checkName][0] + "' with options '" + urlTests[testName].tests[checkName][1] + "'");
			} else {
				work.emailText.push("✅: Body matches regular expression '" + urlTests[testName].tests[checkName][0] + "' with options '" + urlTests[testName].tests[checkName][1] + "'");
			}
		}

		// TODO: Repeated code below.
		if (checkName === "firstByte") {
			if (results[L-1]["timingPhases"][checkName] > urlTests[testName].tests[checkName]) {
				fails++;
				work.testFailures.push(checkName);
				work.emailText.push("❌: Time to first chunk of " + round(results[L-1]["timingPhases"][checkName]) + " > " + urlTests[testName].tests[checkName] + " ms");
			} else {
				work.emailText.push("✅: Time to first chunk of " + round(results[L-1]["timingPhases"][checkName]) + " <= " + urlTests[testName].tests[checkName] + " ms");				
			}
		}
		if (checkName === "download") {
			if (results[L-1]["timingPhases"][checkName] > urlTests[testName].tests[checkName]) {
				fails++;
				work.testFailures.push(checkName);
				work.emailText.push("❌: Request transfer time of " + round(results[L-1]["timingPhases"][checkName]) + " > " + urlTests[testName].tests[checkName] + " ms");
			} else {
				work.emailText.push("✅: Request transfer time of " + round(results[L-1]["timingPhases"][checkName]) + " <= " + urlTests[testName].tests[checkName] + " ms");				
			}
		}
		if (checkName === "total") {
			if (results[L-1]["timingPhases"][checkName] > urlTests[testName].tests[checkName]) {
				fails++;
				work.testFailures.push(checkName);
				work.emailText.push("❌: Request time of " + round(results[L-1]["timingPhases"][checkName]) + " > " + urlTests[testName].tests[checkName] + " ms");
			} else {
				work.emailText.push("✅: Request time of " + round(results[L-1]["timingPhases"][checkName]) + " <= " + urlTests[testName].tests[checkName] + " ms");				
			}
		}

	}

	// Prepare email

	let requestDate = work.requestStartTime.toISOString().replace(/T.*/,'').replace(/-/g,'');
	let d = new Date(work.requestStartTime);
	let requestDateLast = (new Date(d.setDate(d.getDate()-1))).toISOString().replace(/T.*/,'').replace(/-/g,'');
	let text = "Test URL\n  " + urlTests[testName].url + "\n\n" + work.emailText.join("\n");
		text = text + "\n\nTest configuration\n  " + config.app.publicHTML + "log/" + testName + "/settings.json";

	let text2 = "\n\nSummary file:\n  " + config.app.publicHTML + results[L-1].entryFile.replace(__dirname + "/", "");
		text2 = text2 + "\n\nLast summary plot:\n  " + config.app.publicHTML + "#" + testName + "-" + requestDate + ".csv";

	if (L > 1) { // More than one test performed.
		// Assumes file from previous day exists.
		text2 = text2 + "\n\nLast two response files:\n  " + config.app.publicHTML + results[L-1].workFile.replace(__dirname + "/", "");
		text2 = text2 + "\n  " + config.app.publicHTML + results[L-2].workFile.replace(__dirname + "/", "");
	} else {
		text2 = text2 + "\n\nLast response file:\n  " + config.app.publicHTML + results[L-1].workFile.replace(__dirname + "/", "");
	}

	results[L-1].testError = false;
	if (fails > 0) {
		results[L-1].testError = true;
	}
	
	work.testFails = fails;

	let sendFailEmail = false;
	let sendPassEmail = false;
	let s = (fails > 1) ? "s" + " (" + fails + ")" : "";

	if (L == 1 && results[L-1].testError) {
		sendFailEmail = true;
	}
	if (L > 1) {
		if (results[L-1].testError && !results[L-2].testError) {
			sendFailEmail = true;
		}
		if (!results[L-1].testError && results[L-2].testError) {
			sendPassEmail = true;
		}
		if (results[L-1].testError && results[L-2].testError) {
			let s2 = results[L-2].testFails > 1 ? "s" + " (" + results[L-2].testFails + ")" : "";
			let reason = testName + ": Not sending email because error" + s + " found in this check and error" + s2 + " found in last check.";
			console.log("test(): " + reason);
			work.emailNotSentReason = reason;
		}

	}

	work.emailSent = false;

	let to, body, subject;
	if (sendFailEmail || sendPassEmail) {
		to = urlTests[testName].email;
		body = text + text2;		
	}

	if (sendFailEmail) {
		subject = "❌ " + testName + " URLWatcher: " + "Test Failure" + s;
		email(to, subject, body);
		work.emailSent = true;
	}
	if (sendPassEmail) {
		subject = "✅ " + testName + " URLWatcher: All Tests Passed" + s;
		email(to, subject, body);
		work.emailSent = true;
	}

	// TODO: Handle email send failure.
	if (work.emailSent) {
		let email = "To: " + maskEmailAddress(to) + "\n"
					+ "Subject: " + subject + "\n"
					+ "Body:\n"
					+ "  " + body.replace(/\n/g,'\n  ');

		if (!fs.existsSync(work.emailDirectory)) {
			mkdirp.sync(work.emailDirectory);
		}
		fs.writeFileSync(work.emailFile, email);

		console.log("------------------------------------------------------------------");
		console.log(email);
		console.log("------------------------------------------------------------------");		
	}

	work.emailText = text + text2;

	report(testName, work);
}

function maskEmailAddress(addr) {
	if (!addr) return "";

	// username@host => us...@host
	let tmp = addr.split('@');
	let uname = tmp[0];
	let host = tmp[1];
	return uname[0] + uname[1] + '...@' + host
}

function email(to, subject, text, cb) {

	if (!config.app.emailMethod) {
		if (cb) {
			cb();
		}
		return;
	}

	if (arguments.length < 3) {
		text = subject;
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
		email(config.app.emailStatusTo, "URLWatcher stopped at " + (new Date()).toISOString(), "", function () {process.exit(1);});
	} else {
		console.log("shutdown(): Not sending stop message b/c emailStatus = false.");
		process.exit(1);
	}
}
 