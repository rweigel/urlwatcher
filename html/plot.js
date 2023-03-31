// Plot functions

function plot(logFile, test, cb) {

	plot.setCanvasWH = function() {
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

	plot.setCanvasWH();

	function legendclickevent(eventdata) {
		//console.log(eventdata);
		//console.log(layout[0])
	}

	function relayoutevent(eventdata) {

		let id = URLWatcher['lastClicked'];

		//console.log("relayoutevent(): Relayout event due to interaction on " + id + ". Event data:");
		//console.log(eventdata);

		let gd = document.getElementById(id);

		if (id && gd._dragging) {
			console.log("relayoutevent(): Event is associated with dragging. " 
						+ "Returning.");
			return;
		}

		if (eventdata['yaxis.autorange'] == false) {
			// This prevents recursive calls. When eventdata['yaxis.autorange']
			// is set to false and Plotly.relayout is called, another relayout
			// event is triggered, but eventdata will not have 
			// eventdata['yaxis.autorange'] = false.
			console.log("relayoutevent(): yaxis.autorange == false. Returning."); 
			return;
		}

		//let current = JSON.stringify(eventdata);
		let current = eventdata;

		console.log("relayout.last    = ");
		console.log(relayoutevent.last);
		console.log("relayout.current = ");
		console.log(current);

		// Deal with limitation on Plotly's events. This blocks a relayout in
		// this function from triggering another relayout event.
		let update = false;
		if (typeof(relayoutevent.last) !== "undefined") {
			let keys = Object.keys(current);
			for (let key in keys) {
				if (current[keys[key]] === relayoutevent.last[keys[key]]) {
					console.log('Value of ' 
									+ keys[key] 
									+ ' in current matches that in last');
				} else {
					console.log('Value of ' 
							  + keys[key] 
						      + ' in current does not match that in last');
					update = true;
					break;
				}
			}
			if (!update) {				
				console.log('relayoutevent(): Relayout already called with'
						  + ' same event data. No relayout will be performed.');
				return;
			} else {
				console.log('relayoutevent(): ' 
						  + 'Updating relayoutevent.last = current');
				relayoutevent.last = current;
			}				
		} else {
			console.log('relayoutevent(): Setting undefined relayoutevent.last '
					  + 'to relayoutevent.current');
			relayoutevent.last = current;
		}

		// Ideally there would be a better way to determine if zoom was reset.
		// Use plotly_dblcick? TODO: zoomReset is no longer used.
		let zoomReset = eventdata['xaxis.autorange'] == true 
						|| eventdata['yaxis.autorange'] == true

		if (zoomReset) {
			console.log('relayoutevent(): Relayout event was zoom reset on '
							+ URLWatcher['lastClicked'] + ". Event data:");
		} else {
			console.log('relayoutevent(): Relayout event was zoom in on '
							+ URLWatcher['lastClicked'] + ". Event data:");
		}
		console.log(eventdata);

		let Np = URLWatcher['plots'].length;
		for (let p = 0; p < Np; p++) {

			id = URLWatcher['plots'][p]['id'];

			console.log("relayoutevent(): Checking " + id)

			// Clone object
			let eventdatac = JSON.parse(JSON.stringify(eventdata));

			// Needed b/c zoom event does not use yaxis.range that was set on
			// initial plot. Better test is if gd.layout.yaxis.range is set?
			if (false && URLWatcher['plots'][p]['paramID'] === 'fails') {
				let gd = document.getElementById(id);
				eventdatac['yaxis.range[0]'] = gd.layout.yaxis.range[0];
				eventdatac['yaxis.range[1]'] = gd.layout.yaxis.range[1];
				eventdatac['yaxis.autorange'] = false;
				console.log('relayoutevent(): Setting layout data on ' 
							+ id + " to ");
				console.log(eventdatac);
			}

			let a = id == URLWatcher['lastClicked'];
			let b = URLWatcher['plots'][p]['paramID'] !== 'fails';
			if (a && b) {
				// Don't update clicked plot unless it was 'fails', which needs
				// to have its y-range reset.
				console.log('relayoutevent(): No action being taken for ' + id);
			} else {
				delete eventdatac['yaxis.range[0]'];
				delete eventdatac['yaxis.range[1]'];
				delete eventdatac['yaxis.autorange'];
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

	function clickevent(eventdata) {
		console.log('clickevent(): Click-on-data event. Data:');
		console.log(eventdata);

		d = new Date(eventdata['points'][0]['x'].replace(" ","T"));
		//console.log('clickevent(): First time value:');
		//console.log(d)
		if (URLWatcher['displayLocalTime']) {
			off = d.getTimezoneOffset()*60000;
			console.log('clickevent(): Timezone offset = ' + off);
		}
		
    if (eventdata['points'][0]['data']['marker']['color'] == 'red') {
			console.log('clickevent(): Updating link to JSON test file');			
      let href = 'log/' + test + '/requests/' 
               + d.toISOString().replace("Z", "") + '.json';
      if (true) {
        //getJSON(href, (json) => {
        //  console.log(json['emailBody']);
        //})
        window.open(href,'_blank');
      } else {
        $('#testDataLink')
          .css('background-color', 'yellow')
          .attr('href', href);
        $('#testDataSpan').css('visibility','visible');
        // Remove background color after 1000 ms.
        setTimeout(() => {
          $('#testDataLink').css('background-color','')}, 1000);
      }
    } else {
			$('#testDataSpan').css('visibility','hidden');    	
		}
	}

	let layouts = [];
	let traces = [];
	let trace = {'good': [], 'bad': [], 'nosample': []};
	function doplots(p, rows) {

		// Plots are created and shown serially. Otherwise time to show anything
		// equals about 2x the time to plot one only.

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
			// Set bar width to slightly less than sampling period.
			// TODO: Adjust this based on zoom level and bar width
			// Can only see gaps for certain combinations.
			trace[key][p]['width'] = 0.90*interval;
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
			condition = " ≤ " + threshold; 
			condition_bad = " > " + threshold;
			layouts[p]['yaxis']['range'] = [-0.05*threshold, threshold];

			let annotation0 = 	
				{
					y: layouts[p]['yaxis']['range'][1],
					ay: 0.95*layouts[p]['yaxis']['range'][1],
					xref: 'x',
					yref: 'y',
					axref: 'x',
					ayref: 'y',
					text: '',
					scale: 1,
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
				// TODO: Add another arrow head with everything the same except for scale
				// = 2 and color = black so that arrowhead is visible when zoomed-in.
				// Could also try to figure out arrow head width based on how wide
				// bars are in pixels, but would need to do that after rendering.
				layouts[p]['annotations'].push(annotation);
			}
			console.log('Annotations: on ' + paramID + ":");
			console.log(layouts[p]['annotations'])
		}

		let units = URLWatcher['plots'][p]['paramUnits'];
			units = units ? " [" +  units + "] " : '';

		trace['good'][p].name = URLWatcher['plots'][p]['paramName'] 
								+ condition
								+ units
								+ " (N = " + data['Ngood'] + ")";

		trace['bad'][p].name = URLWatcher['plots'][p]['paramName']
								+ condition_bad
								+ units
								+ " (N = " + data['Nbad'] + ")";

		trace['nosample'][p].name = "No sample; connection error "
									 + " (N = " + data['Nnosample'] + ")";

		let plot = document.getElementById(id);
		Plotly
			.newPlot(id, traces[p], layouts[p], URLWatcher['plotly']['options'])
			.then(function() {
				$(plot).on('mousedown', () => {
					console.log(id + ' jQuery mousedown');
					// Plotly's plotly_relayout does not return the identity
					// of the plot clicked. So this is stored using a top-level
					// variable.
					if (URLWatcher['lastClicked'] == id) {
						let now = new Date().getTime();
						if (now - URLWatcher['lastClickedTime'] < 500) {
							console.log(id + ' jQuery alt. double click.');
						}
					}
					URLWatcher['lastClicked'] = id;
					URLWatcher['lastClickedTime'] = new Date().getTime();
				})
				$(plot).on('dblclick', () => {
					// Does not trigger! Over-written by Plotly?
					// (b/c works on div if no plot written to div.)
					console.log(id + ' jQuery standard double click');
				})

				plot.on('plotly_doubleclick', function() {
					console.log(id + ' plotly double click');
				})
				plot.on('plotly_click', clickevent); // Click on data only!
				plot.on('plotly_legendclick', legendclickevent); 
				plot.on('plotly_relayout', relayoutevent);
				plot.on('plotly_relayouting', relayoutingevent);
				timeit(plotMsg, plotMsg.replace("started", "took {}"));
				p = p + 1;
				if (p < URLWatcher['plots'].length) {		
					// setTimout used so browser rendering of previous plot 
					// happens before processing for next.
					setTimeout(() => {
						doplots(p, rows)
					}, 0);
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
		let datestr = "";
		for (let r = 0; r < rows.length; r++) {
			if (URLWatcher['displayLocalTime']) {
				let d = new Date(rows[r]['Date']);
				let off = d.getTimezoneOffset()*60000;
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
		return {
					'date': data[0],
					'good': data[1],
					'bad': data[2],
					'nosample': data[3],
					'Ngood': Ngood,
					'Nbad': Nbad,
					'Nnosample': Nnosample
		 		}
	}
	let logFileReadMsg = 'Plotly.d3.csv(): ' + logFile + ' read start.';
	timeit(logFileReadMsg);
	Plotly.d3.csv(logFile, 
		function (err, rows) {
			timeit(logFileReadMsg, 'Plotly.d3.csv(): ' 
									+ logFile 
									+ ' read in {}; # rows = ' 
									+ rows.length);
			doplots(0, rows);
	})
}
