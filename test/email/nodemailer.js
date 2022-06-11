var nodemailer = require('nodemailer');

var transporter = nodemailer.createTransport(
  {
    "host": "smtp.gmail.com",
    "port": 587,
    "ssl": true,
    "auth": {
      "user": "!!!!", 
      "pass": "!!!!",
    }
});

const mailOptions = {
  from: '!!!!', // sender address
  to: '!!!!',   // list of receivers
  subject: 'Subject of your email', // Subject line
  html: '<p>Your html here</p>'     // plain text body
};

transporter.sendMail(mailOptions, function (err, info) {
   if(err)
     console.log(err)
   else
     console.log(info);
});
