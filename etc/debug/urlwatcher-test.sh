CONFIG_FILE="test/test-config.json"
if [ $# -gt 0 ]; then
  CONFIG_FILE=$1
fi

~/.nvm/versions/node/v20.18.1/bin/node \
  --max-old-space-size=96 \
  urlwatcher.js -d -p 4444 -c $CONFIG_FILE
