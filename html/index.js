let URLWatcher = 
	{
		'displayLocalTime': true, // Time stamps in local time
		'dropdowns': {},
		'lastClicked': '',
		'settings': {},
		'plots':
			[
				{
					'id': 'plot0',
					'paramID': 'fails',
					'paramName': '# of test failures',
					'paramUnits': ''
				},
				{
					'id': 'plot1',
					'paramID': 'ttfb',
					'paramName': 'Time to First Byte',
					'paramUnits': 'ms'
				}
			],
		'plotly': {
			options: {
				"displayModeBar": false,
    			"doubleClick": 'reset' // false, 'reset', 'autosize', or 'reset+autosize'
			},
			trace: {
				good: {
					type: "bar",
					marker: {
						color: 'black', 
						line: {
							color: 'black', 
							width: 2, 
							color: 'black'
						}
					}
				},
				bad: {
					type: "bar",
					marker: {
						color: 'red', 
						line: {
							color: 'red', 
							width: 2, 
							color: 'red'
						}
					}
				},
				nosample: {
					type: "bar",
					marker: {
						color: 'blue', 
						line: {
							color: 'blue', 
							width: 2, 
							color: 'blue'
						}
					}
				}
			},
			layout: {
				font: {family: 'Times', size: 16},
				hovermode: 'closest',
				hoverdistance: 1,
				showlegend: true,
				hoverlabel: {namelength: 100},
				legend: {
					"x": 0,
					"y": 1,
					bgcolor: 'rgba(255,255,255,0.9)',
					"orientation": "h"
				},
				autosize: true,
				hovermode: true,
				xaxis: {
					// To use tickformat, also need to set format for tick stops for different zoom levels
					// https://plot.ly/python/tick-formatting/#tickformatstops-to-customize-for-different-zoom-levels
					// See https://github.com/plotly/plotly.js/blob/master/src/plots/cartesian/axes.js#L1051
					//'tickformat': '%H:%M:%S\n%Y-%m-%d',
					showline: true, // bottom line
					visible: true,
					showticklabels: true,
					mirror: true, // show top line
					showgrid: true,
					linecolor: 'black',
				},
				yaxis: {
					zeroline: false,
					linecolor: 'black',
					mirror: true
				},
				margin: {
					l: 50,
					r: 20,
					b: 50,
					t: 10,
					pad: 0
				},
				paper_bgcolor: '#ffffff',
				plot_bgcolor: '#ffffff'
			}
		}
	}

$(document).ready(() => {

	// Processing starts by downloading tests. When download complete,
	// hashchange triggered, which calls hashchange(). 
	// hashchange() is the main management function.

	$("#help").click(function () {$("#info").show()});
	$("#info").hover(() => {}, function () {$(this).hide()});

	$(window).on('resize', () => {
		console.log("main(): Window size change.");
		plot.setCanvasWH();
	});

	// Drop-down change events
	// TODO: Repeated code.
	$('#dateDropdown').change(function(evt) {
		let val = $(this).val();
		console.log("#dateDropdown.change(): Changed to " + val);
		if (evt.originalEvent) {
			console.log("#dateDropdown.change(): Calling setHashValue()");
			setHashValue('date', val);
		} else {
			console.log("#dateDropdown.change(): Not updating hash "
					  + " because event not triggered by user interaction.");
		}
	})
	$('#testDropdown').change(function(evt) {
		let val = $(this).val();
		console.log("#testDropdown.change(): Changed to " + val);
		if (evt.originalEvent) {
			console.log("#testDropdown.change(): Calling setHashValue()");
			setHashValue('test', val);
		} else {
			console.log("#testDropdown.change(): Not updating hash because "
		   			  + " event not triggered by user interaction.");
		}
	})

	// hashchange() is the main app initialization and update function
	$(window).on('hashchange', hashchange)

	// Start processing
	getTests(() => {
		console.log("main(): Test list loaded. Triggering hashchange.");
		$(window).trigger('hashchange');
	})
})

// Similar to console.time(), but more flexibiity in log messages.
function timeit(start, stop) {
	if (timeit[start]) {
		if (arguments.length == 1) {
			console.error(
				"Error: timeit() may have been started"
			  + " more than once with same start message of "
			  + start);
			return;
		}
		let t = new Date().getTime() - timeit[start];
		console.log(stop.replace("{}",t + " ms"));
		delete timeit[start];
	} else {
		timeit[start] = new Date().getTime();
		console.log(start);				
	}
}

// Layout function
function viewportWH() {
	// TODO: Reference where this came from.
	$.scrollbarWidth=function(){var a,b,c;if(c===undefined){a=$('<div style="width:50px;height:50px;overflow:auto"><div/></div>').appendTo('body');b=a.children();c=b.innerWidth()-b.height(99).innerWidth();a.remove()}return c};

	// Based on https://stackoverflow.com/a/22266547/1491619
	// See also https://stackoverflow.com/a/8794370/1491619
	var w = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
	var h = Math.min(document.documentElement.clientHeight, window.innerHeight || 0);
	w = window.innerWidth - $.scrollbarWidth() - 1;
	h = window.innerHeight - $.scrollbarWidth() - 1;
	return {width: w, height: h}
}

