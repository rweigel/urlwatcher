const fs = require('fs')
const os = require('os')
const path = require('path')

const clc = require('chalk')
const cron = require('node-cron')
const yargs = require('yargs')
const crypto = require('crypto')
const mkdirp = require('mkdirp')
const request = require('request')
const sendmail = require('sendmail')()
const prettyHtml = require('json-pretty-html').default
const nodemailer = require('nodemailer')
const chkDskSpace = require('check-disk-space')

const ver = parseInt(process.version.slice(1).split('.')[0])
// Alternative approach: https://stackoverflow.com/a/41620850
const verMin = 10
if (ver < verMin) {
  let msg = `node.js version >= ${verMin} required. `
  msg += `Version ${process.version} is being used.`
  log(null, msg, 'error')
  process.exit(1)
}

const app = { lastEmail: false }

const argv =
  yargs
    .strict()
    .help()
    .describe('port', 'Server port')
    .alias('port', 'p')
    .describe('conf', 'Server configuration file')
    .alias('conf', 'c')
    .boolean('debug')
    .describe('debug', 'Show verbose log messages.')
    .alias('debug', 'd')
    .default({
      port: false,
      debug: 'false',
      conf: path.join(__dirname, '/conf/app-config.json')
    })
    .argv

const config = readConfig(argv.conf)

if (argv.port && config.app.serverPort) {
  log(null, 'Port given on command line and in config file. Using command line value.', 'warning')
  config.app.serverPort = argv.port
}

exceptions(config)

config.app.hostname = config.app.hostname || os.hostname()

const urlTests = readTests()

if (config.app.emailStatus) {
  log(null, 'Sending start-up message to ' + config.app.emailStatusTo)
  const html = prettyHtml(urlTests)
  const title = 'URLWatcher started on ' + config.app.hostname + ' at ' + (new Date()).toISOString()
  const body = 'View results at ' + config.app.publicHTML + '<br/>Configuration:<br/>' + html
  email(config.app.emailStatusTo, title, body)
} else {
  log(null, 'Not sending application start/stop messages' + ' b/c config.app.emailStatus = false.')
}

for (const testName in urlTests) {
  // Prepare configuration file with masked email address
  const settingsDir = path.join(config.app.logDirectory, testName)
  const settingsFile = path.join(settingsDir, '/settings.json')
  if (!fs.existsSync(settingsDir)) {
    mkdirp.sync(settingsDir)
  }

  const fullEmail = urlTests[testName].emailAlertsTo

  // Mask email address.
  urlTests[testName].emailAlertsTo = maskEmailAddress(fullEmail)

  // Write configuration file to web-accessible directory
  const msg = JSON.stringify(urlTests[testName], null, 4)
  fs.writeFile(settingsFile, msg, (err) => {
    if (err) {
      log(testName, err, 'error')
    } else {
      log(testName, 'Wrote ' + settingsFile)
    }
  })

  // Reset email address.
  urlTests[testName].emailAlertsTo = fullEmail

  // Create array to store past results.
  urlTests[testName].results = []

  // Start test process
  log(testName, 'Starting first test for ' + testName)
  geturl(testName)
}

if (config.app.cron) {
  // https://www.npmjs.com/package/node-cron
  const expression = config.app.cron.expression
  if (!cron.validate(expression)) {
    log(null, `Cron expression '${expression}' is invalid. Exiting.`, 'error')
    process.exit(0)
  }
  const msgo = `cron expression: ${expression}; Time Zone: ${config.app.cron.timezone}`
  log(null, `Starting cron job. ${msgo}`)
  cron.schedule(expression, () => {
    const msg = `Running summary() due to ${msgo}`
    log(null, msg)
    summary()
  })
}

function summary () {
  for (const testName in urlTests) {
    const lastResult = urlTests[testName].results[urlTests[testName].results.length - 1]
    if (lastResult !== undefined) {
      let body = ''
      const subject = 'URLWatcher summary of tests in error state'
      const inError = lastResult.resquestError || lastResult.testError
      if (inError) {
        body += `❌: ${testName}\n`
        log(testName, `In error state: ${testName}`, 'error')
      }
      if (config.app.emailStatusTo) {
        email(config.app.emailStatusTo, subject, body)
      } else {
        log(null, 'Not sending summary email b/c config.app.emailStatus = false.')
      }
    }
  }
}

const testNames = Object.keys(urlTests)
const testObj = {}
for (const id of Object.keys(urlTests)) {
  const testCategory = id.split('/')[0]
  const testComponent = id.split('/')[1]
  if (!testObj[testCategory]) {
    testObj[testCategory] = []
  }
  testObj[testCategory].push(testComponent)
}

logMemory(true)

// Start server for serving log files and plots.
server()

