console.log("  To: " + process.argv[2]);
console.log("  From: " + process.argv[3]);
console.log("  Subject: " + process.argv[4]);

const sendmail = require('sendmail')({devHost: 'localhost', devPort: 25})

sendmail({
    to: "ubuntu@localhost",
    from: "ubuntu@localhost",
    subject: process.argv[4],
    html: process.argv[5],
  }, function(err, reply) {
    if (err) {
      console.error("Sendmail error for mail to ubuntu@localhost. Server error:");
      console.error(err);
    } else {
      //console.log(reply);
    }
});

if (0) {
    const sendmail = require('sendmail')()
    sendmail({
    to: process.argv[2],
    from: process.argv[3],
    subject: process.argv[4],
    html: process.argv[5],
  }, function(err, reply) {
    if (err) {
      console.error('Sendmail error for mail to ' + process.argv[2] + ". Server error:");
      console.error(err);
    } else {
      console.error('Sendmail success for mail to ' + process.argv[2] + ". Server reply:");
      console.log(reply);
    }
});
}

