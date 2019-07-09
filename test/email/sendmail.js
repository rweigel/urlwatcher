const sendmail = require('sendmail')();
 
sendmail({
    from: '!!!!',
    to: '!!!!',
    subject: 'Test sendmail',
    html: 'Body of email ',
  }, function(err, reply) {
  	if (err) {
	    console.log('error:');
	    console.log(err);  		
  	} else {
	    console.dir(reply);
	}
});