function server () {
  const express = require('express')
  const serveIndex = require('serve-index')
  const app = express()
  // app.use(require('express-status-monitor')());

  app.use('/html', express.static(path.join(__dirname, '/html')))
  app.use('/html', serveIndex(path.join(__dirname, '/html'), { icons: true, view: 'details' }))
  app.use('/log', express.static(config.app.logDirectory))
  app.use('/log', serveIndex(config.app.logDirectory, { icons: true, view: 'details' }))
  app.use('/log/', express.static(config.app.logDirectory))
  app.use('/log/', serveIndex(config.app.logDirectory, { icons: true, view: 'details' }))

  app.get('^/$', function (req, res) {
    res.sendFile(path.join(__dirname, '/html/index.htm'))
  })

  app.get('/log/tests.json',
    function (req, res) {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(testObj, null, 2) + '\n')
    })

  app.get(/^\/log\/(.*)\/log\/files\.json$/,
    function (req, res) {
      log(null, 'Request for ' + req.params[0] + '/log/files.json')
      if (!testNames.includes(req.params[0])) {
        res.sendStatus(400)
        return
      }
      dirList(path.join(config.app.logDirectory, req.params[0], 'log'),
        function (err, files) {
          if (err) {
            res.sendStatus(500)
            res.write({ error: err.message })
            return
          }
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(files.reverse()) + '\n')
        }
      )
    })

  app.get(/^\/status\/(.*)$/,
    function (req, res) {
      // req.params[0] is the part of the URL that matches the regex in app.get()
      const requestedId = req.params[0]
      const requestedCategory = requestedId.split('/')[0]
      const requestedComponent = requestedId.split('/')[1]
      const results = {}
      let found = false
      if (requestedId in urlTests) {
        found = true
        // If exact match to a test id, return results for that test.
        // e.g. /status/CDAWeb/landing
        results.tests = urlTests[requestedId].tests
        results.results = urlTests[requestedId].results
        trimAbsolutePaths(results.results)
      } else if (!requestedComponent) {
        // Not an exact match. Return all results for tests with id that
        // starts with req.params[0]. e.g., /status/CDAWeb
        results[requestedCategory] = {}
        for (const id of Object.keys(urlTests)) {
          const testCategory = id.split('/')[0]
          const testComponent = id.split('/')[1]
          if (testCategory === requestedCategory) {
            log(null, 'testCategory: ' + testCategory)
            found = true
            results[testCategory][testComponent] = {}
            results[testCategory][testComponent].tests = urlTests[id].tests
            results[testCategory][testComponent].results = urlTests[id].results
            trimAbsolutePaths(results[testCategory][testComponent].results)
          }
        }
      }
      if (found) {
        res.setHeader('Content-Type', 'application/json')
        res.send(JSON.stringify(results, null, 2))
      } else {
        res.sendStatus(404)
      }
    })

  app.listen(config.app.serverPort, function (err) {
    if (err) {
      log(null, err, 'error')
      process.exit(1)
    } else {
      log(null, 'Server is listening on port ' + config.app.serverPort)
    }
  })
}

function report (testName) {
  const L = urlTests[testName].results.length
  const work = urlTests[testName].results[L - 1]

  let statusCode = work.statusCode
  if (statusCode === undefined) {
    statusCode = -1
  }

  const entry = new Date(work.requestStartTime).toISOString() +
            ',' + statusCode +
            ',' + round(work.timingPhases.firstByte) +
            ',' + round(work.timingPhases.download) +
            ',' + round(work.timingPhases.total) +
            ',' + work.bodyLength +
            ',' + work.testFails +
            '\n'

  log(testName, "Writing '" + testName + "' entry: " + entry.trim())
  // Append entry to entry file in directory named TestName + "log"
  if (!fs.existsSync(work.entryDirectory)) {
    mkdirp.sync(work.entryDirectory)
  }
  if (!fs.existsSync(work.entryFile)) {
    // Write header if first entry
    fs.writeFileSync(work.entryFile, 'Date,status,ttfb,dl,total,size,fails\n', 'utf8')
  }
  fs.appendFileSync(work.entryFile, entry, 'utf8')
  log(testName, "Wrote '" + testName + "' entry: " + entry.trim())

  writeResponseFile(work, testName)

  // Re-read test file on each iteration?
  try {
    // urlTests = readTests();
  } catch (e) {
    log(testName, 'report(): Re-read of tests failed. Using previous tests.', 'warning')
  }

  // Queue next test on testName
  setTimeout(() => { geturl(testName) }, urlTests[testName].interval)
}

