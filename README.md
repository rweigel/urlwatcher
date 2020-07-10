# Install

Install [nodejs](https://nodejs.org/en/download/) (tested with v6) using either the [standard installer](https://nodejs.org/en/download/) or [NVM](https://github.com/creationix/nvm).

<details> 
  <summary>Show NVM installation notes</summary>
  
```bash
# Install Node Version Manager
curl https://raw.githubusercontent.com/creationix/nvm/v0.9.5/install.sh | bash

# Set environment variables (needed only once)
source ~/.bashrc

# Install node.js version 6
nvm install 6

# If system has old nodejs already installed by package manager,
# must always execute this before starting app
nvm use 6
```
</details>

```
git clone https://github.com/rweigel/urlwatcher
npm install
```

# Configure

The two configuration files listed below have comments that describe the options.

1. Edit `!!!!` fields in config file `app-config.json`.
2. Edit `tests/example.json`.

# Run

```	
nvm use 6 # (not needed if node -v returns version 6+)
node app.js [config file]
```

# Development

```
npm test
```

# TODO:

1. https://stackoverflow.com/a/39128820
1. Option to write work files - these files take up a lot of space. Perhaps exclude body or when fail save lastBodyPass and currentBody?
2. Try using HighCharts instead of Plotly. Plotly wraps for d3.js and it omits many important parts (see comments in code). Plotly/d3.js uses SVG and much effort would be needed to improve speed (see https://blog.scottlogic.com/2014/09/19/d3-svg-chart-performance.html). (However, try using Plot.ly's ScatterGL; would need to switch to lines - see html/scattergl for possible fix to speed issue). Could also implement something like http://datashader.org/index.html). HighCharts uses HTML Canvas and has many speed optimizations, better documentation, more options, is free for academic use, and robust development group. Others that use canvas are Flot, CanvasJS, RGraph, http://smoothiecharts.org/. Also consider https://mango-is.com/blog/engineering/pre-render-d3-js-charts-at-server-side/ and https://community.plot.ly/t/how-to-perform-server-side-manipulation-using-plotly-js/1077/6.
4. Consider https://plot.ly/python/plotly-express/
3. For test, set threshold for download, total, and firstByte to value near their averages.
4. Instructions on testing email client.
5. Show alert threshold for ttfb, etc., on plots
6. Use timeout parameter in request.js
