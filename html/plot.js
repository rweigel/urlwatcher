// Plot functions

function plot(logFile, test, cb) {

	function setCanvasWH() {
		let vp = viewportWH();
		console.log('setCanvasWH(): Called. Viewport width and height:');
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
				console.log('setCanvasWH(): Updating width and height of ' + id);
				console.log([vp.width, plotheight]);
				Plotly.relayout(id, {width: vp.width, height: plotheight});
				$('#' + id).width(vp.width).height(plotheight);
			}
		}		
	}

	setCanvasWH();

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
	let trace = {'good': [], 'bad': [], 'nosample': []};
	function doplots(p, rows) {

		// Plots are created and shown serially.

		let plotMsg = "doplots(): plot #" + p + " plotting started.";
		timeit(plotMsg);

		let id = URLWatcher['plots'][p]['id'];
		let paramID = URLWatcher['plots'][p]['paramID'];

		layouts[p]           = JSON.parse(
									JSON.stringify(
										URLWatcher['plotly']['layout']));
		trace['good'][p]     = JSON.parse(
									JSON.stringify(
										URLWatcher['plotly']['trace']['good']));
		trace['bad'][p]      = JSON.parse(
									JSON.stringify(
										URLWatcher['plotly']['trace']['bad']));

		trace['nosample'][p] = JSON.parse(
									JSON.stringify(
										URLWatcher['plotly']['trace']['nosample']));

		let data = unpack(rows, URLWatcher['plots'][p]['paramID']);
		
		let interval = URLWatcher['settings'][test]['interval'];

		for (key in trace) {
			trace[key][p]['x'] = data['date'];
			trace[key][p]['y'] = data[key];
			// Set bar width to sampling period.
			trace[key][p]['width'] = interval;
		}

		traces[p] = [trace['good'][p], trace['bad'][p], trace['nosample'][p]];

		let condition, condition_bad;
		if (paramID === 'fails') {

			// TODO: If height is too small, adjust tickvals or fontsize.
			layouts[p]['yaxis']['range'] = [-0.1, 8.1];
			layouts[p]['yaxis']['tickformat'] = ',d';
			layouts[p]['yaxis']['tickmode'] = 'array';
			layouts[p]['yaxis']['tickvals'] = [0, 1, 2, 3, 4, 5, 6, 7];

    		condition = " = 0";
    		condition_bad = " ≠ 0";
		}

		if (paramID === 'ttfb') {
			let threshold = URLWatcher['settings'][test]['tests']['firstByte'];
			condition = " ≤ "; 
			condition_bad = " > ";
			layouts[p]['yaxis']['range'] = [-0.05*threshold, 2*threshold];

			let annotation0 = 	
				{
					y: layouts[p]['yaxis']['range'][1],
					ay: 0.95*layouts[p]['yaxis']['range'][1],
					xref: 'x',
					yref: 'y',
					axref: 'x',
					ayref: 'y',
					text: '',
					arrowcolor: 'red',
					showarrow: true,
					arrowhead: 2
				}
			annotation0 = JSON.stringify(annotation0);
			layouts[p]['annotations'] = [];
			let annotation = {};
			let a, b;
			for (let i = 0; i < trace['bad'][p].y.length; i++) {
				a = isNaN(trace['bad'][p].y[i])
				b = trace['bad'][p].y[i] <= layouts[p]['yaxis']['range'][1];
				if (a || b) {
					// Not a bad point if a = true
					// y-value of bad point <= ylmit if b = true
					continue;
				}
				annotation = Object.assign(JSON.parse(annotation0), 
								{
									x: trace['good'][p].x[i],
									ax: trace['good'][p].x[i]
								})
				layouts[p]['annotations'].push(annotation);
			}
			console.log(layouts[p]['annotations'])
		}

		trace['good'][p].name = URLWatcher['plots'][p]['paramName'] 
								+ condition
								+ " (N = " + data['Ngood'] + ")";

		trace['bad'][p].name = URLWatcher['plots'][p]['paramName']
								+ condition_bad
								+ " (N = " + data['Nbad'] + ")";

		trace['nosample'][p].name = "No sample; connection error "
									 + " (N = " + data['Nnosample'] + ")";

		let plot = document.getElementById(id);
		Plotly
			.newPlot(id, traces[p], layouts[p], URLWatcher['plotly']['options'])
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
					setTimeout(() => {doplots(p, rows)},0);
				}
			})
	}

	function unpack(rows, key) {

		let unpackMsg = "Plotly.d3.csv.unpack(): " + key + " unpacking started.";
		timeit(unpackMsg);
		let data = [[],[],[],[]];
		let Ngood = 0;
		let Nbad = 0;
		let Nnosample = 0;
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
					Nbad = Nbad + 1;
				}
				if (rows[r]['fails'] == -1) {
					nosample = -threshold/10;
					Nnosample = Nnosample + 1;
				}
			}
			if (key === 'fails') {
				if (rows[r][key] > 0) {
					bad = rows[r][key];
					Nbad = Nbad + 1;
				}
				if (rows[r][key] == -1) {
					nosample = -0.1;
					Nnosample = Nnosample + 1;
				}
				if (rows[r][key] == 0) {
					good = 0.01; // To make more visible
				}
			}
			if (!isNaN(bad) || !isNaN(nosample)) {
				good = NaN;
			} else {
				Ngood = Ngood + 1;
			}
			data[0].push(datestr);
			data[1].push(good);
			data[2].push(bad);
			data[3].push(nosample);
		}
		timeit(unpackMsg, unpackMsg.replace("started","took {}"));
		//console.log(data);
		return {
					'date': data[0],
					'good': data[1],
					'bad': data[2],
					'nosample': data[3],
					'Ngood': Ngood,
					'Nbad': Nbad,
					'Nnosample': Nnosample
		 		};
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