function geturl (testName, attempt) {
  let work = null // Setting to null somehow leads to less peak memory usage.
  work = {}
  work.requestStartTime = new Date()
  work.testName = testName

  const url = urlTests[testName].url
  work.url = url
  if (url.match(/^http/)) {
    const opts = {
      url,
      time: true,
      timeout: urlTests[testName].tests.timeout,
      headers: { 'User-Agent': 'urlwatcher; https://github.com/hapi-server/servers' },
      maxAttempts: urlTests[testName].tests.maxAttempts || 3,
      retryDelay: urlTests[testName].tests.retryDelay || 1000
    }

    if (attempt === undefined) {
      attempt = 1
    }

    log(testName, work.requestStartTime.toISOString() + ' Requesting: ' + url)

    request.get(opts, function (error, response, body) {
      work.body = body
      work.timeout = false
      work.attempts = attempt
      work.statusCode = undefined
      work.requestError = false
      work.errorMessage = undefined

      let retry = false
      if (!error) {
        work.headers = response.headers
        work.statusCode = response.statusCode
        work.timingPhases = response.timingPhases
        if (response.statusCode === 200) {
          test(testName, work)
          return
        } else {
          retry = true
          const status = response.statusCode
          work.errorMessage = `Attempt ${attempt} failed due HTTP status = ${status} != 200.`
        }
      } else {
        work.requestError = true
        const emsg = `Attempt ${attempt} failed due to '${error.message}'.`
        if (error.message === 'ETIMEDOUT') {
          // No retry for timeout.
          work.timeout = true
          work.errorMessage = `${emsg} (No retry for ETIMEDOUT).`
        } else {
          retry = true
          work.errorMessage = emsg
        }
      }
      if (retry && attempt < opts.maxAttempts) {
        const emsg = `${work.errorMessage} Retrying in ${opts.retryDelay} ms.`
        log(testName, emsg, 'error')
        setTimeout(() => { geturl(testName, attempt + 1) }, opts.retryDelay)
      } else {
        log(testName, `${work.errorMessage}`, 'error')
        test(testName, work)
      }
    })
  } else {
    const emsg = `Protocol ${url.replace(/^(.*):.*/, '$1')} is not supported.`
    log(testName, emsg, 'error')
  }
}

function test (testName, work) {
  log(testName, work.requestStartTime.toISOString() + ' Testing: ' + work.url)
  logMemory()

  computeDirNames(testName, work)

  urlTests[testName].results.push(work)
  if (urlTests[testName].results.length > 1 + urlTests[testName].emailThreshold) {
    urlTests[testName].results.shift()
  }

  if (!work.requestError) {
    work.bodyMD5 = crypto.createHash('md5').update(work.body).digest('hex')
    work.bodyLength = work.body.length
  } else {
    work.bodyMD5 = undefined
    work.bodyLength = -1
    work.testFails = -1
    work.timingPhases = { firstByte: -1, download: -1, total: -1 }
  }

  const results = urlTests[testName].results
  const L = results.length

  work.testFailures = []
  work.emailBody = []

  let fails = Object.keys(urlTests[testName].tests).length

  if (work.requestError && work.timeout === false) {
    work.testFailures.push('requestError')
    const msg = '❌: ' + work.errorMessage
    work.emailBody.push(msg)
    fails = 1
    processTestResults(testName, work, fails)
    return
  }

  for (const checkName in urlTests[testName].tests) {
    if (checkName === '__comment') continue

    if (urlTests[testName].tests[checkName] === false) {
      fails--
      continue
    }

    if (checkName === 'timeout') {
      const stime = urlTests[testName].tests[checkName]
      if (results[L - 1][checkName] === true) {
        work.testFailures.push(checkName)
        const msg = '❌: Socket connection time' + ' > ' + stime + ' ms'
        work.emailBody.push(msg)
        fails = 1
        break
      } else {
        const msg = '✅: Socket connection time' + ' <= ' + stime + ' ms'
        work.emailBody.push(msg)
        fails--
      }
    }

    if (checkName === 'statusCode') {
      if (results[L - 1][checkName] !== urlTests[testName].tests[checkName]) {
        work.testFailures.push(checkName)
        let msg = '❌: Status code of ' + results[L - 1][checkName]
        msg += ' is not equal to ' + urlTests[testName].tests[checkName]
        work.emailBody.push(msg)
      } else {
        fails--
        let msg = '✅: Status code of ' + results[L - 1][checkName]
        msg += ' is equal to ' + urlTests[testName].tests[checkName]
        work.emailBody.push(msg)
      }
    }

    if (results[L - 1].body === undefined) {
      continue
    }

    if (checkName === 'lengthChanged') {
      if (L > 1) {
        const msgo = 'length of ' + results[L - 2].bodyLength
        if (results[L - 1].bodyLength !== results[L - 2].bodyLength && results[L - 2].bodyLength !== -1) {
          work.testFailures.push(checkName)
          let msg = '❌: Current ' + msgo
          msg += ' differs from that for last test (' + results[L - 1].bodyLength + ')'
          work.emailBody.push(msg)
        } else {
          fails--
          const msg = '✅: Current ' + msgo + ' is same as that for last test'
          work.emailBody.push(msg)
        }
      } else {
        fails--
      }
    }

    if (checkName === 'md5Changed') {
      if (L > 1) {
        if (results[L - 1].bodyMD5 !== results[L - 2].bodyMD5 && results[L - 2].bodyLength !== -1) {
          work.testFailures.push(checkName)
          work.emailBody.push('❌: Current MD5 differs from that for last test')
        } else {
          work.emailBody.push('✅: Current MD5 is same as that for last test')
          fails--
        }
      } else {
        fails--
      }
    }

    if (checkName === 'bodyRegExp') {
      const re = new RegExp(urlTests[testName].tests[checkName][0], urlTests[testName].tests[checkName][1] || '')
      let msgo = 'regular expression '
      msgo += "'" + urlTests[testName].tests[checkName][0] + "'"
      msgo += ' with options '
      msgo += "'" + urlTests[testName].tests[checkName][1] + "'"
      if (!re.exec(results[L - 1].body)) {
        work.testFailures.push(checkName)
        const msg = '❌: Body does not match ' + msgo
        work.emailBody.push(msg)
      } else {
        fails--
        const msg = '✅: Body matches ' + msgo
        work.emailBody.push(msg)
      }
    }

    if (checkName === 'firstByte') {
      const msgo = 'Time to first chunk of ' + round(results[L - 1].timingPhases[checkName])
      if (results[L - 1].timingPhases[checkName] > urlTests[testName].tests[checkName]) {
        work.testFailures.push(checkName)
        const msg = '❌: ' + msgo + ' > ' + urlTests[testName].tests[checkName] + ' ms'
        work.emailBody.push(msg)
      } else {
        fails--
        const msg = '✅: ' + msgo + ' <= ' + urlTests[testName].tests[checkName] + ' ms'
        work.emailBody.push(msg)
      }
    }

    if (checkName === 'download') {
      const msgo = 'Request transfer time of ' + round(results[L - 1].timingPhases[checkName])
      if (results[L - 1].timingPhases[checkName] > urlTests[testName].tests[checkName]) {
        work.testFailures.push(checkName)
        const msg = '❌: ' + msgo + ' > ' + urlTests[testName].tests[checkName] + ' ms'
        work.emailBody.push(msg)
      } else {
        fails--
        const msg = '✅: ' + msgo + ' <= ' + urlTests[testName].tests[checkName] + ' ms'
        work.emailBody.push(msg)
      }
    }

    if (checkName === 'total') {
      const msgo = 'Request time of ' + round(results[L - 1].timingPhases[checkName])
      if (results[L - 1].timingPhases[checkName] > urlTests[testName].tests[checkName]) {
        work.testFailures.push(checkName)
        const msg = '❌: ' + msgo + ' > ' + urlTests[testName].tests[checkName] + ' ms'
        work.emailBody.push(msg)
      } else {
        fails--
        const msg = '✅: ' + msgo + ' <= ' + urlTests[testName].tests[checkName] + ' ms'
        work.emailBody.push(msg)
      }
    }
  }
  processTestResults(testName, work, fails)
}

