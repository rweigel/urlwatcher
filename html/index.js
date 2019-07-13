
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
					'paramName': '# of test failures'
				},
				{
					'id': 'plot1',
					'paramID': 'ttfb',
					'paramName': 'Time to First Byte [ms]'
				}
			]
	}

	let trace_base = {
		type: "bar",
		marker: {
			color: 'black', 
			line: {
				color: 'black', 
				width: 2, 
				color: 'black'
			}
		}
	}

	let trace_bad_base= {
		type: "bar",
		marker: {
			color: 'red', 
			line: {
				color: 'red', 
				width: 2, 
				color: 'red'
			}
		}
	}

	let trace_nosample_base = {
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

	let layout_base = {
		font: {family: 'Times', size: 16},
		hovermode:'closest',
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

	options = {"displayModeBar": false};

$(document).ready(function(){
	$("#help").click(function () {$("#info").show()});
	$("#info").hover(() => {}, function () {$(this).hide()});

	// Main app initialization and update function
	$(window).on('hashchange', hashchange)

	// Note that we can't catch case where user modifies hash, but then
	// hits enter after changing to original value. This will always result
	// in a page reload.
	function hashchange(evt) {

		if (hashchange.block) {
			// Before this function triggers a hash change, it
			// sets hashchange.selfTrigger = true. This prevents
			// that hash change from causing recursive hashchanges.
			hashchange.selfTrigger = false;
			return;			
		}

		console.log('hashchange(): window.hashchange event: Hash changed.');
		console.log('hashchange(): evt.originalEvent = ' + (evt.originalEvent ? true : false))
		console.log('hashchange(): evt.isTrigger = ' + (evt.isTrigger ? true : false))
		console.log(evt);

		let tests = Object.keys(URLWatcher['dropdowns']);
		let test = getHashValue('test');

		if (test) {
			if (tests.indexOf(test) == -1) {
				alert("hashchange(): window.hashchange: " + test + " is not in list of available tests: " + tests.join(",") + ".");
				test = tests[0];
			}
		} else {
			console.log('hashchange(): window.hashchange: No test in hash. Setting to first test in list.');
			test = tests[0];
		}

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
					console.log("window.hashchange: " + date + " is not in list of available tests: " + dates.join(",") + ".");
					alert('Invalid date. Resetting to default.')
					date = URLWatcher['dropdowns'][test][0];
					setHashValue('date', date);
					return;
				}
			} else {
				console.log('window.hashchange: No date in hash. Setting to first test in list.');
				date = URLWatcher['dropdowns'][test][0];
			}

			hashchange.selfTrigger = true;
			setHashValue('date', date);

			// Set date value in dropdown
			$("#dateDropdown").val(date);

			// Show time zone in header
			if (URLWatcher['displayLocalTime']) {
				let timeZoneName = Intl.DateTimeFormat().resolvedOptions().timeZone;
				let split = new Date().toString().split("GMT");
				//let timeZoneNumber = "GMT" + split[1]; // To get, e.g., GMT-0400.
				$('#timezone').text("Time Zone: " + timeZoneName.replace("_"," "));
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

			console.log("window.hashchange event: Calling plot('" + logFile + "'')");

			let plotMsg = 'window.onhashchange: Plotting started';

			getJSON('log/' + test + '/settings.json', function (data) {
				URLWatcher['settings'][test] = data;
				xplot(logFile, test);
			});

			//timeit(plotMsg)
			//plot(logFile, "", 
			//		() => timeit(plotMsg, plotMsg.replace("started", "took {}")));
		});
	};

	$(window).on('resize',function () {
		console.log("Window size change.");
		setplotWH();
	});

	// Drop-down change events
	$('#dateDropdown').change(function(evt) {
		let val = $(this).val();
		console.log("#dateDropdown.change(): Changed to " + val);
		if (evt.originalEvent) {
			console.log("#dateDropdown.change(): Calling setHashValue()");
			setHashValue('date', val);
		} else {
			console.log("#dateDropdown.change(): Not updating hash because event not triggered by user interaction.");
		}
	})

	$('#testDropdown').change(function(evt) {
		let val = $(this).val();
		console.log("#testDropdown.change(): Changed to " + val);
		if (evt.originalEvent) {
			console.log("#testDropdown.change(): Calling setHashValue()");
			setHashValue('test', val);
		} else {
			console.log("#testDropdown.change(): Not updating hash because event not triggered by user interaction.");
		}
	})

	// Alternative to console.time()
	function timeit(start, stop) {
		if (timeit[start]) {
			if (arguments.length == 1) {
				console.error("Error: timeit() may have been started more than once with same start message of " + start);
				return;
			}
			let t = new Date().getTime()-timeit[start];
			console.log(stop.replace("{}",t + " ms"));
			delete timeit[start];
		} else {
			timeit[start] = new Date().getTime();
			console.log(start);				
		}
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
	function checkHash() {

		let obj = getHash();
		let keys = Object.keys(obj);
		let validkeys = keys.filter(value => ["test","date"].includes(value));
		let invalidkeys = keys.filter(x => !["test","date"].includes(x));
		for (let i = 0;i < invalidkeys.length;i++) {
			delete obj[invalidkeys[i]];
			console.log("checkHash(): Dropping unknown key " + invalidkeys[i]);
		}
		let tests = Object.keys(URLWatcher['dropdowns']);
		if (obj["test"]) {
			if (tests.indexOf(obj["test"]) == -1) {
				console.log("checkHash(): " + obj["test"] + " is not in list of available tests: " + tests.join(",") + ".");
				return false;
			}
		}
		if (obj["date"]) {
			console.log(URLWatcher['dropdowns'])
			if (URLWatcher['dropdowns'][obj["dates"]].indexOf(obj["date"]) == -1) {
				console.log("checkHash(): " + obj["date"] + " is not in list of available dates for this test: " + URLWatcher['dropdowns'][obj["test"]].join(","));
				return false;
			}
		}
		return true;
	}

	// Layout functions
	function viewportWH() {
		// Based on https://stackoverflow.com/a/22266547/1491619
		// See also https://stackoverflow.com/a/8794370/1491619
		var w = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
		var h = Math.min(document.documentElement.clientHeight, window.innerHeight || 0);
		w = window.innerWidth - $.scrollbarWidth() - 1;
		h = window.innerHeight - $.scrollbarWidth() - 1;
		return {width: w, height: h}
	}

	function setplotWH() {
		let vp = viewportWH();
		console.log('setplotWH(): Called. Viewport width and height:');
		console.log(vp);
		var height = vp.height
					- $('#header').height()
					- parseInt($('body').css('margin-top'))
					- parseInt($('body').css('margin-bottom'));

		let Np = URLWatcher['plots'].length;
		let plotheight = Math.floor(height/Np);
		let id;
		for (let p = 0; p < Np;p++) {
			id = URLWatcher['plots'][p]['id'];
			if ($("#" + id).length == 0) {
				let div = '<div id="' + id + '"></div>';
				$('#plots').append(div);				
				document.getElementById(id).style.height = plotheight;
			} else {
				console.log('setplotWH(): Updating width and height of ' + id);
				console.log([vp.width, plotheight]);
				Plotly.relayout(id, {width: vp.width, height: plotheight});
				$('#' + id).width(vp.width).height(plotheight);
			}
		}		
	}

	// TODO: Reference where this came from.
	$.scrollbarWidth=function(){var a,b,c;if(c===undefined){a=$('<div style="width:50px;height:50px;overflow:auto"><div/></div>').appendTo('body');b=a.children();c=b.innerWidth()-b.height(99).innerWidth();a.remove()}return c};

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

	function getDates(test, cb) {
		$('#dateDropdown').html('');
		getJSON('log/' + test + '/log/files.json', function (data) {
			console.log(data);
			let file;
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

	// Main plot function
	function xplot(logFile, test, cb) {

		setplotWH();

		function legendclickevent(eventdata) {
			//console.log(eventdata);
			//console.log(layout[0])
		}

		function relayoutevent(eventdata) {

			console.log("relayoutevent(): Called with data:");
			console.log(eventdata);

			let id = URLWatcher['lastClicked'];
			let gd = document.getElementById(id);

			if (id && gd._dragging) {
				return;
			}

			if (eventdata['yaxis.autorange'] == false) {
				// This prevents recursive calls. When eventdata['yaxis.autorange']
				// is set to false and Plotly.relayout is called, another relayout
				// event is triggered, but eventdata will not have 
				// eventdata['yaxis.autorange'] = false.
				return;
			}

			let current = JSON.stringify(eventdata);

			console.log("relayout.last    = " + relayoutevent.last);
			console.log("relayout.current = " + current);
			console.log("relayout.current === relayout.last: " 
						+ relayoutevent.last === current);

			// Deal with limitation on Plotly's events. This blocks
			// a relayout in this function from triggering another
			// relayout event.
			if (typeof(relayoutevent.last) !== "undefined") {
				if (relayoutevent.last === current) {
					console.log('relayoutevent(): Relayout already called'
							+ ' with same event data. No relayout will be performed.');
					return;
				} else {
					console.log('relayoutevent(): Changing relayoutevent.last to ');
					console.log(current);
					relayoutevent.last = current;
				}				
			} else {
				console.log('relayoutevent(): Setting undefined relayoutevent.last to ');
				console.log(current);
				relayoutevent.last = current;
			}

			// Ideally there would be a better way to determine if zoom was reset.
			// Use plotly_dblcick? TODO: zoomReset is no longer used.
			let zoomReset = eventdata['xaxis.autorange'] == true 
							&& eventdata['yaxis.autorange'] == true

			if (zoomReset) {
				console.log('relayoutevent(): Zoom reset event on '
								+ URLWatcher['lastClicked'] + " Event data:");
			} else {
				console.log('relayoutevent(): Zoom event on '
								+ URLWatcher['lastClicked'] + " Event data:");
			}
			console.log(eventdata);

			let Np = URLWatcher['plots'].length;
			for (let p = 0; p < Np; p++) {

				id = URLWatcher['plots'][p]['id'];

				console.log("relayoutevent(): Checking " + id)

				// Clone object
				let eventdatac = JSON.parse(JSON.stringify(eventdata));


				// Needed b/c zoom event does not use yaxis.range that was set on initial plot.
				// Better test is if gd.layout.yaxis.range is set?
				if (URLWatcher['plots'][p]['paramID'] === 'fails') {
					// TODO: Range values for 'fails' appear in two places in code. 
					let gd = document.getElementById(id);
					eventdatac['yaxis.range[0]'] = gd.layout.yaxis.range[0];
					eventdatac['yaxis.range[1]'] = gd.layout.yaxis.range[1];
					eventdatac['yaxis.autorange'] = false;
					console.log('relayoutevent(): Setting layout data on ' 
									+ URLWatcher['plots'][p]['paramID']
									+ " to ");
					console.log(eventdatac);
				}

				let a = id == URLWatcher['lastClicked'];
				let b = URLWatcher['plots'][p]['paramID'] !== 'fails';
				if (a && b) {
					// Don't update clicked plot unless it was 'fails', which needs
					// to have its y-range reset.
					console.log('relayoutevent(): No action being taken for ' 
								+ URLWatcher['plots'][p]['paramID']);
				} else {
					delete eventdatac['yaxis.range[0]'];
					delete eventdatac['yaxis.range[1]'];
					console.log('relayoutevent(): Calling Plotly.relayout() on '
									+ id
									+ ' using:');
					console.log(eventdatac);
					// Ideally would turn off zoom event here then re-enable it
					// after relayout performed. Could not get this to work - kept
					// getting recursive calls.
					Plotly.relayout(id, eventdatac);
				}
			}
		}

		function relayoutingevent(eventdata) {
			let debug = false;
			// Find plot that was clicked.
			let Np = URLWatcher['plots'].length;
			let id = URLWatcher['lastClicked'];
			let gd = document.getElementById(id);

			if (debug) console.log('relayoutingevent(): Relayouting event.');
			let range = gd._fullLayout.xaxis.range;
			if (!relayoutingevent.last) {
				relayoutingevent.last = range;
			} else {
				let a = range[0] == relayoutingevent.last[0];
				let b = range[1] == relayoutingevent.last[1];
				if (a && b) {
					if (debug) {
						console.log('relayoutingevent(): No change in xrange.'
									+ ' Not updating other plots.');
					}
					return;
				}
				relayoutingevent.last = range;
			}

			if (debug) console.log('relayoutingevent(): New x-range:');
			if (debug) console.log(range);
			layout = {
						'xaxis.range[0]': range[0],
						'xaxis.range[1]': range[1]
					};

			for (let p = 0; p < Np; p++) {
				id = URLWatcher['plots'][p]['id']
				if (id !== URLWatcher['lastClicked']) {
					Plotly.relayout(id, layout);					
				}
			}

		}

		// Disable double click
		// https://codepen.io/etpinard/pen/XNXKaM
		// https://codepen.io/plotly/pen/PqgLmv
		function clickevent(eventdata) {
			console.log('clickevent(): Click event. Data:');
			console.log(eventdata);

			d = new Date(eventdata['points'][0]['x'].replace(" ","T"));
			//console.log('clickevent(): First time value:');
			//console.log(d)
			if (URLWatcher['displayLocalTime']) {
				off = d.getTimezoneOffset()*60000;
				console.log('clickevent(): Timezone offset = ' + off);
			}
			
			console.log('clickevent(): Updating link to JSON test file');			
			$('#testDataLink')
				.css('background-color', 'yellow')
				.attr('href',
						'log/' + test + '/requests/' 
						+ d.toISOString().replace("Z", "") + '.json');
			$('#testDataSpan').show()

			// Remove background color after 1000 ms.
			setTimeout(() => {
				$('#testDataLink').css('background-color','')}, 1000);
		}

		let layouts = [];
		let traces = [];
		let trace = [];
		let trace_bad = [];
		let trace_nosample = [];
		function doplots(p, rows) {

			let id = URLWatcher['plots'][p]['id'];
			let plot = document.getElementById(id);
			let paramID = URLWatcher['plots'][p]['paramID'];

			let plotMsg = "Plotly.d3.csv(): plot #" + p + " plotting started.";
			timeit(plotMsg);

			layouts[p] = JSON.parse(JSON.stringify(layout_base));
			trace[p] = JSON.parse(JSON.stringify(trace_base));
			trace_bad[p] = JSON.parse(JSON.stringify(trace_bad_base));
			trace_nosample[p] = JSON.parse(JSON.stringify(trace_nosample_base));

			let data = unpack(rows, URLWatcher['plots'][p]['paramID']);
			
			trace[p].x = data[0];
			trace[p].y = data[1];

			if (paramID === 'fails') {

				layouts[p].yaxis.range = [-0.1, 8.1];
				layouts[p].yaxis.tickformat = ',d';
					layouts[p].yaxis.tickmode = 'array',
	    		layouts[p].yaxis.tickvals = [0, 1, 2, 3, 4, 5, 6, 7];

				trace[p].name = URLWatcher['plots'][p]['paramName'] 
								+ " = 0";

				trace_bad[p].x = data[0];
				trace_bad[p].y = data[2];
				trace_bad[p].name = URLWatcher['plots'][p]['paramName']
									+ " ≠ 0";				

				trace_nosample[p].x = data[0];
				trace_nosample[p].y = data[3];
				trace_nosample[p].name = "No sample; connection error";

				traces[p] = [trace[p], trace_bad[p], trace_nosample[p]];
			}

			if (paramID === 'ttfb') {

				trace[p].name = URLWatcher['plots'][p]['paramName'] 
								+ " ≤ " 
								+ URLWatcher['settings'][test]['tests']['firstByte'];

				trace_bad[p].x = data[0];
				trace_bad[p].y = data[2];
				
				trace_bad[p].name = trace[p].name;
				trace_bad[p].name = URLWatcher['plots'][p]['paramName'] 
									+ " > " 
									+ URLWatcher['settings'][test]['tests']['firstByte'];

				trace_nosample[p].x = data[0];
				trace_nosample[p].y = data[3];
				trace_nosample[p].name = "No sample; connection error";

				traces[p] = [trace[p], trace_bad[p], trace_nosample[p]];
			}

			Plotly
				.newPlot(id, traces[p], layouts[p], options)
				.then(function() {
					$(plot).on('mousedown', () => {
						console.log(id + ' mousedown');
						// Plotly's plotly_relayout does not return the identity
						// of the plot clicked. So this is stored using a top-level
						// variable.
						URLWatcher['lastClicked'] = id;
						URLWatcher['lastClickedTime'] = new Date().getTime();
					});
					plot.on('plotly_legendclick', legendclickevent); 
					plot.on('plotly_relayout', relayoutevent);
					plot.on('plotly_relayouting', relayoutingevent);
					plot.on('plotly_click', clickevent);
					timeit(plotMsg, plotMsg.replace("started", "took {}"));
					p = p + 1;
					if (p < URLWatcher['plots'].length) {		
						// setTimout used so browser rendering of previous plot 
						// happens before processing for next. Only tested in Chrome.
						setTimeout(() => {doplots(p, rows);},0);
					}
				})
		}

		function unpack(rows, key) {

			let unpackMsg = "Plotly.d3.csv.unpack(): " + key + " unpacking started.";
			timeit(unpackMsg);
			let data = [[],[],[],[]];
			for (let r = 0; r < rows.length; r++) {
				if (URLWatcher['displayLocalTime']) {
					d = new Date(rows[r]['Date']);
					off = d.getTimezoneOffset()*60000;
					d.setTime(d.getTime() - off);
					datestr = d.toISOString().replace(/T/,' ').replace(/Z/,'');
				} else {
					datestr = row[r]['Date'].replace(/T/,' ').replace(/Z/,'');
				}
				let good = rows[r][key];
				let bad = NaN;
				let nosample = NaN;
				if (key === 'ttfb') {
					let threshold = URLWatcher['settings'][test]['tests']['firstByte'];
					if (rows[r][key] > threshold) {
						bad = rows[r][key];
					}
					if (rows[r]['fails'] == -1) {
						nosample = -threshold/10;
					}
				}
				if (key === 'fails') {
					if (rows[r][key] > 0) {
						bad = rows[r][key];
					}
					if (rows[r][key] == -1) {
						nosample = -0.1;
					}
					if (rows[r][key] == 0) {
						good = 0.01; // To make more visible
					}
				}
				if (!isNaN(bad) || !isNaN(nosample)) {
					good = NaN;
				}
				data[0].push(datestr);
				data[1].push(good);
				data[2].push(bad);
				data[3].push(nosample);
			}
			timeit(unpackMsg, unpackMsg.replace("started","took {}"));
			//console.log(data);
			return data
		}

		let logFileReadMsg = 'Plotly.d3.csv(): ' + logFile + ' read start.';
		timeit(logFileReadMsg);
		Plotly.d3.csv(logFile, 
			function (err, rows) {
				timeit(logFileReadMsg, 
					'Plotly.d3.csv(): ' + logFile + ' read in {}; # rows = ' + rows.length);

				doplots(0, rows);
		})
	}

	// Start process
	getTests(
		function () {
			console.log("getTests(): Test list loaded. Triggering hashchange.");
			$(window).trigger('hashchange');
	})
})
