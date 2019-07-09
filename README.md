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

2. Try using HighCharts instead of Plotly. Plotly wraps for d3.js and it omits many important parts (see comments in code). Plotly/d3.js uses SVG and much effort would be needed to improve speed. HighCharts uses HTML Canvas and has many speed optimizations, better documentation, more options, is free for academic use, and robust development group.
3. For test, set threshold for download, total, and firstByte to value near their averages.
4. Instructions on testing email client.
5. Show alert threshold for ttfb, etc., on plots
6. Use timeout parameter in request.js