function processTestResults (testName, work, fails) {
  // Prepare email

  const results = urlTests[testName].results
  const L = results.length

  work.emailBodyList = [...work.emailBody] // Copy array

  const requestDate = work.requestStartTime.toISOString().replace(/T.*/, '')

  let body = 'Test URL\n  ' +
          urlTests[testName].url +
          '\n\n' +
          work.emailBody.join('\n') +
          '\n\nLast summary plot:\n  ' +
          publicURL(testName, requestDate)

  body = body +
        '\n\nSummary file:\n  ' +
          config.app.publicHTML +
          trimAbsolutePath(results[L - 1].entryFile) +
        '\n\nTest configuration\n  ' +
          config.app.publicHTML + 'log/' +
          testName + '/settings.json'

  if (L > 1) { // More than one test performed.
    // Assumes file from previous day exists.
    body = body +
          '\n\nLast two response files:\n  ' +
          config.app.publicHTML +
          trimAbsolutePath(results[L - 1].workFile)
    body = body +
          '\n  ' +
          config.app.publicHTML +
          trimAbsolutePath(results[L - 2].workFile)
  } else {
    body = body +
          '\n\nLast response file:\n  ' +
          config.app.publicHTML +
          trimAbsolutePath(results[L - 1].workFile)
  }

  results[L - 1].testError = false
  if (fails > 0) {
    results[L - 1].testError = true
  }

  work.testFails = fails

  let sendFailEmail = false
  let sendPassEmail = false
  const s = (fails > 1) ? 's' + ' (' + fails + ')' : ''

  // Check standard conditions for sending email
  if (L === 1 && results[L - 1].testError) {
    sendFailEmail = true
  }
  if (L > 1) {
    if (!results[L - 1].testError && results[L - 2].testError) {
      sendPassEmail = true
    }
  }

  // Check conditions for not sending standard email
  const emailThreshold = urlTests[testName].emailThreshold
  if (L >= emailThreshold) {
    let n = 0
    for (let i = 0; i < emailThreshold; i++) {
      if (results[L - i - 1].testError) {
        n = n + 1
      } else {
        break
      }
    }
    if (n === emailThreshold) {
      sendFailEmail = true
    }
    if (n > 0 && n < emailThreshold) {
      let reason = testName
      reason += ': Not sending fail email b/c number of consecutive failures '
      reason += '(' + n + ') is less than ' + emailThreshold + '.'
      log(testName, reason)
      sendFailEmail = false
      work.emailNotSentReason = reason
    }
  }

  if (sendFailEmail) {
    // If last email was fail email, don't send another.
    sendFailEmail = urlTests[testName].lastEmail !== 'fail'
    if (sendFailEmail === true) {
      log(testName, 'Sending fail email.')
      urlTests[testName].lastEmail = 'fail'
    } else {
      let reason = testName + ': '
      reason += 'Not sending fail email b/c fail email was last email sent.'
      log(testName, reason)
      work.emailNotSentReason = reason
    }
  }

  if (sendPassEmail) {
    // Only send pass email if last email sent was about failure.
    sendPassEmail = urlTests[testName].lastEmail === 'fail'
    if (sendPassEmail === true) {
      log(testName, 'Sending pass email.')
      urlTests[testName].lastEmail = 'pass'
    } else {
      let reason = testName + ': '
      reason += 'Not sending pass email b/c fail email was not yet sent.'
      log(testName, reason)
      work.emailNotSentReason = reason
    }
  }

  if (sendFailEmail || sendPassEmail) {
    work.emailTo = urlTests[testName].emailAlertsTo
    work.emailBody = body
  } else {
    work.emailBody = null
  }

  // Put partial timestamp to in subject line to prevent email clients
  // from threading messages.
  const requestTime = work.requestStartTime.toISOString().substring(11, 23)

  if (sendFailEmail) {
    work.emailSubject = '❌ ' + testName + ' URLWatcher: Test Failure' + s + ' on '
    work.emailSubject += config.app.hostname + ' @ ' + requestTime
    email(work)
  }

  if (sendPassEmail) {
    work.emailSubject = '✅ ' + testName + ' URLWatcher: All Tests Passed on '
    work.emailSubject += config.app.hostname + ' @ ' + requestTime
    email(work)
  }

  log(testName, work.requestStartTime.toISOString() + ' Tested: ' + work.url)
  logMemory()
  report(testName)
}

