var nodemailer = require('nodemailer');

var transporter = nodemailer.createTransport(
  {
      "host": "localhost",
      "port": 25,
      "ssl": false,
      "tls": {rejectUnauthorized: false}
  }
);

const mailOptions = {
  from: 'ubuntu', // sender address
  to: 'ubuntu@localhost',   // list of receivers
  subject: 'Subject of your email', // Subject line
  html: '<p>Your html here</p>'     // plain text body
};

transporter.sendMail(mailOptions, function (err, info) {
   if(err)
     console.log(err)
   else
     console.log(info);
});
