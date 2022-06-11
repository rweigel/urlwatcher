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