// Misc functions

function dirList (dir, cb) {
  const fs = require('fs')
  fs.readdir(dir, (err, files) => {
    if (err) {
      log(null, err, 'error')
    }
    cb(err, files)
  })
}

function trimAbsolutePath (absolutePath) {
  return absolutePath.replace(__dirname + '/', '')
}

function trimAbsolutePaths (results) {
  if (!Array.isArray(results)) results = [results]
  for (const result of results) {
    for (const key in result) {
      if (typeof (result[key]) === 'string') {
        result[key] = trimAbsolutePath(result[key])
      }
    }
  }
}

function writeResponseFile (work, testName) {
  // TODO: Should also do tests before creating or appending to entry file above.
  const inodeMin = 50000 // Change to percent?
  const diskMin = 10000000
  let inodeNums = [-1, -1]
  let inodeMsg = ''
  const notWin32 = process.platform !== 'win32'
  if (notWin32) {
    // TODO: Make async. Don't bother checking if last 10 checks were OK?
    // Better to catch out of disk space error and then report if issue is inode
    // or disk space?
    inodeNums = checkInodes(__dirname)
    inodeMsg = 'inodes Free: ' + inodeNums[1] + ' (min = ' + inodeMin + ')\n' +
               'inodes Tot.: ' + inodeNums[0] + '\n'
  }

  log(testName, 'Checking disk space')
  chkDskSpace(__dirname).then((diskSpace) => {
    // TODO: Don't bother checking if last 10 checks were OK?
    // Send only once per day
    // Send when fixed
    log(testName, 'Checked disk space')
    if (diskSpace.free < diskMin || (notWin32 && inodeNums[1] < inodeMin)) {
      if (app.lastEmail === false) {
        app.lastEmail = true
        log(testName, 'Sending low disk email', 'error')
        const title = 'URLWatcher low disk resources on ' + config.app.hostname + ' at ' + (new Date()).toISOString()
        const body = 'Disk Free:    ' + diskSpace.free + ' (min = ' + diskMin + ')\n' +
                   'Disk Size:    ' + diskSpace.size + '\n' +
                   inodeMsg +
                   'Will not write result file.'
        email(config.app.emailStatusTo, title, body)
      } else {
        log(testName, 'Not sending low disk email; already sent.')
      }
    } else {
      if (app.lastEmail === true) {
        app.lastEmail = false
        log(testName, 'Disk issue fixed')
        // TODO: Send email that problem fixed
      }

      if (!fs.existsSync(work.workDirectory)) {
        mkdirp.sync(work.workDirectory)
      }

      function prepLasts (work, condition) {
        const lastBodyFileKey = 'last' + condition + 'BodyFile'
        const lastBodyFileMD5Key = 'last' + condition + 'BodyFileMD5'

        const lastBodyFileMD5 = urlTests[testName][lastBodyFileMD5Key]
        if (lastBodyFileMD5 && lastBodyFileMD5 === work.bodyMD5) {
          work[lastBodyFileKey] = urlTests[testName][lastBodyFileKey]
          work[lastBodyFileMD5Key] = urlTests[testName][lastBodyFileMD5Key]
          log(testName, `${condition} body has not changed since last request. Not writing body to file.`)
        } else {
          const bodyFileName = work.workFile.replace('.json', '.body.json')
          urlTests[testName][lastBodyFileKey] = bodyFileName
          urlTests[testName][lastBodyFileMD5Key] = work.bodyMD5
          work[lastBodyFileKey] = bodyFileName
          work[lastBodyFileMD5Key] = work.bodyMD5
          log(testName, 'Writing body file: ' + bodyFileName)
          fs.writeFileSync(bodyFileName, work.body || '')
          log(testName, 'Wrote body file: ' + bodyFileName)
        }
        delete work.body
      }

      if (work.testError) {
        prepLasts(work, 'Fail')
      } else {
        prepLasts(work, 'Pass')
      }

      // Remove absolute paths from strings.
      trimAbsolutePaths(work)

      log(testName, "Writing '" + testName + "' work file")
      fs.writeFileSync(work.workFile, JSON.stringify(work, null, 2))
      log(testName, "Wrote '" + testName + "' work file")
    }
  })
}

