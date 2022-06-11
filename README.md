# Install

```
git clone https://github.com/rweigel/urlwatcher
npm install
```

Make sure that you can get either [`nodemailer.js`](test/email/nodemailer.js) or [`sendmail.js`](test/email/sendmail.js) to work. Edit the files to include credentials and then execute with `node`.

# Configure

The two configuration files mentioned below have comments that describe the options.

1. Modify `!!!!` entries in config file [`conf/app-config.json`](conf/app-config.json).
2. Edit [`conf/example.json`](conf/example.json).

# Run

Tested on Node 6-16.

```
node app.js conf/app-config.json
```

# Test

The following runs a simulation and is not an actual unit test.

```
npm test
```