// Main application control function
function hashchange(evt) {
	// Note that we can't catch case where user modifies hash, but then
	// hits enter after changing to original value. This will always result
	// in a page reload.

	if (hashchange.block) {
		// Before this function triggers a hash change, it
		// sets hashchange.selfTrigger = true. This prevents
		// that hash change from causing recursive hashchanges.
		hashchange.selfTrigger = false;
		return;			
	}

	console.log('hashchange(): window.hashchange event: Hash changed.');
	console.log('hashchange(): evt.originalEvent = ' 
					+ (evt.originalEvent ? true : false))
	console.log('hashchange(): evt.isTrigger = ' 
					+ (evt.isTrigger ? true : false))
	console.log(evt);

	let tests = Object.keys(URLWatcher['dropdowns']);
	let test = getHashValue('test');

	if (test) {
		if (tests.indexOf(test) == -1) {
			alert("hashchange(): window.hashchange: " 
					+ test + " is not in list of available tests: " 
					+ tests.join(",") + ".");
			test = tests[0];
		}
	} else {
		console.log('hashchange(): window.hashchange: No test in hash. '
						+' Setting to first test in list.');
		test = tests[0];
	}

	console.log('hashchange(): Clearing plots.');
	$('#plots').html('');

	hashchange.selfTrigger = true;
	setHashValue('test', test);

	// Set test value in drop-down
	$("#testDropdown").val(test);

	// Get available dates for selected test
	getDates(test, function() {

		let dates = URLWatcher['dropdowns'][test];
		let date = getHashValue("date");
		if (date) {
			if (dates.indexOf(date) == -1) {
				console.log("getDates().cb(): "
							+ date 
							+ " is not in list of available tests: " 
							+ dates.join(",") + ".");
				alert('Invalid date. Resetting to default.')
				date = URLWatcher['dropdowns'][test][0];
				setHashValue('date', date);
				return;
			}
		} else {
			console.log('getDates().cb(): No date in hash. '
						+ 'Setting to first test in list.');
			date = URLWatcher['dropdowns'][test][0];
		}

		hashchange.selfTrigger = true;
		setHashValue('date', date);

		// Set date value in dropdown
		$("#dateDropdown").val(date);

		// Show time zone in header
		if (URLWatcher['displayLocalTime']) {
			let timeZoneName = Intl
								.DateTimeFormat()
								.resolvedOptions()
								.timeZone;
			let split = new Date().toString().split("GMT");
			//let timeZoneNumber = "GMT" + split[1]; 
			// To get, e.g., GMT-0400.
			$('#timezone').text("Time Zone: " 
								+ timeZoneName.replace("_"," "));
		} else {
			$('#timezone').text("Time Zone: GMT");
		}

		// Compute data file name
		let logFile = "log/" + test + "/log/" + date + ".csv";

		// Set tab/window title
		document.title = "URLWatch: " + test;

		// Set and show log directory link
		$('#logDirectory')
			.attr("href", "log/" + test)
			.show();

		// Set and show test settings file 
		$('#testSettings')
			.attr("href", "log/" + test + "/settings.json")
			.show();

		let testSettingsMsg = "getDates.cb(): Getting test settings"; 
		timeit(testSettingsMsg);
		getJSON('log/' + test + '/settings.json', function (data) {
			timeit(testSettingsMsg, testSettingsMsg.replace('settings','too {}'));
			URLWatcher['settings'][test] = data;
			plot(logFile, test);
		});
	});
}

// location.hash functions
function setHashValue(key, val) {
	console.log("setHashValue(): Setting hash key " + key + " to " + val);
	let obj = getHash();
	obj[key] = val;
	setHash(obj);
}
function setHash(obj) {
	let hasho = window.location.hash;
	console.log("setHash(): Setting hash to ");
	console.log(obj);
	let hash = "#";
	let sep = "";
	for (let key in obj) {
		hash = hash + sep + key + "=" + obj[key];
		if (sep === "") {
			sep = "&";
		}
	}
	if (hash === hasho) {
		console.log("setHash(): New hash value equals old.");
	} else {
		console.log("setHash(): Setting hash to " + hash);
		window.location.hash = hash;
	}
}
function getHashValue(key) {
	// https://github.com/allmarkedup/purl
	let obj = getHash();
	if (!obj) {
		return undefined;
	} else {
		return obj[key];
	}
}
function getHash() {
	// https://github.com/allmarkedup/purl
	return purl(window.location.href).fparam();
}


// AJAX JSON fetch
function getJSON(file, cb) {
	console.log("getJSON(): Getting " + file);
	let req = new XMLHttpRequest();
	req.onreadystatechange = function() {
		if (req.readyState === 4) {
			if (req.status === 200) {
				var data = JSON.parse(req.responseText);
				if (cb) {
					console.log("getJSON(): Got " + file);
					cb(data);
				}
			}
		}
	};
	req.open('GET', file);
	req.send(); 
}

// Download list of tests
function getTests(cb) {
	getJSON('log/tests.json', function (data) {
		console.log(data);
		// Set test drop-down values
		$.each(data, function (i, p) {
			URLWatcher['dropdowns'][data[i]] = [];
			$('#testDropdown')
				.append($('<option></option>')
					.val(p)
					.html(p));
		})
		$('#testDropdown').show();
		cb();
	})
}

// Download available dates for test
function getDates(test, cb) {

	$('#dateDropdown').html('');
	getJSON('log/' + test + '/log/files.json', function (data) {
		console.log(data);
		let file;
		// Set drop-down values.
		$.each(data, function (i, p) {
			file = p.replace(".csv", "");
			URLWatcher['dropdowns'][test][i] = file;
			$('#dateDropdown')
				.append($('<option></option>')
					.val(file)
					.html(file));
		})
		$('#dateDropdown').show();
		cb();
	})
}