function readConfig (configFile) {
  // Read configuration file
  if (!fs.existsSync(configFile)) {
    // Allow app to start even if email configuration file not found.
    log(null, 'File ' + configFile + ' not found. Exiting.', 'error')
    process.exit(1)
  }

  const tmp = fs.readFileSync(configFile)
  const config = JSON.parse(tmp)
  log(null, 'Read ' + configFile)

  if (!config.app.emailMethod) {
    config.app.emailMethod = null
  }
  const emailMethods = [null, 'sendmail', 'nodemailer', 'spawn']
  if (!emailMethods.includes(config.app.emailMethod)) {
    log(null, 'readConfig(): config.app.emailMethod must be one of: ' + emailMethods.join(','), 'error')
    process.exit(1)
  }

  // Create log directory if it does not exist
  config.app.logDirectory = path.join(__dirname, config.app.logDirectory)
  if (!fs.existsSync(config.app.logDirectory)) {
    mkdirp.sync(config.app.logDirectory)
    log(null, 'Created log directory ' + config.app.logDirectory)
  }
  return config
}

function readTests () {
  // Read URL test file
  const urlTestsFileName = path.join(__dirname, config.app.urlTestsFile)
  let urlTests
  if (fs.existsSync(urlTestsFileName)) {
    const urlTestsFileBlob = fs.readFileSync(urlTestsFileName)
    log(null, 'Reading ' + urlTestsFileName)
    try {
      urlTests = JSON.parse(urlTestsFileBlob)
    } catch (e) {
      log(null, 'Could not JSON parse ' + urlTestsFileName + '. Exiting.', 'error')
      process.exit(1)
    }
    log(null, 'Read ' + urlTestsFileName)
  } else {
    log(null, 'File ' + urlTestsFileName + ' not found. Exiting.', 'error')
    process.exit(1)
  }

  // TODO: Create JSON schema for test file and validate.
  // TODO: Make urlTests an array instead of an object.

  // Replace references to files with content of file.
  for (const testName in urlTests) {
    if (typeof (urlTests[testName]) !== 'string') {
      urlTests[testName + '/' + urlTests[testName].testName] = JSON.parse(JSON.stringify(urlTests[testName]))
      delete urlTests[testName]
    } else {
      const fname = path.join(__dirname, urlTests[testName])
      log(null, 'Reading and parsing\n  ' + fname)
      if (!fs.existsSync(fname)) {
        const msg = 'File ' + fname + ' referenced in ' + urlTestsFileName + ' not found. Exiting.'
        log(null, msg, 'error')
        process.exit(1)
      }
      let tmp = fs.readFileSync(fname)
      try {
        tmp = JSON.parse(tmp)
      } catch (e) {
        log(null, 'Could not JSON parse ' + fname + '. Exiting.', 'error')
        process.exit(1)
      }

      delete urlTests[testName]
      if (Array.isArray(tmp)) {
        let k = 1
        for (let i = 0; i < tmp.length; i++) {
          if ('testName' in tmp[i]) {
            urlTests[testName + '/' + tmp[i].testName] = tmp[i]
          } else {
            urlTests[testName + '/' + k] = tmp[i]
            k = k + 1
          }
        }
      }
    }
  }

  for (const testName in urlTests) {
    // Remove documentation nodes
    delete urlTests[testName].__comment
    delete urlTests[testName].tests.__comment

    urlTests[testName].emailThreshold = urlTests[testName].emailThreshold || 1

    if (urlTests[testName].emailAlerts) {
      const a = urlTests[testName].emailAlertsTo
      const b = urlTests[testName].emailAlertsTo === '!!!!'
      if (!a || b) {
        log(testName, 'emailAlerts = true and emailAlertsTo not given in test ' + testName + '. Exiting.', 'error')
        process.exit(1)
      }
    }
    // Create array to store past results.
    if (readTests.urlTestsLast && readTests.urlTestsLast[testName]) {
      urlTests[testName].results = readTests.urlTestsLast[testName].results
    } else {
      urlTests[testName].results = []
    }
  }

  readTests.urlTestsLast = urlTests
  return urlTests
}

function logMemory (firstCall) {
  const ISOString = (new Date()).toISOString()
  const YMD = ISOString.substr(0, 10)
  const logDir = config.app.logDirectory + '/_memory/'
  if (!fs.existsSync(logDir)) {
    mkdirp.sync(logDir)
  }
  const fileName = config.app.logDirectory + '/_memory/urlwatcher-memory-' + YMD + '.txt'

  const usage = process.memoryUsage()

  usage.urlTests = JSON.stringify(urlTests).length

  let logStr = ISOString
  for (const value of Object.values(usage)) {
    logStr = logStr + ',' + value
  }

  if (!fs.existsSync(fileName)) {
    logStr = 'time,' + Object.keys(usage).join(',') + '\n' + logStr
    fs.writeFileSync(fileName, logStr + '\n')
  } else {
    fs.appendFileSync(fileName, logStr + '\n')
  }
  log(null, 'memory: ' + logStr)
}

function publicURL (id, date) {
  if (typeof (date) !== 'string') {
    date = date.toISOString()
  }

  const ida = id.split('/')
  let url = config.app.publicHTML +
            '#date=' +
            date.substring(0, 10) +
            '&' +
            'category=' +
            ida[0]

  if (ida.length > 0) {
    url = url + '&' + 'test=' + ida[1]
  }

  return url
}

function computeDirNames (testName, work) {
  const timeStamp = new Date(work.requestStartTime).toISOString().replace(/Z/g, '')
  work.workDirectory = config.app.logDirectory + '/' + testName + '/requests'
  work.workFile = work.workDirectory + '/' + timeStamp + '.json'

  const ymd = new Date(work.requestStartTime).toISOString().replace(/T.*/, '')
  work.entryDirectory = config.app.logDirectory + '/' + testName + '/log'
  work.entryFile = work.entryDirectory + '/' + ymd + '.csv'

  work.emailDirectory = config.app.logDirectory + '/' + testName + '/emails'
  work.emailFile = work.emailDirectory + '/' + timeStamp + '.txt'
}

function maskEmailAddress (addr) {
  if (!addr) return ''
  addr = addr.split(',')
  for (let i = 0; i < addr.length; i++) {
    // username@host => us...@host
    const tmp = addr[i].split('@')
    const uname = tmp[0]
    const host = tmp[1]
    addr[i] = uname[0] + uname[1] + '...@' + host
  }
  return addr.join(',')
}

function emailPrint (testName, to, subject, text) {
  text = text || subject || ''
  let email = 'To: ' + maskEmailAddress(to) + '\n'
  email += 'Subject: ' + subject + '\n'
  email += 'Body:\n' + '  ' + text.replace(/\n/g, '\n  ')
  log(testName, 'Email to be sent:\n\n' +
    '--------------------------------------------------------\n' +
    email +
    '\n--------------------------------------------------------\n')
  return email
}

function email (to, subject, text, cb) {
  let testName = null

  if (typeof (to) !== 'object') {
    // TODO: Write to file
    emailPrint(null, to, subject, text)
  } else {
    // TODO: Handle email send failure.
    const work = to
    cb = subject
    to = work.emailTo
    testName = work.testName
    subject = work.emailSubject
    text = work.emailBody || work.emailSubject || ''
    const emailContent = emailPrint(null, to, subject, text)

    if (!fs.existsSync(work.emailDirectory)) {
      mkdirp.sync(work.emailDirectory)
    }
    logMemory()
    log(testName, 'Writing ' + work.emailFile)
    fs.writeFileSync(work.emailFile, emailContent)
    log(testName, 'Wrote ' + work.emailFile)
    logMemory()
  }

  if (!config.app.emailMethod) {
    log(testName, 'config.app.emailMethod not specified. Not sending email.')
    if (cb) {
      cb()
    }
    return
  }

  text = text.replace(/\n/g, '<br/>').replace(/ /g, '&nbsp;')

  if (to === '!!!!' || to === '') {
    if (to === '!!!!') {
      log(testName, 'Invalid email address of ' + to + '. Not sending email.', 'warning')
    } else {
      log(testName, 'No to address')
    }
    if (cb) {
      cb()
    }
    return
  }

  if (config.app.emailMethod === 'spawn') {
    const { spawn } = require('child_process')

    const clSend = path.join(__dirname, '/test/email/sendmail.js')
    const clArgs = [clSend, to, config.spawn.from, subject, text]
    log(testName, `Spawning ${process.execPath} ${clSend} ${to} ${config.spawn.from} ${subject} ${text}`)
    const child = spawn(process.execPath, clArgs)

    child.on('exit', (code) => {
      // child = null;
    })

    child.stderr.on('data', (data) => {
      console.error(`spawn stderr:\n  ${data}`)
    })

    child.on('close', (code) => {
      log(testName, `spawn exited with code ${code}`)
      if (cb) {
        log(testName, 'Spawned')
        log(testName, 'Executing callback.')
        cb()
      }
    })
  }

  if (config.app.emailMethod === 'sendmail') {
    sendmail({
      from: config.sendmail.from,
      to,
      subject,
      html: text,
      silent: true
    }, function (err, reply) {
      if (err) {
        log(testName, 'Error when attempting to send email:')
        log(testName, err)
      } else {
        log(testName, 'Email sent. Reply:')
      }
      if (cb) {
        log(testName, 'Executing callback.')
        cb()
      }
    })
  }

  if (config.app.emailMethod === 'nodemailer') {
    const transporter = nodemailer.createTransport({
      host: config.nodemailer.host,
      port: config.nodemailer.port,
      ssl: true,
      auth: {
        user: config.nodemailer.user,
        pass: config.nodemailer.password
      }
    })

    const mailOptions = {
      from: config.nodemailer.from,
      to,
      subject,
      html: text
    }

    transporter.sendMail(mailOptions, function (err, info) {
      if (err) {
        log(testName, 'email(): Error while attempting to send email:')
        log(testName, err)
      } else {
        // console.log("Email send response:");
        // console.log(info);
      }
      if (cb) {
        log(testName, 'email(): Executing callback.')
        cb()
      }
    })
  }
}

function shutdown () {
  log(null, 'Shutdown called.')
  if (shutdown.called === true) {
    return
  }
  if (!shutdown.called) {
    shutdown.called = true
  }
  if (config.app.emailStatus) {
    log(null, 'Sending stop email.')
    // TODO: Not working. See old URLWatch code, which worked.
    const subj = 'URLWatcher stopped on ' +
            config.app.hostname +
            ' at ' +
            (new Date()).toISOString()

    email(config.app.emailStatusTo, subj, '', () => { process.exit(0) })
  } else {
    log(null, 'Not sending stop message b/c emailStatus = false.')
    process.exit(0)
  }
}

function checkInodes (dir) {
  const stdout = require('child_process').execSync('df -iPk ' + dir).toString()
  // Based on
  // https://github.com/adriano-di-giovanni/node-df/blob/master/lib/parse.js
  const cols = stdout
    .trim()
    .split(/\r|\n|\r\n/) // split into rows
    .slice(1) // strip column headers away
    .map(function (row) {
      const columns = row
        .replace(/\s+(\d+)/g, '\t$1')
        .replace(/\s+\//g, '\t/')
        .split(/\t/)
      return columns
    })
  return [parseInt(cols[0][1]), parseInt(cols[0][3])]
}

function log (testName, msg, etype) {
  if (argv.debug === false && !['error', 'warning'].includes(etype)) {
    return
  }

  let msgo = (new Date()).toISOString() + ' '
  if (testName) {
    msgo = msgo + `[${testName}] `
  }

  // https://stackoverflow.com/a/37081135
  const e = new Error()
  const stack = e.stack.toString().split(/\r\n|\n/)
  const line = stack[2].replace(/.*\//, '').replace(/:(.*):.*/, ':$1')
  msg = trimAbsolutePath(msg)
  if (etype === 'error') {
    console.error(msgo + line + ' ' + clc.red(msg))
  } else if (etype === 'warning') {
    console.log(msgo + line + ' ' + clc.yellow(msg))
  } else {
    console.log(msgo + line + ' ' + msg)
  }
}

function round (t) {
  return Math.round(10 * t) / 10
}

function exceptions (config) {
  process.on('exit', function () {
    log(null, "process.on('exit') called.")
    shutdown()
  })
  process.on('SIGINT', function () {
    log(null, "process.on('SIGINT') called.")
    shutdown()
  })
  process.on('uncaughtException', function (err) {
    log(null, 'Uncaught exception: ', 'error')
    log(null, err.stack, 'error')
    if (config.app.emailStatus && err.message !== exceptions.lastMessage) {
      const ds = (new Date()).toISOString()
      const emsg = 'URLWatcher exception on ' + config.app.hostname + ' at ' + ds
      email(config.app.emailStatusTo, emsg, err.stack)
      log(null, 'Sent email to ' + config.app.emailStatusTo, 'error')
    } else {
      log(null, 'Not sending email b/c emailStatus = false.', 'error')
    }
    if (!exceptions.lastError) {
      exceptions.lastMessage = err.message
    }
  })
}
